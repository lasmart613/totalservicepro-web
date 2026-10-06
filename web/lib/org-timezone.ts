/**
 * Organization timezone for document numbers, email dates, and report headers.
 *
 * Resolution order:
 * 1. organizations.timezone (IANA), when the column is present and valid
 * 2. A zone derived from organizations.state (so shops work before the column is applied)
 * 3. The browser timezone, only for UI calls that pass one or run in the browser
 * 4. America/Los_Angeles
 *
 * Multi-timezone states use the zone of the largest metro (Texas → Chicago, Florida → New York).
 */

export const DEFAULT_ORG_TIMEZONE = 'America/Los_Angeles';

export type OrgTimeZoneSource = 'organization' | 'state' | 'browser' | 'default';

export type ResolvedOrgTimeZone = {
  timeZone: string;
  source: OrgTimeZoneSource;
};

export const ORG_TIME_ZONE_CHOICES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

/** USPS abbreviation → IANA zone. */
const STATE_TIME_ZONE: Record<string, string> = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DC: 'America/New_York',
  DE: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  IA: 'America/Chicago',
  ID: 'America/Boise',
  IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis',
  KS: 'America/Chicago',
  KY: 'America/New_York',
  LA: 'America/Chicago',
  MA: 'America/New_York',
  MD: 'America/New_York',
  ME: 'America/New_York',
  MI: 'America/Detroit',
  MN: 'America/Chicago',
  MO: 'America/Chicago',
  MS: 'America/Chicago',
  MT: 'America/Denver',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  NE: 'America/Chicago',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NV: 'America/Los_Angeles',
  NY: 'America/New_York',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VA: 'America/New_York',
  VT: 'America/New_York',
  WA: 'America/Los_Angeles',
  WI: 'America/Chicago',
  WV: 'America/New_York',
  WY: 'America/Denver',
};

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
};

type ZoneClient = { from: (table: string) => any };

const COLUMN_MISSING = /column|schema cache|does not exist|PGRST204/i;

export function isValidTimeZone(value: unknown): boolean {
  const tz = String(value ?? '').trim();
  if (!tz || tz.length > 80) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Empty clears the setting. Invalid values are rejected. */
export function parseOrgTimeZone(
  value: unknown
): { ok: true; timezone: string | null } | { ok: false; error: string } {
  if (value == null || String(value).trim() === '' || String(value).trim().toLowerCase() === 'auto') {
    return { ok: true, timezone: null };
  }
  const tz = String(value).trim();
  if (!isValidTimeZone(tz)) {
    return { ok: false, error: 'Choose a valid timezone.' };
  }
  return { ok: true, timezone: tz };
}

export function timeZoneFromState(state: unknown): string | null {
  const raw = String(state ?? '').trim();
  if (!raw) return null;
  const code = raw.length === 2 ? raw.toUpperCase() : STATE_NAME_TO_CODE[raw.toLowerCase()] || '';
  return STATE_TIME_ZONE[code] || null;
}

/** Browser zone. Never call this for a server fallback — Node's zone is often UTC. */
export function browserTimeZone(): string | null {
  if (typeof Intl === 'undefined') return null;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimeZone(tz) ? tz : null;
  } catch {
    return null;
  }
}

export function resolveOrgTimeZone(input?: {
  stored?: string | null;
  state?: string | null;
  browserTimeZone?: string | null;
  allowBrowser?: boolean;
}): ResolvedOrgTimeZone {
  const stored = String(input?.stored ?? '').trim();
  if (stored && isValidTimeZone(stored)) {
    return { timeZone: stored, source: 'organization' };
  }
  const fromState = timeZoneFromState(input?.state);
  if (fromState) return { timeZone: fromState, source: 'state' };

  const allowBrowser = input?.allowBrowser !== false;
  const browser = String(input?.browserTimeZone ?? '').trim();
  if (allowBrowser && browser && isValidTimeZone(browser)) {
    return { timeZone: browser, source: 'browser' };
  }
  return { timeZone: DEFAULT_ORG_TIMEZONE, source: 'default' };
}

function zonedPart(date: Date, timeZone: string, type: 'year' | 'month' | 'day'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return parts.find((part) => part.type === type)?.value || '';
}

/** YYYYMMDD in an IANA zone. */
export function ymdInTimeZone(date: Date, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_ORG_TIMEZONE;
  return `${zonedPart(date, zone, 'year')}${zonedPart(date, zone, 'month')}${zonedPart(date, zone, 'day')}`;
}

/** YYYY-MM-DD in an IANA zone. */
export function isoDateInTimeZone(date: Date, timeZone: string): string {
  const ymd = ymdInTimeZone(date, timeZone);
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

/** Locale calendar date in an IANA zone. Date-only strings are not shifted. */
export function formatDateInTimeZone(value: Date | string | null | undefined, timeZone: string, locale = 'en-US'): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_ORG_TIMEZONE;
  const raw = value == null || value === '' ? null : value;
  let date: Date;
  if (raw == null) date = new Date();
  else if (raw instanceof Date) date = raw;
  else {
    const text = String(raw).trim();
    const day = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (day) date = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 12));
    else {
      date = new Date(text);
      if (Number.isNaN(date.getTime())) return text;
    }
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

export function timeZoneShortName(date: Date, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_ORG_TIMEZONE;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'short',
    }).formatToParts(date);
    return parts.find((part) => part.type === 'timeZoneName')?.value || zone;
  } catch {
    return zone;
  }
}

async function readOrgZoneRow(
  client: ZoneClient,
  orgId: string | number
): Promise<{ timezone?: string | null; state?: string | null } | null> {
  const selects = ['timezone, state', 'state', 'name'];
  for (const columns of selects) {
    try {
      const { data, error } = await client.from('organizations').select(columns).eq('id', orgId).maybeSingle();
      if (!error) {
        if (columns === 'name') return {};
        return (data || {}) as { timezone?: string | null; state?: string | null };
      }
      if (!COLUMN_MISSING.test(error.message || '')) break;
    } catch {
      break;
    }
  }
  return null;
}

/**
 * Zone for numbering, emails, and reports.
 * Browser fallback applies in the browser, or when the caller passes a browser zone
 * (the financial report request). Server calls without that argument stop at state, then Los Angeles.
 */
export async function resolveNumberingTimeZone(
  client: ZoneClient | null | undefined,
  orgId: string | number | null | undefined,
  options?: { browserTimeZone?: string | null; allowBrowser?: boolean }
): Promise<ResolvedOrgTimeZone> {
  let stored: string | null = null;
  let state: string | null = null;
  if (client && orgId != null && orgId !== '') {
    const row = await readOrgZoneRow(client, orgId);
    stored = row?.timezone ?? null;
    state = row?.state ?? null;
  }
  const inBrowser = typeof window !== 'undefined';
  const browser =
    options?.browserTimeZone ??
    (options?.allowBrowser === false ? null : inBrowser ? browserTimeZone() : null);
  const allowBrowser = options?.allowBrowser ?? (inBrowser || Boolean(options?.browserTimeZone));
  return resolveOrgTimeZone({
    stored,
    state,
    browserTimeZone: browser,
    allowBrowser,
  });
}
