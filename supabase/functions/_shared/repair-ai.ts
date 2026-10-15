/**
 * Repair AI caller gate shared by grok-assistant and grok-tts.
 *
 * Mirrors web/lib/roles.ts canAccessRepairAi: the caller's profile organization
 * must have a membership row for the caller, and canAccessRepairAi(membership
 * role, organization type) must be true. No org, a stale profile org,
 * clinics/owners and suppliers get 403 repair_ai_forbidden.
 *
 * Pure helpers stay free of Deno and network imports so web tests can import it.
 */

export type AiCaller = {
  userId: string;
  orgId: number | string | null;
  role: string | null;
  orgType: string | null;
  member: boolean;
  org: OrgPlanRow | null;
};

export type OrgPlanRow = {
  type?: string | null;
  is_premium?: boolean | null;
  subscription_tier?: string | null;
  plan?: string | null;
  premium_until?: string | null;
  premium_grant?: string | null;
};

const OWNER_ORG_TYPES = ['customer', 'laser_clinic', 'laser_rental', 'laser_reseller'];
const SUPPLIER_ORG_TYPES = ['parts_supplier', 'vendor'];
const PRO_ROLES = ['admin', 'company_admin', 'service_manager', 'fse', 'engineer', 'dispatcher', 'scheduler'];
const SERVICE_EXTRA_ROLES = ['dispatcher', 'billing_manager', 'scheduler', 'crm'];

function norm(value: unknown): string {
  return String(value || '').toLowerCase().trim();
}

/** Exact copy of web/lib/roles.ts canAccessRepairAi. */
export function canAccessRepairAi(role?: string | null, orgType?: string | null): boolean {
  const r = norm(role);
  const t = norm(orgType);
  // A service company's owner keeps Repair AI; clinic/rental/reseller and supplier owners do not.
  if (r === 'owner' && (t === 'service_company' || t === 'service')) return true;
  const ownerish = r === 'owner' || r === 'customer' || OWNER_ORG_TYPES.includes(t);
  const supplier = r === 'parts_supplier' || r === 'supplier' || SUPPLIER_ORG_TYPES.includes(t);
  if (ownerish || supplier) return false;
  if (t === 'service_company' || t === 'service') return true;
  return PRO_ROLES.includes(r) || SERVICE_EXTRA_ROLES.includes(r);
}

export type AiAccessDecision = { ok: true } | { ok: false; status: 403; error: string; message: string };

export function repairAiDecision(caller: AiCaller): AiAccessDecision {
  if (caller.orgId == null || !caller.member) {
    return {
      ok: false,
      status: 403,
      error: 'repair_ai_forbidden',
      message: 'Repair AI is for service-company members.',
    };
  }
  if (!canAccessRepairAi(caller.role, caller.orgType)) {
    return {
      ok: false,
      status: 403,
      error: 'repair_ai_forbidden',
      message: 'Repair AI is for service companies.',
    };
  }
  return { ok: true };
}

// ---- reads (service role) ---------------------------------------------------

type Res = { data: any; error: { message?: string } | null };
type Db = { from: (table: string) => any };

const ORG_COLUMNS = [
  'type, is_premium, subscription_tier, plan, premium_until, premium_grant',
  'type, is_premium, subscription_tier, plan, premium_until',
  'type, is_premium, subscription_tier',
  'type',
];

export async function loadAiCaller(db: Db, userId: string): Promise<AiCaller> {
  const empty: AiCaller = { userId, orgId: null, role: null, orgType: null, member: false, org: null };
  const prof: Res = await db.from('user_profiles').select('organization_id').eq('id', userId).maybeSingle();
  const orgId = prof.error ? null : prof.data?.organization_id ?? null;
  if (orgId == null) return empty;
  const mem: Res = await db
    .from('organization_memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .limit(1);
  const row = !mem.error && Array.isArray(mem.data) ? mem.data[0] : null;
  if (!row) return { ...empty, orgId };
  let org: OrgPlanRow | null = null;
  for (const columns of ORG_COLUMNS) {
    const got: Res = await db.from('organizations').select(columns).eq('id', orgId).maybeSingle();
    if (!got.error) {
      org = got.data ?? null;
      break;
    }
  }
  return {
    userId,
    orgId,
    role: row.role ?? null,
    orgType: org?.type ?? null,
    member: true,
    org,
  };
}
