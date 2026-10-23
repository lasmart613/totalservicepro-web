/**
 * CRM email: "Send from your own domain" (000941), behind CRM_EMAIL_ENABLED.
 *
 * An org owner / company_admin / admin adds a domain. The server creates it in
 * our Resend account (POST /domains), stores the id, status and the DNS records
 * from the response, and shows the records so the org adds them at ITS OWN DNS
 * host. We never touch any DNS. Verify = POST /domains/{id}/verify (rate
 * limited in the DB, 1 per 30s and 10 per hour per org) then GET /domains/{id}.
 * Polling = GET /domains/{id}, at most once per 15s per org (cached otherwise).
 * Once verified, CRM email from a user whose address is exactly @thatdomain is
 * sent From that address. Everyone else keeps the shared fallback.
 *
 * Env: RESEND_DOMAINS_API_KEY (full-access Resend key; optional, falls back to
 * RESEND_API_KEY), CRM_EMAIL_INTERNAL_ORG_IDS (comma list of org ids allowed to
 * add medicalrepairnetwork.com / totalservicepro domains; default none).
 * repairplanet.net is refused for everyone.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { crmEmailEnabled } from './flags.ts';

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
type Db = Pick<SupabaseClient, 'from' | 'rpc'>;

export const DOMAIN_MANAGER_ROLES = ['owner', 'company_admin', 'admin'] as const;
export const POLL_MIN_SECONDS = 15;
export const RESEND_DOMAIN_STATUSES = [
  'not_started',
  'pending',
  'verified',
  'partially_verified',
  'partially_failed',
  'failed',
  'temporary_failure',
] as const;
export type ResendDomainStatus = (typeof RESEND_DOMAIN_STATUSES)[number];

export type DnsRecord = { record: string; name: string; type: string; value: string; ttl: string; status: string; priority?: number };

export type OrgDomainRow = {
  organization_id: number;
  resend_domain_id: string;
  domain_name: string;
  status: ResendDomainStatus;
  region: string | null;
  records: DnsRecord[];
  checked_at: string | null;
};

/** Always refused (our product domain). */
const BLOCKED_ALWAYS = ['repairplanet.net'];
/** Our company domains: only orgs listed in CRM_EMAIL_INTERNAL_ORG_IDS. */
const INTERNAL_DOMAINS = ['medicalrepairnetwork.com', 'totalservicepro.com', 'totalservicepro.net', 'totalservicepro.app'];
/** Shared mailbox / hosting domains no org can own. */
const SHARED_DOMAINS = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'zoho.com',
  'mail.com', 'yandex.com', 'comcast.net', 'att.net', 'verizon.net', 'sbcglobal.net', 'cox.net',
  'onmicrosoft.com', 'netlify.app', 'vercel.app', 'resend.dev', 'resend.com', 'supabase.co', 'github.io',
];
const RESERVED_TLDS = ['local', 'localhost', 'test', 'example', 'invalid', 'internal', 'lan', 'home', 'corp'];

const under = (d: string, base: string) => d === base || d.endsWith(`.${base}`);

export function internalOrgIds(env: Env = process.env): number[] {
  return String(env.CRM_EMAIL_INTERNAL_ORG_IDS || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

export type DomainCheck = { ok: true; domain: string } | { ok: false; code: string; error: string };

/** Normalize + validate a domain the org typed (accepts "https://x.com/", "@x.com", "user@x.com"). */
export function validateSendingDomain(raw: unknown, orgId: number, env: Env = process.env): DomainCheck {
  let d = String(raw ?? '').trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '');
  if (d.includes('@')) d = d.slice(d.lastIndexOf('@') + 1);
  d = d.replace(/\.$/, '');
  const bad = (code: string, error: string): DomainCheck => ({ ok: false, code, error });
  if (!d) return bad('domain_required', 'Enter your domain, for example yourcompany.com.');
  if (d.length > 253 || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) {
    return bad('domain_invalid', 'That is not a valid domain name.');
  }
  if (d.startsWith('xn--') || d.includes('.xn--')) return bad('domain_invalid', 'International (xn--) domains are not supported yet.');
  const tld = d.slice(d.lastIndexOf('.') + 1);
  if (RESERVED_TLDS.includes(tld)) return bad('domain_invalid', 'That is not a public domain name.');
  if (BLOCKED_ALWAYS.some((b) => under(d, b))) return bad('domain_blocked', 'RepairPlanet domains cannot be added.');
  if (INTERNAL_DOMAINS.some((b) => under(d, b)) && !internalOrgIds(env).includes(orgId)) {
    return bad('domain_blocked', 'This domain cannot be added to your organization.');
  }
  if (SHARED_DOMAINS.some((b) => under(d, b))) {
    return bad('domain_shared', 'Shared email domains (like gmail.com) cannot be verified. Use your company domain.');
  }
  return { ok: true, domain: d };
}

export function domainsApiKey(env: Env = process.env): string {
  return String(env.RESEND_DOMAINS_API_KEY || env.RESEND_API_KEY || '').trim();
}

export function ownDomainEnabled(env: Env = process.env): boolean {
  return crmEmailEnabled(env) && Boolean(domainsApiKey(env));
}

function normStatus(s: unknown): ResendDomainStatus {
  const v = String(s || '');
  return (RESEND_DOMAIN_STATUSES as readonly string[]).includes(v) ? (v as ResendDomainStatus) : 'pending';
}

/** Keep only the record fields we show (from the Resend response). */
export function cleanRecords(raw: unknown): DnsRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).map((r: any) => {
    const out: DnsRecord = {
      record: String(r?.record ?? '').slice(0, 40),
      name: String(r?.name ?? '').slice(0, 255),
      type: String(r?.type ?? '').slice(0, 10),
      value: String(r?.value ?? '').slice(0, 2048),
      ttl: String(r?.ttl ?? 'Auto').slice(0, 20),
      status: String(r?.status ?? '').slice(0, 40),
    };
    if (Number.isFinite(Number(r?.priority)) && r?.priority != null) out.priority = Number(r.priority);
    return out;
  });
}

