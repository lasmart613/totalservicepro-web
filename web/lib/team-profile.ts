import type { SupabaseClient } from '@supabase/supabase-js';
import { isFounderLockedRole } from '@/lib/org-membership';
import { upsertMembership } from '@/lib/org-membership-server';

export const AUTH_EMAIL_LOOKUP_PAGE_SIZE = 200;
export const AUTH_EMAIL_LOOKUP_MAX_PAGES = 20;

export type AuthUserRow = {
  id?: string | null;
  email?: string | null;
  last_sign_in_at?: string | null;
};

export type AuthEmailHit = {
  id: string;
  email: string | null;
  last_sign_in_at: string | null;
};

/** Exact email lookup. Never "nobody" when the check itself failed. */
export type AuthEmailLookup =
  | { status: 'found'; user: AuthEmailHit }
  | { status: 'not_found' }
  | { status: 'error' }
  | { status: 'ambiguous' };

type AuthTableResult = {
  data: AuthUserRow[] | null;
  error: { message?: string } | null;
};

export type AuthEmailLookupClient = {
  schema?: (schema: string) => {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => PromiseLike<AuthTableResult>;
      };
    };
  };
  auth?: {
    admin?: {
      getUserByEmail?: (email: string) => Promise<{
        data?: { user?: AuthUserRow | null } | null;
        error?: { message?: string } | null;
      }>;
    };
  };
};

export type AdminUserPageFetcher = (
  email: string,
  page: number,
  perPage: number,
) => Promise<{ users: AuthUserRow[] }>;

export type FindAuthUserDeps = {
  /** null skips the admin HTTP lookup. Omit to call GoTrue with the service role. */
  fetchAdminUsers?: AdminUserPageFetcher | null;
};

function normalizeAuthEmail(email: string): string {
  return String(email || '').toLowerCase().trim();
}

function toHit(row: AuthUserRow): AuthEmailHit | null {
  const id = String(row.id || '').trim();
  if (!id) return null;
  return {
    id,
    email: row.email ?? null,
    last_sign_in_at: row.last_sign_in_at ?? null,
  };
}

function classifyExact(rows: AuthUserRow[], email: string): AuthEmailLookup {
  const exact = rows.filter((row) => normalizeAuthEmail(row.email || '') === email);
  if (exact.some((row) => !String(row.id || '').trim())) return { status: 'error' };
  const hits: AuthEmailHit[] = [];
  for (const row of exact) {
    const hit = toHit(row);
    if (hit) hits.push(hit);
  }
  const ids = new Set(hits.map((hit) => hit.id));
  if (ids.size > 1) return { status: 'ambiguous' };
  if (ids.size === 1) return { status: 'found', user: hits[0] };
  return { status: 'not_found' };
}

function mergeLookups(parts: Array<AuthEmailLookup | 'unavailable'>): AuthEmailLookup {
  const results = parts.filter((part): part is AuthEmailLookup => part !== 'unavailable');
  if (!results.length) return { status: 'error' };
  if (results.some((part) => part.status === 'ambiguous')) return { status: 'ambiguous' };

  const found = results.filter((part): part is Extract<AuthEmailLookup, { status: 'found' }> => part.status === 'found');
  if (found.length) {
    const ids = new Set(found.map((part) => part.user.id));
    if (ids.size > 1) return { status: 'ambiguous' };
    return found[0];
  }
  if (results.some((part) => part.status === 'error')) return { status: 'error' };
  if (results.every((part) => part.status === 'not_found')) return { status: 'not_found' };
  return { status: 'error' };
}

async function lookupByAdminGetter(
  admin: AuthEmailLookupClient,
  email: string,
): Promise<AuthEmailLookup | 'unavailable'> {
  const getter = admin.auth?.admin?.getUserByEmail;
  if (typeof getter !== 'function') return 'unavailable';
  try {
    const result = await getter.call(admin.auth?.admin, email);
    if (!result || result.error) return { status: 'error' };
    const user = result.data?.user;
    if (!user) return { status: 'not_found' };
    if (normalizeAuthEmail(user.email || '') !== email) return { status: 'error' };
    return classifyExact([user], email);
  } catch {
    return { status: 'error' };
  }
}

async function lookupAuthTable(
  admin: AuthEmailLookupClient,
  email: string,
): Promise<AuthEmailLookup | 'unavailable'> {
  if (typeof admin.schema !== 'function') return 'unavailable';
  try {
    const result = await admin
      .schema('auth')
      .from('users')
      .select('id, email, last_sign_in_at')
      .eq('email', email);
    if (!result || result.error || !Array.isArray(result.data)) return 'unavailable';
    return classifyExact(result.data, email);
  } catch {
    return 'unavailable';
  }
}

