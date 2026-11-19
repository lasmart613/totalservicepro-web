/**
 * Every outgoing Resend message goes through this module.
 *
 * APP_MAIL_BCC is an optional blind copy for development and ops.
 * It is off unless the variable is set to one non-empty, valid email
 * address (surrounding whitespace is trimmed). Unset, blank, and invalid
 * values add no copy. Blank and invalid values log a warning that does
 * not include the value.
 * The address is only added as bcc. It is never written into to or cc.
 *
 * Do not log the message body, the API key, or the BCC address from here.
 */

const MAILBOX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Static text so a bad APP_MAIL_BCC can never be written into the log. */
export const OPS_BCC_IGNORED_WARNING =
  'APP_MAIL_BCC is set but blank or not a valid email; outgoing mail will not include a blind copy.';

type EnvLike = {
  APP_MAIL_BCC?: string | undefined;
  [key: string]: string | undefined;
};

export type ResendFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<Response>;

function processEnv(): EnvLike | undefined {
  const proc = (globalThis as { process?: { env?: EnvLike } }).process;
  return proc?.env;
}

function mailboxList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(mailboxList);
  const text = String(value ?? '').trim();
  if (!text) return [];
  return text.split(/[,;\s]+/).map((part) => part.trim()).filter(Boolean);
}

function bareMailbox(value: string): string {
  const wrapped = value.match(/<([^>]+)>/);
  return (wrapped ? wrapped[1] : value).trim().toLowerCase();
}

function warnIgnoredMailBcc(): void {
  console.warn(OPS_BCC_IGNORED_WARNING);
}

/**
 * Blind-copy address from APP_MAIL_BCC, or null when the copy is off.
 * Null covers unset, blank, and invalid. Only blank and invalid warn.
 */
export function opsBccAddress(env?: EnvLike): string | null {
  const source = env ?? processEnv();
  const raw = source?.APP_MAIL_BCC;
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || !MAILBOX.test(trimmed)) {
    warnIgnoredMailBcc();
    return null;
  }
  return trimmed;
}

/**
 * Copy of a Resend payload with the ops address on bcc when it is not
 * already a recipient. to, cc, from, and reply_to are left as given.
 * When the copy is off, the payload is returned unchanged.
 */
export function withOpsBcc<T extends Record<string, unknown>>(message: T, env?: EnvLike): T {
  const bcc = opsBccAddress(env);
  if (!bcc) return message;
  const already = new Set(
    [...mailboxList(message.to), ...mailboxList(message.cc), ...mailboxList(message.bcc)].map(bareMailbox)
  );
  if (already.has(bcc.toLowerCase())) return message;
  const prior = mailboxList(message.bcc);
  return { ...message, bcc: [...prior, bcc] };
}

/** POST one message to Resend. The ops bcc is applied here. */
export async function postResendEmail(opts: {
  apiKey: string;
  message: Record<string, unknown>;
  fetchImpl?: ResendFetch;
  signal?: AbortSignal;
  env?: EnvLike;
}): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as ResendFetch);
  const message = withOpsBcc(opts.message, opts.env);
  return fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
    signal: opts.signal,
  });
}
