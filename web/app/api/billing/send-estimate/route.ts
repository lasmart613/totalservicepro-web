import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { ensureEstimateActionCtas } from '@/lib/billing/doc-html';
import {
  generateEstimateActionToken,
  persistEstimateActionToken,
  readExistingActionToken,
} from '@/lib/billing/estimate-action';
import { estimateActionUrl } from '@/lib/share';

/**
 * POST /api/billing/send-estimate
 * Body: { estimate_id?, to_email?, subject?, html?, estimate_number?, reply_to?,
 *         customer_organization_id? }
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

    let callerOrgId: string | number | null = null;
    try {
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      callerOrgId = prof?.organization_id ?? null;
    } catch {
      /* ignore */
    }

    const body = await req.json().catch(() => ({}));
    const bodyEmail = String(body.to_email || body.to || '').trim();
    let toEmail = '';
    let emailSource: 'crm_org' | 'crm_contact' | 'form' | 'estimate_data' | 'none' = 'none';
    let html = String(body.html || '').trim();
    const estimateNumber = body.estimate_number ? String(body.estimate_number) : '';
    const rawId = body.estimate_id ?? null;
    const estimateId =
      rawId == null || rawId === '' || rawId === 'new'
        ? null
        : /^\d+$/.test(String(rawId))
          ? Number(rawId)
          : rawId;

    const EST_SELECTS = [
      'id, created_by, organization_id, customer_name, customer_organization_id, total, estimate_data, estimate_number, status, customer_action_token',
      'id, created_by, organization_id, customer_name, customer_organization_id, total, estimate_data, estimate_number, status',
    ];

    async function loadEstimateRow(client: SupabaseClient, id: string | number) {
      for (const cols of EST_SELECTS) {
        const { data, error } = await client
          .from('service_estimates')
          .select(cols)
          .eq('id', id)
          .maybeSingle();
        if (!error && data) return data;
        if (error && !/column|schema cache|does not exist/i.test(error.message || '')) break;
      }
      return null;
    }

    let est: any = null;
    if (estimateId != null) {
      est = await loadEstimateRow(supabase, estimateId);
      if (!est && hasServiceRole()) {
        try {
          const row = await loadEstimateRow(getSupabaseAdmin(), estimateId);
          if (row) {
            const owns =
              (row.created_by && String(row.created_by) === String(user.id)) ||
              (callerOrgId != null &&
                row.organization_id != null &&
                String(row.organization_id) === String(callerOrgId));
            if (owns) est = row;
          }
        } catch {
          /* ignore */
        }
      }
    }

    const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

    let custOrgId =
      body.customer_organization_id ?? est?.customer_organization_id ?? null;
    if (!custOrgId && est?.estimate_data) {
      let ed = est.estimate_data;
      if (typeof ed === 'string') {
        try {
          ed = JSON.parse(ed);
        } catch {
          ed = {};
        }
      }
      if (ed?.customer_organization_id) custOrgId = ed.customer_organization_id;
    }

    const crmClient: SupabaseClient = hasServiceRole() ? getSupabaseAdmin() : supabase;

    if (custOrgId) {
      try {
        const { data: cOrg } = await crmClient
          .from('organizations')
          .select('id, name, email')
          .eq('id', custOrgId)
          .maybeSingle();
        if (cOrg?.email && isValidEmail(String(cOrg.email).trim())) {
          toEmail = String(cOrg.email).trim();
          emailSource = 'crm_org';
        }
      } catch {
        /* contacts next */
      }
      if (!toEmail) {
        try {
          const { data: primary } = await crmClient
            .from('contacts')
            .select('email, is_primary')
            .eq('organization_id', custOrgId)
            .not('email', 'is', null)
            .order('is_primary', { ascending: false })
            .limit(5);
          const pick = (primary || []).find(
            (c: { email?: string | null }) => c.email && isValidEmail(String(c.email).trim())
          );
          if (pick?.email) {
            toEmail = String(pick.email).trim();
            emailSource = 'crm_contact';
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (!toEmail && bodyEmail && isValidEmail(bodyEmail)) {
      toEmail = bodyEmail;
      emailSource = 'form';
    }

    if ((!toEmail || !isValidEmail(toEmail)) && est?.estimate_data) {
      let ed = est.estimate_data;
      if (typeof ed === 'string') {
        try {
          ed = JSON.parse(ed);
        } catch {
          ed = {};
        }
      }
      if (ed?.custEmail && isValidEmail(String(ed.custEmail).trim())) {
        toEmail = String(ed.custEmail).trim();
        emailSource = 'estimate_data';
      }
    }

    if (!toEmail || !isValidEmail(toEmail)) {
      return NextResponse.json(
        {
          error:
            'No valid customer email. Add email on the customer profile or estimate form.',
        },
        { status: 400 }
      );
    }
    if (!html || html.length < 40) {
      return NextResponse.json({ error: 'Estimate HTML body is required' }, { status: 400 });
    }

    const subject =
      String(body.subject || '').trim() ||
      (estimateNumber
        ? `Estimate ${estimateNumber} from Total Service Pro`
        : 'Service estimate from Total Service Pro');

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
            'Email delivery is not configured (RESEND_API_KEY). Save as draft or mark sent without email.',
          needsConfig: true,
        },
        { status: 503 }
      );
    }

    let actionToken: string | null = null;
    if (estimateId != null && est) {
      actionToken = readExistingActionToken(est);
      if (!actionToken) actionToken = generateEstimateActionToken();
      const writer = hasServiceRole() ? getSupabaseAdmin() : supabase;
      try {
        await persistEstimateActionToken(writer, estimateId, actionToken, est.estimate_data);
      } catch (e) {
        console.warn('could not persist estimate action token', e);
      }
      html = ensureEstimateActionCtas(html, estimateActionUrl(actionToken));
    }

    const wrapped = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${subject.replace(/</g, '')}</title></head>
<body style="margin:0;padding:16px;background:#f4f4f5;font-family:system-ui,sans-serif;">
  <div style="max-width:720px;margin:0 auto;background:#fff;border-radius:12px;padding:8px;box-shadow:0 2px 12px rgba(0,0,0,.06);">
    ${html}
  </div>
  <p style="max-width:720px;margin:16px auto 0;font-size:11px;color:#666;text-align:center;">
    Sent via Total Service Pro · <a href="https://repairplanet.net">repairplanet.net</a>
  </p>
</body></html>`;

    const rr = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [toEmail],
        subject,
        html: wrapped,
        reply_to: body.reply_to || undefined,
      }),
    });

    const result = await rr.json().catch(() => ({}));
    if (!rr.ok) {
      console.error('Resend estimate send failed', result);
      const msg = result?.message || `Email provider error (${rr.status})`;
      const friendly =
        /verify a domain|own email address|testing emails|not verified/i.test(msg)
          ? `${msg} — Verify medicalrepairnetwork.com DNS in Resend before sending to arbitrary customers.`
          : msg;
      return NextResponse.json(
        {
          ok: false,
          emailSent: false,
          error: friendly,
          attemptedTo: toEmail,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      emailSent: true,
      id: result?.id || null,
      to: toEmail,
      emailSource,
      estimateId,
      actionToken,
    });
  } catch (e: any) {
    console.error('send-estimate', e);
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
