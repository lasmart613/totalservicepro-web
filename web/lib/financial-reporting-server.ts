/**
 * Server-only loader for Financial Reporting.
 * Authorizes with the caller's JWT, then reads that organization's rows.
 * Does not use the service role and does not write.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { membershipRoleForActiveOrg } from './financial-reporting-access.ts';
import { decideFinancialAccess } from './financial-reporting-auth.ts';
import {
  assembleFinancialReport,
  EMPTY_INVOICE_COLUMNS,
  presentFinancialReport,
  type FinancialReport,
} from './financial-reporting.ts';
import { loadShopFinancialSources, type FinanceClient } from './financial-reporting-load.ts';
import { loadOrganizationFinanceSettings } from './org-money.ts';
import { gateFinancialDetail } from './report-tier.ts';

export type AuthorizedFinancialReport =
  | { ok: true; report: FinancialReport }
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

export async function loadAuthorizedFinancialReport(
  token: string,
  options?: { detailRequested?: boolean }
): Promise<AuthorizedFinancialReport> {
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
  const access = decideFinancialAccess({
    user: { id: user.id, email: user.email },
    profileRole: profile?.role,
    activeOrganizationId,
    membershipRole,
  });
  if (!access.ok) return access;

  if (access.organizationId == null) {
    return {
      ok: true,
      report: assembleFinancialReport({
        organizationId: null,
        organizationName: null,
        invoices: null,
        invoiceIssue: 'This login has no active organization, so shop invoices cannot be scoped.',
        invoiceColumns: EMPTY_INVOICE_COLUMNS,
        purchaseOrders: null,
        purchaseOrderIssue: 'This login has no active organization, so purchase orders cannot be scoped.',
        estimates: null,
        estimateIssue: 'This login has no active organization, so estimates cannot be scoped.',
      }),
    };
  }

  const settings = await loadOrganizationFinanceSettings(client, access.organizationId);
  const gate = gateFinancialDetail({
    plan: settings.plan,
    planKnown: settings.planKnown,
    god: access.god,
    detailRequested: options?.detailRequested === true,
  });
  if (!gate.ok) return { ok: false, status: gate.status, error: gate.error };

  const sources = await loadShopFinancialSources(client as unknown as FinanceClient, access.organizationId);

  return {
    ok: true,
    report: presentFinancialReport(
      assembleFinancialReport({
        organizationId: access.organizationId,
        organizationName: settings.name,
        currencyCode: settings.prefs.currencyCode,
        numberFormat: settings.prefs.numberFormat,
        ...sources,
      }),
      gate.detail
    ),
  };
}
