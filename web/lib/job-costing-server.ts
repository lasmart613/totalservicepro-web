/**
 * Server-only loader for Job Costing.
 * Authorizes with the caller's JWT, then reads that organization's rows.
 * Does not use the service role and does not write.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { membershipRoleForActiveOrg } from './job-costing-access.ts';
import { decideJobCostingAccess } from './job-costing-auth.ts';
import { assembleJobCostReport, type JobCostReport } from './job-costing.ts';
import { loadJobCostSources, type JobCostClient } from './job-costing-load.ts';

export type AuthorizedJobCostReport =
  | { ok: true; report: JobCostReport }
  | { ok: false; status: 401 | 403 | 500; error: string };

function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
}

function supabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
}

export function userClientForToken(token: string): SupabaseClient | null {
  const url = supabaseUrl();
  const anon = supabaseAnonKey();
  if (!url || !anon || !token) return null;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function organizationName(
  client: SupabaseClient,
  organizationId: string | number
): Promise<string | null> {
  const { data, error } = await client
    .from('organizations')
    .select('name')
    .eq('id', organizationId)
    .maybeSingle();
  if (error || !data) return null;
  const name = String((data as { name?: string | null }).name || '').trim();
  return name || null;
}

const NO_ORG = 'This login has no active organization, so shop rows cannot be scoped.';

export async function loadAuthorizedJobCostReport(token: string): Promise<AuthorizedJobCostReport> {
  const client = userClientForToken(token);
  if (!client) {
    return { ok: false, status: 500, error: 'Server misconfigured' };
  }

  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser(token);
  if (userError || !user) {
    return { ok: false, status: 401, error: 'Sign in required' };
  }

  const { data: profile } = await client
    .from('user_profiles')
    .select('role, organization_id, active_organization_id')
    .eq('id', user.id)
    .maybeSingle();

  const activeOrganizationId = profile?.active_organization_id ?? profile?.organization_id ?? null;

  const { data: membershipRows } = await client
    .from('organization_memberships')
    .select('role, organization_id')
    .eq('user_id', user.id);

  const membershipRole = membershipRoleForActiveOrg(membershipRows || [], activeOrganizationId);
  const access = decideJobCostingAccess({
    user: { id: user.id, email: user.email },
    profileRole: profile?.role,
    activeOrganizationId,
    membershipRole,
  });
  if (!access.ok) return access;

  if (access.organizationId == null) {
    return {
      ok: true,
      report: assembleJobCostReport({
        organizationId: null,
        organizationName: null,
        tickets: null,
        ticketIssue: NO_ORG,
        labor: null,
        laborIssue: NO_ORG,
        wageColumnsPresent: false,
        parts: null,
        partsIssue: NO_ORG,
        estimates: null,
        estimateIssue: NO_ORG,
        invoices: null,
        invoiceIssue: NO_ORG,
      }),
    };
  }

  const [name, sources] = await Promise.all([
    organizationName(client, access.organizationId),
    loadJobCostSources(client as unknown as JobCostClient, access.organizationId),
  ]);

  return {
    ok: true,
    report: assembleJobCostReport({
      organizationId: access.organizationId,
      organizationName: name,
      ...sources,
    }),
  };
}
