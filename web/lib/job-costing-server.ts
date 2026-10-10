/**
 * Server-only loader for Job Costing.
 * Authorizes with the caller's JWT, then reads that organization's rows.
 * Does not use the service role and does not write.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { decideJobCostingAccess } from './job-costing-auth.ts';
import { getOrgRole, ORG_ROLE_LOOKUP_ERROR, reportingOrganizationId } from './org-role.ts';
import { assembleJobCostReport, type JobCostReport } from './job-costing.ts';
import { loadJobCostSources, type JobCostClient } from './job-costing-load.ts';
import { loadOrganizationFinanceSettings } from './org-money.ts';
import { gateJobCostingPlan } from './report-tier.ts';

export type AuthorizedJobCostReport =
  | { ok: true; report: JobCostReport }
  | { ok: false; status: 401 | 402 | 403 | 500 | 503; error: string };

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

  const { data: profile, error: profileError } = await client
    .from('user_profiles')
    .select('organization_id, active_organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) {
    return { ok: false, status: 503, error: ORG_ROLE_LOOKUP_ERROR };
  }

  const activeOrganizationId = reportingOrganizationId(profile);
  const orgRole = await getOrgRole(client, user.id, activeOrganizationId);
  if (!orgRole.ok) return { ok: false, status: orgRole.status, error: orgRole.error };

  const access = decideJobCostingAccess({
    user: { id: user.id, email: user.email },
    membershipRole: orgRole.role,
    isPlatformAdmin: orgRole.isPlatformAdmin,
    activeOrganizationId,
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

  const settings = await loadOrganizationFinanceSettings(client, access.organizationId);
  const planGate = gateJobCostingPlan({
    plan: settings.plan,
    planKnown: settings.planKnown,
    god: access.god,
  });
  if (!planGate.ok) return { ok: false, status: planGate.status, error: planGate.error };

  const sources = await loadJobCostSources(client as unknown as JobCostClient, access.organizationId);

  return {
    ok: true,
    report: assembleJobCostReport({
      organizationId: access.organizationId,
      organizationName: settings.name,
      currencyCode: settings.prefs.currencyCode,
      numberFormat: settings.prefs.numberFormat,
      ...sources,
    }),
  };
}