async function defaultFetchAdminUsers(
  email: string,
  page: number,
  perPage: number,
): Promise<{ users: AuthUserRow[] }> {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !key) {
    throw new Error('missing supabase admin configuration');
  }
  const endpoint = new URL(`${base}/auth/v1/admin/users`);
  endpoint.searchParams.set('filter', email);
  endpoint.searchParams.set('page', String(page));
  endpoint.searchParams.set('per_page', String(perPage));
  const response = await fetch(endpoint.toString(), {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`admin users lookup failed (${response.status})`);
  }
  const payload = (await response.json()) as { users?: AuthUserRow[] };
  if (!Array.isArray(payload?.users)) {
    throw new Error('admin users lookup payload');
  }
  return { users: payload.users };
}

async function lookupAdminFilter(
  email: string,
  fetchAdminUsers: AdminUserPageFetcher,
): Promise<AuthEmailLookup | 'unavailable'> {
  const matches: AuthUserRow[] = [];
  try {
    for (let page = 1; page <= AUTH_EMAIL_LOOKUP_MAX_PAGES; page += 1) {
      const batch = await fetchAdminUsers(email, page, AUTH_EMAIL_LOOKUP_PAGE_SIZE);
      const users = batch?.users;
      if (!Array.isArray(users)) return { status: 'error' };
      for (const user of users) {
        if (normalizeAuthEmail(user?.email || '') === email) matches.push(user);
      }
      if (users.length < AUTH_EMAIL_LOOKUP_PAGE_SIZE) return classifyExact(matches, email);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/missing supabase admin configuration/i.test(message)) return 'unavailable';
    return { status: 'error' };
  }
  // Filter pages never ended, so absence is not proven.
  return { status: 'error' };
}

/**
 * Find an auth user by exact email.
 * Uses an admin get-by-email method when the client has one, an exact
 * `auth.users` equality query, and GoTrue's admin users filter. A paging
 * scan of the first 2,000 users is not a lookup. Errors and unfinished
 * scans fail closed (`status: 'error'`), and more than one exact row is
 * `ambiguous`.
 */
export async function findAuthUserByEmail(
  admin: SupabaseClient | AuthEmailLookupClient,
  email: string,
  deps?: FindAuthUserDeps,
): Promise<AuthEmailLookup> {
  const client = admin as AuthEmailLookupClient;
  const clean = normalizeAuthEmail(email);
  if (!clean || !clean.includes('@')) return { status: 'error' };

  const fetcher =
    deps && 'fetchAdminUsers' in deps ? deps.fetchAdminUsers : defaultFetchAdminUsers;

  const [byGetter, byTable, byFilter] = await Promise.all([
    lookupByAdminGetter(client, clean),
    lookupAuthTable(client, clean),
    fetcher ? lookupAdminFilter(clean, fetcher) : Promise.resolve('unavailable' as const),
  ]);

  return mergeLookups([byGetter, byTable, byFilter]);
}

export type EnsureProfileInput = {
  userId: string;
  email: string;
  organizationId: number | string;
  role?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  /** false = show light member onboarding; true = skip */
  onboardingCompleted?: boolean;
};

/**
 * Create or update user_profiles for an invited team member (service role).
 * If they already have another org, add a membership instead of overwriting.
 */
export async function ensureTeamMemberProfile(
  admin: SupabaseClient,
  input: EnsureProfileInput
): Promise<{ ok: boolean; error?: string; moonlight?: boolean }> {
  const { data: existing } = await admin
    .from('user_profiles')
    .select('id, organization_id, role')
    .eq('id', input.userId)
    .maybeSingle();

  const inviteRole = (input.role || 'fse').toLowerCase();
  const otherOrg =
    existing?.organization_id != null &&
    String(existing.organization_id) !== String(input.organizationId);

  const mem = await upsertMembership(admin, {
    userId: input.userId,
    organizationId: input.organizationId,
    role: inviteRole,
    isHome: false,
  });
  if (!mem.ok) return { ok: false, error: mem.error };

  if (otherOrg) {
    // Moonlight: keep home org + founder role on the profile pointer.
    return { ok: true, moonlight: true };
  }

  if (existing?.organization_id && isFounderLockedRole(existing.role)) {
    return { ok: true, moonlight: false };
  }

  const row: Record<string, unknown> = {
    id: input.userId,
    email: input.email.toLowerCase().trim(),
    organization_id: input.organizationId,
    active_organization_id: input.organizationId,
    role: inviteRole,
    onboarding_completed: input.onboardingCompleted ?? false,
  };
  if (input.firstName) row.first_name = input.firstName;
  if (input.lastName) row.last_name = input.lastName;
  if (input.jobTitle) row.job_title = input.jobTitle;

  const { error } = await admin.from('user_profiles').upsert(row, { onConflict: 'id' });
  if (error) {
    console.error('ensureTeamMemberProfile', error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
