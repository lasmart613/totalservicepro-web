/**
 * Load and validate organization display currency.
 * Reads tolerate missing columns and fall back to USD / locale format.
 */

import { isAdmin, normalizeRole, type RoleLike } from './roles.ts';
import type { OrgPlanFields } from './org-plan.ts';
import {
  DEFAULT_ORG_MONEY,
  parseCurrencyCode,
  parseNumberFormat,
  resolveOrgMoneyPrefs,
  type OrgMoneyPrefs,
} from './money-format.ts';

export type { OrgMoneyPrefs };

type QueryError = { message?: string } | null;

/**
 * Structural client. The query chain is `any` so a Supabase client
 * (a thenable builder, not a Promise) does not fail type instantiation.
 */
export type OrgMoneyClient = {
  from: (table: string) => any;
};

const COLUMN_MISSING = /column|schema cache|does not exist|PGRST204/i;

const MONEY_SELECTS = ['currency_code, number_format', 'currency_code', 'name'] as const;

const FINANCE_SELECTS = [
  'name, currency_code, number_format, is_premium, subscription_tier, plan, premium_until, premium_grant',
  'name, currency_code, number_format, is_premium, subscription_tier, plan, premium_until',
  'name, currency_code, number_format, is_premium, subscription_tier, plan',
  'name, is_premium, subscription_tier, plan, premium_until, premium_grant',
  'name, is_premium, subscription_tier, plan',
  'name, is_premium',
  'name',
] as const;

export type OrganizationFinanceSettings = {
  name: string | null;
  prefs: OrgMoneyPrefs;
  plan: OrgPlanFields | null;
  planKnown: boolean;
};

function selectHasPlan(columns: string): boolean {
  return /\bis_premium\b/.test(columns);
}

/**
 * Owner or admin (admin ≡ company_admin) may change currency.
 * Uses the profile role, the same source as company profile saves.
 * Membership roles are not consulted: those can be self-escalated.
 */
export function canEditOrgCurrency(role?: RoleLike): boolean {
  return isAdmin(role) || normalizeRole(role) === 'owner';
}

export async function loadOrgMoneyPrefs(
  client: OrgMoneyClient,
  orgId: string | number | null | undefined
): Promise<OrgMoneyPrefs> {
  if (orgId == null || orgId === '') return { ...DEFAULT_ORG_MONEY };
  for (const columns of MONEY_SELECTS) {
    try {
      const { data, error } = await client.from('organizations').select(columns).eq('id', orgId).maybeSingle();
      if (!error) {
        if (columns === 'name') return { ...DEFAULT_ORG_MONEY };
        return resolveOrgMoneyPrefs(data);
      }
      if (!COLUMN_MISSING.test(error.message || '')) break;
    } catch {
      break;
    }
  }
  return { ...DEFAULT_ORG_MONEY };
}

export async function loadOrganizationFinanceSettings(
  client: OrgMoneyClient,
  orgId: string | number | null | undefined
): Promise<OrganizationFinanceSettings> {
  const empty: OrganizationFinanceSettings = {
    name: null,
    prefs: { ...DEFAULT_ORG_MONEY },
    plan: null,
    planKnown: false,
  };
  if (orgId == null || orgId === '') return empty;
  for (const columns of FINANCE_SELECTS) {
    try {
      const { data, error } = await client.from('organizations').select(columns).eq('id', orgId).maybeSingle();
      if (!error) {
        const row = data || {};
        const planKnown = selectHasPlan(columns);
        return {
          name: row.name != null && String(row.name).trim() ? String(row.name) : null,
          prefs: columns.includes('currency_code') ? resolveOrgMoneyPrefs(row) : { ...DEFAULT_ORG_MONEY },
          plan: planKnown
            ? {
                is_premium: row.is_premium as boolean | null | undefined,
                subscription_tier: (row.subscription_tier as string | null) ?? null,
                plan: (row.plan as string | null) ?? null,
                premium_until: (row.premium_until as string | null) ?? null,
                premium_grant: (row.premium_grant as string | null) ?? null,
              }
            : null,
          planKnown,
        };
      }
      if (!COLUMN_MISSING.test(error.message || '')) break;
    } catch {
      break;
    }
  }
  return empty;
}

export type OrgMoneyFieldResult =
  | { ok: true; fields: { currency_code?: string; number_format?: string } }
  | { ok: false; error: string };

/** Validate currency fields that are present. Unknown codes are rejected. */
export function validateOrgMoneyFields(body: Record<string, unknown>): OrgMoneyFieldResult {
  const fields: { currency_code?: string; number_format?: string } = {};
  if (Object.prototype.hasOwnProperty.call(body, 'currency_code')) {
    const code = parseCurrencyCode(body.currency_code);
    if (!code) return { ok: false, error: 'Unknown currency code' };
    fields.currency_code = code;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'number_format')) {
    const format = parseNumberFormat(body.number_format);
    if (!format) return { ok: false, error: 'Unknown number format' };
    fields.number_format = format;
  }
  return { ok: true, fields };
}
