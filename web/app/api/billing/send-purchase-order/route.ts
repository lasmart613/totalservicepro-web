import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  publicSiteOrigin,
  supplierLoginUrl,
  supplierSignupUrl,
  wrapSupplierFacingDocumentEmail,
} from '@/lib/customer-invite';
import { parseMailLocale } from '@/lib/i18n/translate-app';
import { loadOrgMoneyPrefs } from '@/lib/org-money';
import { releaseDocumentSendSlot, takeDocumentSendSlot } from '@/lib/billing/send-rate-limit';
import {
  buildOwnedPurchaseOrderEmailText,
  buildOwnedPurchaseOrderMessage,
  documentOwnedByOrganization,
  isMailbox,
  loadOwnedDocument,
  loadSenderCompany,
  ownedDocumentSubject,
  parseDocumentId,
  resendMessage,
  sanitizeMailResponse,
  senderCompanyFromOrg,
  type QueryClient,
} from '@/lib/billing/owned-doc-mail';

const PO_SELECTS = [
  'id, organization_id, supplier_organization_id, supplier_name, supplier_email, po_number, po_date, needed_by, description, subtotal, tax, total, status, po_data, created_by',
  'id, organization_id, supplier_organization_id, supplier_name, supplier_email, po_number, status, po_data',
  'id, organization_id, supplier_email, po_number',
];

/** Same wording for a missing row and a row owned by another shop. */
const PO_NOT_FOUND = 'Purchase order not found.';

type SendPurchaseOrderDeps = {
  userClient?: SupabaseClient;
  adminClient?: SupabaseClient | null;
};

/**
 * POST /api/billing/send-purchase-order
 * Body: { purchase_order_id, locale? }
 * Mail is sent only for a purchase order the caller's organization owns.
 * HTML, text, subject, shop name, reply-to, and recipient come from that PO
 * and the owning organization. html, subject, company_name, reply_to, replyTo,
 * supplier_organization_id, and any recipient in the body are ignored.
 */
export async function POST(req: NextRequest) {
  return runSendPurchaseOrder(req);
}

