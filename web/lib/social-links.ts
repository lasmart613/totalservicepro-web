/**
 * Customer CRM social profile URLs.
 * Stored on `organizations` as optional text columns. Accepts a full URL or
 * an @handle / bare handle and normalizes to that network's canonical URL.
 * Website stays on `organizations.website` — it is not a social row.
 */

import { ownerLabelKind } from './labels.ts';

export type SocialNetworkKey =
  | 'x'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'youtube'
  | 'linkedin'
  | 'yelp'
  | 'threads';

export type SocialColumn = `${SocialNetworkKey}_url`;

export type SocialFormFields = Record<SocialColumn, string>;

export type SocialNetwork = {
  key: SocialNetworkKey;
  column: SocialColumn;
  label: string;
  placeholder: string;
  /** LinkedIn + Yelp are for laser-clinic / medical-practice customers. */
  clinicOnly?: boolean;
};

export const SOCIAL_NETWORKS: readonly SocialNetwork[] = [
  { key: 'x', column: 'x_url', label: 'X', placeholder: '@handle or https://x.com/…' },
  {
    key: 'instagram',
    column: 'instagram_url',
    label: 'Instagram',
    placeholder: '@handle or https://instagram.com/…',
  },
  {
    key: 'facebook',
    column: 'facebook_url',
    label: 'Facebook',
    placeholder: 'facebook.com/page or @handle',
  },
  {
    key: 'tiktok',
    column: 'tiktok_url',
    label: 'TikTok',
    placeholder: '@handle or https://tiktok.com/@…',
  },
  {
    key: 'youtube',
    column: 'youtube_url',
    label: 'YouTube',
    placeholder: '@handle or https://youtube.com/@…',
  },
  {
    key: 'linkedin',
    column: 'linkedin_url',
    label: 'LinkedIn',
    placeholder: 'company page or @handle',
    clinicOnly: true,
  },
  {
    key: 'yelp',
    column: 'yelp_url',
    label: 'Yelp',
    placeholder: 'yelp.com/biz/…',
    clinicOnly: true,
  },
  {
    key: 'threads',
    column: 'threads_url',
    label: 'Threads',
    placeholder: '@handle or https://threads.net/@…',
  },
];

export const SOCIAL_COLUMNS = SOCIAL_NETWORKS.map((n) => n.column);

const HANDLE_MAX = 128;
const URL_MAX = 2000;

function emptySocialFormFields(): SocialFormFields {
  return Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n.column, ''])) as SocialFormFields;
}

export function emptySocialFields(): SocialFormFields {
  return emptySocialFormFields();
}

export function socialFieldsFromOrg(
  org?: Record<string, unknown> | null
): SocialFormFields {
  const next = emptySocialFormFields();
  if (!org) return next;
  for (const n of SOCIAL_NETWORKS) {
    const v = org[n.column];
    next[n.column] = typeof v === 'string' ? v : '';
  }
  return next;
}

export function isClinicCustomerType(orgType?: string | null): boolean {
  return ownerLabelKind(orgType) === 'clinic';
}

export function visibleSocialNetworks(
  orgType?: string | null,
  values?: Partial<SocialFormFields>
): SocialNetwork[] {
  const clinic = isClinicCustomerType(orgType);
  return SOCIAL_NETWORKS.filter((n) => {
    if (!n.clinicOnly) return true;
    if (clinic) return true;
    return Boolean(values?.[n.column]?.trim());
  });
}

function extractHandle(raw: string): string | null {
  let s = raw.trim();
  s = s.replace(/^@+/, '');
  s = s.replace(/^\/+/, '');
  s = s.split(/\s+/)[0] || '';
  s = s.split(/[?#]/)[0] || '';
  s = s.replace(/\/+$/, '');
  if (!s || s.length > HANDLE_MAX) return null;
  if (/[<>"'\\\s]/.test(s)) return null;
  if (!/^[\w.@+/-]+$/.test(s)) return null;
  return s;
}

function looksLikeUrl(raw: string): boolean {
  if (/^https?:\/\//i.test(raw)) return true;
  return /^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(raw.trim());
}

function canonicalizeEnteredUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s || s.length > URL_MAX) return null;
  if (/^(javascript|data|vbscript|file):/i.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (/^(www\.)?twitter\.com$/i.test(parsed.hostname)) {
    parsed.hostname = 'x.com';
  }
  const href = parsed.toString();
  return href.length > URL_MAX ? null : href;
}

function handleUrl(network: SocialNetworkKey, handle: string): string {
  switch (network) {
    case 'x':
      return `https://x.com/${handle}`;
    case 'instagram':
      return `https://www.instagram.com/${handle}`;
    case 'facebook':
      return `https://www.facebook.com/${handle}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`;
    case 'youtube':
      return `https://www.youtube.com/@${handle}`;
    case 'linkedin':
      if (/^(in|company|school)\//i.test(handle)) {
        return `https://www.linkedin.com/${handle}`;
      }
      return `https://www.linkedin.com/company/${handle}`;
    case 'yelp':
      if (/^biz\//i.test(handle)) return `https://www.yelp.com/${handle}`;
      return `https://www.yelp.com/biz/${handle}`;
    case 'threads':
      return `https://www.threads.net/@${handle}`;
  }
}

/** Normalize a pasted URL or @handle to a safe http(s) URL, or null if blank/invalid. */
export function normalizeSocialUrl(network: SocialNetworkKey, raw?: string | null): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (looksLikeUrl(value)) return canonicalizeEnteredUrl(value);
  const handle = extractHandle(value);
  if (!handle) return null;
  return handleUrl(network, handle);
}

export function socialPayloadFromForm(
  form: Partial<SocialFormFields>
): Record<SocialColumn, string | null> {
  const out = {} as Record<SocialColumn, string | null>;
  for (const n of SOCIAL_NETWORKS) {
    out[n.column] = normalizeSocialUrl(n.key, form[n.column]);
  }
  return out;
}

export type FilledSocialLink = {
  key: SocialNetworkKey;
  label: string;
  href: string;
};

/** Links that have a usable URL — include clinic-only rows when they have a value. */
export function filledSocialLinks(
  values?: Partial<Record<SocialColumn, string | null | undefined>> | null
): FilledSocialLink[] {
  if (!values) return [];
  const out: FilledSocialLink[] = [];
  for (const n of SOCIAL_NETWORKS) {
    const href = normalizeSocialUrl(n.key, values[n.column]);
    if (href) out.push({ key: n.key, label: n.label, href });
  }
  return out;
}
