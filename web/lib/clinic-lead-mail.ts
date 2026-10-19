/**
 * Resend sender for the find-a-rep route. Never throws: a network error,
 * DNS failure or timeout comes back as { ok: false } so the caller's claim
 * release always runs.
 */
export const CLINIC_LEAD_EMAIL_TIMEOUT_MS = 10_000;

export type ResendMail = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export async function sendResendEmail(
  opts: ResendMail,
  cfg: { apiKey?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<{ ok: boolean; error?: string }> {
  const key = cfg.apiKey ?? process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const to = opts.to.filter(Boolean);
  if (!to.length) return { ok: false, error: 'No recipients' };
  const body: Record<string, unknown> = {
    from: opts.from,
    to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  };
  if (opts.replyTo) body.reply_to = opts.replyTo;
  const doFetch = cfg.fetchImpl ?? globalThis.fetch;
  try {
    const rr = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? CLINIC_LEAD_EMAIL_TIMEOUT_MS),
    });
    if (!rr.ok) {
      const result = (await rr.json().catch(() => ({}))) as { message?: string };
      return { ok: false, error: result?.message || `Email provider error (${rr.status})` };
    }
    return { ok: true };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, error: 'Email provider timed out' };
    return { ok: false, error: e instanceof Error ? e.message : 'Email provider unreachable' };
  }
}
