/**
 * Client helper: POST invoice/estimate HTML to billing email APIs.
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
  actionToken?: string | null;
};

export async function sendBillingDocEmail(opts: {
  kind: 'invoice' | 'estimate';
  accessToken: string;
  payload: Record<string, unknown>;
}): Promise<SendDocResult> {
  const path =
    opts.kind === 'invoice'
      ? '/api/billing/send-invoice'
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
      actionToken: json.actionToken ?? null,
    };
  } catch (e: any) {
    return {
      ok: false,
      emailSent: false,
      error: e?.message || 'Network error sending email',
    };
  }
}