type ResendDomain = { id: string; name: string; status: ResendDomainStatus; region: string | null; records: DnsRecord[] };
type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

async function resendCall<T>(key: string, method: string, path: string, body: unknown, fetchImpl: Fetch): Promise<ApiResult<T>> {
  try {
    const r = await fetchImpl(`https://api.resend.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as any;
    if (!r.ok) return { ok: false, status: r.status, message: String(j?.message || j?.name || `resend_${r.status}`).slice(0, 200) };
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, status: 0, message: 'resend_unreachable' };
  }
}

function toDomain(j: any): ResendDomain {
  return { id: String(j?.id || ''), name: String(j?.name || ''), status: normStatus(j?.status), region: j?.region ? String(j.region) : null, records: cleanRecords(j?.records) };
}

export const resendDomains = {
  async create(key: string, name: string, fetchImpl: Fetch = fetch): Promise<ApiResult<ResendDomain>> {
    const r = await resendCall<any>(key, 'POST', '/domains', { name }, fetchImpl);
    return r.ok ? { ok: true, data: toDomain(r.data) } : r;
  },
  async get(key: string, id: string, fetchImpl: Fetch = fetch): Promise<ApiResult<ResendDomain>> {
    const r = await resendCall<any>(key, 'GET', `/domains/${encodeURIComponent(id)}`, null, fetchImpl);
    return r.ok ? { ok: true, data: toDomain(r.data) } : r;
  },
  async verify(key: string, id: string, fetchImpl: Fetch = fetch): Promise<ApiResult<{ id: string }>> {
    return resendCall<{ id: string }>(key, 'POST', `/domains/${encodeURIComponent(id)}/verify`, null, fetchImpl);
  },
  async remove(key: string, id: string, fetchImpl: Fetch = fetch): Promise<ApiResult<{ deleted?: boolean }>> {
    return resendCall<{ deleted?: boolean }>(key, 'DELETE', `/domains/${encodeURIComponent(id)}`, null, fetchImpl);
  },
};

export async function loadOrgDomain(admin: Db, orgId: number): Promise<OrgDomainRow | null> {
  const { data, error } = await admin
    .from('org_sending_domains')
    .select('organization_id, resend_domain_id, domain_name, status, region, records, checked_at')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error || !data) return null;
  return { ...(data as OrgDomainRow), records: cleanRecords((data as any).records) };
}

export async function canManageDomain(admin: Db, userId: string, orgId: number): Promise<boolean> {
  const { data, error } = await admin
    .from('organization_memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('organization_id', orgId);
  if (error) return false;
  return ((data || []) as { role?: string }[]).some((m) =>
    (DOMAIN_MANAGER_ROLES as readonly string[]).includes(String(m.role || '').trim().toLowerCase())
  );
}

/** Address the user may send as through the org's verified domain, or ''. Exact domain match only. */
export function ownDomainSender(addresses: string[], row: Pick<OrgDomainRow, 'domain_name' | 'status'> | null): string {
  if (!row || row.status !== 'verified') return '';
  const dom = String(row.domain_name || '').toLowerCase();
  return addresses.find((a) => a.slice(a.lastIndexOf('@') + 1).toLowerCase() === dom) || '';
}

export function publicDomain(row: OrgDomainRow | null) {
  if (!row) return null;
  return { domain: row.domain_name, status: row.status, region: row.region, records: row.records, checkedAt: row.checked_at };
}
