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
import { isSupplierOrgType } from '@/lib/org-types';
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
  'id, organization_id, supplier_organization_id, supplier_name, supplier_email, po_number, po_date, needed_by, description, subtotal, tax, total, status, sent_at, po_data, created_by',
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
    const storedEmail = String(po.supplier_email || '').trim();
    const storedName = String(po.supplier_name || '').trim();
    const recipient = supplierRecipient(supplierOrg, storedEmail);
    if (!recipient) {
      return respond(
        {
          error:
            'No valid supplier email. Add an email on the parts supplier profile or on this purchase order.',
        },
        400
      );
    }
    const supplierName =
      (supplierOrg?.supplier ? supplierOrg.name : '') || storedName || null;

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
        503
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
      return respond({ ok: false, emailSent: false, error: msg }, 502);
    }

    heldSlot = null;

    let sentAt: string | null = null;
    try {
      // Ownership was already checked above. Stamp with the service-role
      // client: a signed-in JWT cannot move status off 'sent' or change
      // sent_at once it is set. Service role (no JWT user) bypasses that
      // guard, so the first send and a re-send can both write sent_at here.
      // Without the admin client, leave the row alone rather than writing
      // sent_at with the caller's JWT.
      if (admin) {
        const stamped = new Date().toISOString();
        const { error: markError } = await admin
          .from('purchase_orders')
          .update({
            status: 'sent',
            supplier_email: recipient,
            sent_at: stamped,
            updated_at: stamped,
          })
          .eq('id', poId)
          .eq('organization_id', callerOrgId);
        if (!markError) sentAt = stamped;
        else console.warn('could not mark purchase order sent', markError);
      } else {
        console.warn('could not mark purchase order sent: service role client is required');
      }
    } catch (e) {
      console.warn('could not mark purchase order sent', e);
    }

    return respond(
      {
        ok: true,
        emailSent: true,
        sent_at: sentAt,
        supplierName,
      },
      200
    );
  } catch (e: any) {
    if (heldSlot) releaseDocumentSendSlot({ ...heldSlot, documentType: 'purchase_order' });
    console.error('send-purchase-order', e);
    return respond({ error: e?.message || 'Send failed' }, 500);
  }
}

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(sanitizeMailResponse(body, []), { status });
}

/**
 * parts_supplier and vendor are the purchase-order supplier types.
 * supplier is the extra alias the parts vendor picker and founder membership
 * SQL treat as a parts supplier. An empty type is not a supplier.
 */
function isPurchaseOrderSupplierType(type: unknown): boolean {
  const value = String(type || '').toLowerCase().trim();
  return isSupplierOrgType(value) || value === 'supplier';
}

type SupplierOrgContact = {
  email: string;
  name: string;
  supplier: boolean;
};

/**
 * Organization stored on the PO. A non-supplier type does not contribute an
 * address; the caller falls back to supplier_email. A missing row is skipped
 * for the same reason.
 */
async function storedSupplierContact(
  clients: QueryClient[],
  supplierOrgId: unknown
): Promise<SupplierOrgContact | null> {
  if (supplierOrgId == null || String(supplierOrgId).trim() === '') return null;
  for (const client of clients) {
    try {
      const { data, error } = await client
        .from('organizations')
        .select('email, type, name')
        .eq('id', supplierOrgId)
        .maybeSingle();
      if (error || !data) continue;
      const supplier = isPurchaseOrderSupplierType(data.type);
      return {
        email: supplier ? String(data.email || '').trim() : '',
        name: String(data.name || '').trim(),
        supplier,
      };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * A linked supplier org must be a supplier type before its address is used.
 * Anything else falls back to the purchase order's own supplier_email.
 */
function supplierRecipient(supplierOrg: SupplierOrgContact | null, storedEmail: string): string {
  if (supplierOrg?.supplier && isMailbox(supplierOrg.email)) return supplierOrg.email;
  return isMailbox(storedEmail) ? storedEmail : '';
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
