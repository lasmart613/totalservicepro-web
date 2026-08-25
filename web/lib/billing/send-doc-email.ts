/**
 * Client helper: POST invoice/estimate/report HTML to existing billing email APIs.
 */

export type SendDocResult = {
  ok: boolean;
  emailSent?: boolean;
  to?: string;
  error?: string;
  needsConfig?: boolean;
  paymentUrl?: string | null;
  stripeSkippedReason?: string | null;
  emailSource?: string;
};

export function isValidOnFileEmail(e: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
}

/** Same destination order as /api/billing/send-report (and estimate/invoice). */
export async function resolveCustomerEmailOnFile(opts: {
  supabase: { from: (table: string) => any };
  customerOrganizationId?: string | number | null;
  customerEmail?: string | null;
  customerName?: string | null;
}): Promise<{ email: string; source: 'crm_org' | 'crm_contact' | 'form' | 'none' }> {
  const formEmail = String(opts.customerEmail || '').trim();
  let orgId = opts.customerOrganizationId ?? null;

  try {
    if (!orgId && opts.customerName) {
      const { data } = await opts.supabase
        .from('organizations')
        .select('id, email')
        .eq('name', opts.customerName)
        .in('type', ['customer', 'laser_clinic', 'laser_rental', 'laser_reseller'])
        .maybeSingle();
      if (data?.id != null) orgId = data.id;
      if (data?.email && isValidOnFileEmail(data.email)) {
        return { email: String(data.email).trim(), source: 'crm_org' };
      }
    } else if (orgId) {
      const { data } = await opts.supabase
        .from('organizations')
        .select('id, email')
        .eq('id', orgId)
        .maybeSingle();
      if (data?.email && isValidOnFileEmail(data.email)) {
        return { email: String(data.email).trim(), source: 'crm_org' };
      }
    }

    if (orgId) {
      const { data: contacts } = await opts.supabase
        .from('contacts')
        .select('email, is_primary')
        .eq('organization_id', orgId)
        .not('email', 'is', null)
        .order('is_primary', { ascending: false })
        .limit(5);
      const pick = (contacts || []).find((c: { email?: string | null }) =>
        isValidOnFileEmail(c.email)
      );
      if (pick?.email) {
        return { email: String(pick.email).trim(), source: 'crm_contact' };
      }
    }
  } catch {
    /* fall through to job email */
  }

  if (isValidOnFileEmail(formEmail)) {
    return { email: formEmail, source: 'form' };
  }
  return { email: '', source: 'none' };
}

export async function sendBillingDocEmail(opts: {
  kind: 'invoice' | 'estimate' | 'report' | 'purchase_order';
  accessToken: string;
  payload: Record<string, unknown>;
}): Promise<SendDocResult> {
  const path =
    opts.kind === 'invoice'
      ? '/api/billing/send-invoice'
      : opts.kind === 'report'
        ? '/api/billing/send-report'
        : opts.kind === 'purchase_order'
          ? '/api/billing/send-purchase-order'
          : '/api/billing/send-estimate';

  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.accessToken}`,
      },
      body: JSON.stringify(opts.payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        emailSent: false,
        error: json?.error || `Send failed (${res.status})`,
        needsConfig: !!json?.needsConfig,
        paymentUrl: json?.paymentUrl ?? null,
        attemptedTo: json?.attemptedTo,
      } as SendDocResult & { attemptedTo?: string };
    }
    return {
      ok: !!json.ok,
      emailSent: !!json.emailSent,
      to: json.to,
      error: json.error,
      paymentUrl: json.paymentUrl ?? null,
      stripeSkippedReason: json.stripeSkippedReason ?? null,
      emailSource: json.emailSource,
    };
  } catch (e: any) {
    return {
      ok: false,
      emailSent: false,
      error: e?.message || 'Network error sending email',
    };
  }
}
