/**
 * Premium and above see detailed financial reports.
 * Free orgs get the KPI summary. Guests are rejected earlier as 401.
 */

import { orgIsPaid, type OrgPlanFields } from './org-plan.ts';

export const DETAILED_REPORT_UPGRADE =
  'Detailed financial reports are included with Premium, Team, and Enterprise. Upgrade at /plans.';

export const PLAN_UNCONFIRMED = 'Could not confirm the organization plan.';

export function orgHasDetailedReports(plan: OrgPlanFields | null | undefined, god = false): boolean {
  if (god) return true;
  return orgIsPaid(plan);
}

export type FinancialDetailGate =
  | { ok: true; detail: boolean }
  | { ok: false; status: 402 | 503; error: string };

/**
 * Default request: free orgs receive the summary (detail false) and no 402.
 * An explicit detail request from a free org is 402.
 * A plan that could not be read does not pretend the org is Premium.
 */
export function gateFinancialDetail(input: {
  plan: OrgPlanFields | null;
  planKnown: boolean;
  god?: boolean;
  detailRequested?: boolean;
}): FinancialDetailGate {
  if (input.god) return { ok: true, detail: true };
  if (!input.planKnown) {
    if (input.detailRequested) return { ok: false, status: 503, error: PLAN_UNCONFIRMED };
    return { ok: true, detail: false };
  }
  const paid = orgIsPaid(input.plan);
  if (input.detailRequested && !paid) {
    return { ok: false, status: 402, error: DETAILED_REPORT_UPGRADE };
  }
  return { ok: true, detail: paid };
}

export type JobCostPlanGate = { ok: true } | { ok: false; status: 402 | 503; error: string };

/** Job costing is a detailed report. Free orgs receive 402 and no figures. */
export function gateJobCostingPlan(input: {
  plan: OrgPlanFields | null;
  planKnown: boolean;
  god?: boolean;
}): JobCostPlanGate {
  if (input.god) return { ok: true };
  if (!input.planKnown) return { ok: false, status: 503, error: PLAN_UNCONFIRMED };
  if (!orgIsPaid(input.plan)) return { ok: false, status: 402, error: DETAILED_REPORT_UPGRADE };
  return { ok: true };
}
