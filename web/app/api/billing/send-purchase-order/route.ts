import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  publicSiteOrigin,
  supplierLoginUrl,
  supplierSignupUrl,
  wrapSupplierFacingDocumentEmail,
} from '@/lib/customer-invite';

const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function sameOrg(a: unknown, b: unknown): boolean {
  return a != null && b != null && String(a) === String(b);
}

/**
 * POST /api/billing/send-purchase-order
 * Emails a PO to the parts supplier's organization profile email.
 * Caller must belong to the sending organization.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();
    const callerOrgId = profile?.organization_id ?? null;
    if (callerOrgId == null) {
      return NextResponse.json({ error: 'No organization on your profile' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const html = String(body.html || '').trim();
    const poNumber = body.po_number ? String(body.po_number) : '';
    const rawId = body.purchase_order_id ?? body.po_id ?? null;
    const poId =
      rawId == null || rawId === '' || rawId === 'new'
        ? null
        : /^\d+$/.test(String(rawId))
          ? Number(rawId)
          : rawId;

    if (!html) {
      return NextResponse.json({ error: 'Purchase order HTML is required' }, { status: 400 });
    }

    const reader = hasServiceRole() ? getSupabaseAdmin() : supabase;
    let po: any = null;
    if (poId != null) {
      const { data, error } = await reader
        .from('purchase_orders')
        .select(
          'id, organization_id, supplier_organization_id, supplier_name, supplier_email, po_number, status, created_by'
        )
        .eq('id', poId)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      po = data;
      if (!po) {
        return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
      }
      if (!sameOrg(po.organization_id, callerOrgId)) {
        return NextResponse.json(
          { error: 'This purchase order belongs to another organization' },
          { status: 403 }
        );
      }
    }

    let supplierOrgId =
      body.supplier_organization_id ?? po?.supplier_organization_id ?? null;
    let supplierEmail = '';
    let supplierName = String(body.supplier_name || po?.supplier_name || '').trim();

    if (supplierOrgId != null) {
      const { data: supplier } = await reader
        .from('organizations')
        .select('id, name, email, type')
        .eq('id', supplierOrgId)
        .maybeSingle();
      if (!supplier) {
        return NextResponse.json({ error: 'Parts supplier not found' }, { status: 404 });
      }
      const t = String(supplier.type || '').toLowerCase();
      if (t && t !== 'parts_supplier' && t !== 'vendor') {
        return NextResponse.json(
          { error: 'Selected organization is not a parts supplier' },
          { status: 400 }
        );
      }
      supplierName = supplier.name || supplierName;
      if (isValidEmail(String(supplier.email || '').trim())) {
        supplierEmail = String(supplier.email).trim();
      }
    }

    if (!supplierEmail && po?.supplier_email && isValidEmail(String(po.supplier_email).trim())) {
      supplierEmail = String(po.supplier_email).trim();
    }

    if (!isValidEmail(supplierEmail)) {
      return NextResponse.json(
        {
          error:
            'This parts supplier has no email on their organization profile. Add one there, then send again.',
        },
        { status: 400 }
      );
    }

    const subject =
      String(body.subject || '').trim() ||
      (poNumber
        ? `Purchase Order ${poNumber} from ${body.company_name || 'Total Service Pro'}`
        : 'Purchase Order from Total Service Pro');

    const resendKey = process.env.RESEND_API_KEY;
    const from =
      process.env.NOTIFY_FROM_EMAIL ||
      process.env.RESEND_FROM ||
      'Total Service Pro <contact@medicalrepairnetwork.com>';

    if (!resendKey) {
      return NextResponse.json(
        {
          ok: false,
          emailSent: false,
          error:
            'Email delivery is not configured (RESEND_API_KEY). Save the PO and set up Resend to send mail.',
          needsConfig: true,
        },
        { status: 503 }
      );
    }

    const origin = publicSiteOrigin(req);
    const wrapped = wrapSupplierFacingDocumentEmail({
      subject,
      documentHtml: html,
      signupUrl: supplierSignupUrl(origin, supplierEmail),
      loginUrl: supplierLoginUrl(origin),
    });

    const rr = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [supplierEmail],
        subject,
        html: wrapped,
        reply_to: body.reply_to || undefined,
      }),
    });

    const result = await rr.json().catch(() => ({}));
    if (!rr.ok) {
      const msg = result?.message || `Email provider error (${rr.status})`;
      return NextResponse.json(
        { ok: false, emailSent: false, error: msg, attemptedTo: supplierEmail },
        { status: 502 }
      );
    }

    if (poId != null) {
      const writer = hasServiceRole() ? getSupabaseAdmin() : supabase;
      await writer
        .from('purchase_orders')
        .update({
          status: 'sent',
          supplier_email: supplierEmail,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', poId)
        .eq('organization_id', callerOrgId);
    }

    return NextResponse.json({
      ok: true,
      emailSent: true,
      id: result?.id || null,
      to: supplierEmail,
      purchaseOrderId: poId,
      supplierOrganizationId: supplierOrgId,
      supplierName,
    });
  } catch (e: any) {
    console.error('send-purchase-order', e);
    return NextResponse.json({ error: e?.message || 'Send failed' }, { status: 500 });
  }
}