export async function runSendPurchaseOrder(req: NextRequest, deps: SendPurchaseOrderDeps = {}) {
  let heldSlot: { organizationId: string | number | null; documentId: string | number; stamp: number } | null =
    null;
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return respond({ error: 'Sign in required' }, 401);

    let supabase: SupabaseClient;
    if (deps.userClient) {
      supabase = deps.userClient;
    } else {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
      if (!url || !anon) return respond({ error: 'Server misconfigured' }, 500);
      supabase = createClient(url, anon, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) return respond({ error: 'Invalid session' }, 401);

    let callerOrgId: string | number | null = null;
    try {
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      callerOrgId = prof?.organization_id ?? null;
    } catch {
      callerOrgId = null;
    }
    if (callerOrgId == null || String(callerOrgId).trim() === '') {
      return respond({ error: 'No organization on your profile' }, 403);
    }

    const raw = await req.json().catch(() => ({}));
    const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const poId = parseDocumentId(record.purchase_order_id ?? record.po_id);
    const locale = parseMailLocale(record.locale);
    if (poId == null) return respond({ error: 'Purchase order id is required.' }, 400);

    const admin: SupabaseClient | null =
      deps.adminClient !== undefined ? deps.adminClient : hasServiceRole() ? getSupabaseAdmin() : null;

    const loaded = await loadOwnedDocument({
      userClient: supabase,
      adminClient: admin,
      table: 'purchase_orders',
      id: poId,
      callerOrgId,
      narrowSelects: PO_SELECTS,
      notFoundError: PO_NOT_FOUND,
      forbiddenError: PO_NOT_FOUND,
    });
    if (!loaded.ok || !documentOwnedByOrganization(loaded.row, callerOrgId)) {
      return respond({ error: PO_NOT_FOUND }, 403);
    }
    const po = loaded.row;

    const readers: QueryClient[] = admin ? [supabase, admin] : [supabase];
    const supplierOrg = await storedSupplierContact(readers, po.supplier_organization_id);
    const orgEmail = supplierOrg?.email || '';
    const storedEmail = String(po.supplier_email || '').trim();
    const recipient = isMailbox(orgEmail) ? orgEmail : isMailbox(storedEmail) ? storedEmail : '';
    if (!recipient) {
      return respond(
        {
          error:
            'No valid supplier email. Add an email on the parts supplier profile or on this purchase order.',
        },
        400
      );
    }

    const techName = await readTechName(supabase, user.id);
    const company = await loadSenderCompany(supabase, callerOrgId, techName);
    const shop = company.company_name ? company : senderCompanyFromOrg(null, techName);
    const moneyPrefs = await loadOrgMoneyPrefs(supabase, callerOrgId);
    const subject = ownedDocumentSubject('purchase_order', po.po_number, shop.company_name, locale);
    const origin = publicSiteOrigin(req);
    const signupUrl = supplierSignupUrl(origin, recipient);
    const loginUrl = supplierLoginUrl(origin);
    const documentHtml = buildOwnedPurchaseOrderMessage({
      row: po,
      company: shop,
      supplierEmail: recipient,
      moneyPrefs,
      locale,
    });
    const text = buildOwnedPurchaseOrderEmailText({
      row: po,
      company: shop,
      supplierEmail: recipient,
      moneyPrefs,
      locale,
      signupUrl,
      loginUrl,
    });
    const html = wrapSupplierFacingDocumentEmail({
      subject,
      documentHtml,
      signupUrl,
      loginUrl,
      locale,
    });

    const resendKey = process.env.RESEND_API_KEY;
    const from =
      process.env.NOTIFY_FROM_EMAIL ||
      process.env.RESEND_FROM ||
      'Total Service Pro <contact@medicalrepairnetwork.com>';
    if (!resendKey) {
      return respond(
        {
          ok: false,
          emailSent: false,
          error:
            'Email delivery is not configured (RESEND_API_KEY). Save the PO and set up Resend to send mail.',
          needsConfig: true,
        },
        503,
        [recipient]
      );
    }

    const sendLimit = takeDocumentSendSlot({
      organizationId: callerOrgId,
      documentId: poId,
      documentType: 'purchase_order',
    });
    if (!sendLimit.ok) {
      return respond({ error: sendLimit.message, rateLimited: true }, 429);
    }
    heldSlot = { organizationId: callerOrgId, documentId: poId, stamp: sendLimit.stamp };

    const message = resendMessage({
      from,
      to: recipient,
      subject,
      html,
      text,
      replyTo: shop.email,
    });
    const rr = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    const result = await rr.json().catch(() => ({}));
    if (!rr.ok) {
      console.error('Resend purchase order send failed', result);
      if (heldSlot) {
        releaseDocumentSendSlot({ ...heldSlot, documentType: 'purchase_order' });
        heldSlot = null;
      }
      const msg = result?.message || `Email provider error (${rr.status})`;
      return respond({ ok: false, emailSent: false, error: msg }, 502, [recipient]);
    }

    heldSlot = null;

    try {
      const writer = admin ?? supabase;
      await writer
        .from('purchase_orders')
        .update({
          status: 'sent',
          supplier_email: recipient,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', poId)
        .eq('organization_id', callerOrgId);
    } catch (e) {
      console.warn('could not mark purchase order sent', e);
    }

    return respond(
      {
        ok: true,
        emailSent: true,
        id: result?.id || null,
        to: recipient,
        purchaseOrderId: poId,
      },
      200,
      [recipient]
    );
  } catch (e: any) {
    if (heldSlot) releaseDocumentSendSlot({ ...heldSlot, documentType: 'purchase_order' });
    console.error('send-purchase-order', e);
    return respond({ error: e?.message || 'Send failed' }, 500);
  }
}

function respond(body: Record<string, unknown>, status = 200, allowedEmails: string[] = []) {
  return NextResponse.json(sanitizeMailResponse(body, allowedEmails), { status });
}

/**
 * Email on the supplier organization stored on the PO.
 * A non-supplier type does not contribute an address. A missing row is skipped
 * so the PO's own supplier_email can still be used.
 */
async function storedSupplierContact(
  clients: QueryClient[],
  supplierOrgId: unknown
): Promise<{ email: string } | null> {
  if (supplierOrgId == null || String(supplierOrgId).trim() === '') return null;
  for (const client of clients) {
    try {
      const { data, error } = await client
        .from('organizations')
        .select('email, type')
        .eq('id', supplierOrgId)
        .maybeSingle();
      if (error || !data) continue;
      const type = String(data.type || '').toLowerCase();
      if (type && type !== 'parts_supplier' && type !== 'vendor') return { email: '' };
      return { email: String(data.email || '').trim() };
    } catch {
      continue;
    }
  }
  return null;
}

async function readTechName(supabase: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('first_name, last_name')
      .eq('id', userId)
      .maybeSingle();
    return [data?.first_name, data?.last_name].filter(Boolean).join(' ');
  } catch {
    return '';
  }
}
