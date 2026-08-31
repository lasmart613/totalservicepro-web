/**
 * God dashboard org listing helpers. Pure assembly / filter — no writes.
 */

import { currentOrgPlan, currentOrgPlanLabel, type OrgPlanFields } from './org-plan.ts';
import { orgTypeLabel } from './labels.ts';
import { isAdmin } from './roles.ts';
import { isGodPlanName } from './god.ts';

export type GodMember = {
  id: string;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role: string | null;
  organizationId?: number | string | null;
};

export type GodOrgSource = OrgPlanFields & {
  id: number | string;
  name?: string | null;
  type?: string | null;
  email?: string | null;
  created_at?: string | null;
  created_by?: string | null;
};

export type GodOrgRow = {
  id: number | string;
  name: string;
  type: string;
  typeLabel: string;
  planKey: string;
  planLabel: string;
  seats: number;
  adminEmail: string;
  createdAt: string | null;
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
  }>;
};

const ADMIN_ROLES = new Set(['admin', 'company_admin', 'owner']);

function memberName(member: GodMember): string {
  const name = [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  const email = String(member.email || '').trim();
  return email ? email.split('@')[0] : 'Member';
}

export function godPlanLabel(org: OrgPlanFields | null | undefined): string {
  const raw = String(org?.subscription_tier || org?.plan || '')
    .toLowerCase()
    .trim();
  if (raw === 'unpaid' || raw === 'canceled' || raw === 'cancelled' || raw === 'past_due') {
    return 'Unpaid';
  }
  if (isGodPlanName(raw)) return currentOrgPlanLabel({ is_premium: false });
  return currentOrgPlanLabel(org);
}

export function godPlanKey(org: OrgPlanFields | null | undefined): string {
  const label = godPlanLabel(org);
  if (label === 'Unpaid') return 'unpaid';
  return currentOrgPlan(org);
}

export function pickAdminEmail(input: {
  orgEmail?: string | null;
  members: GodMember[];
}): string {
  const ranked = [...input.members].sort((a, b) => {
    const ar = String(a.role || '').toLowerCase();
    const br = String(b.role || '').toLowerCase();
    const as = ADMIN_ROLES.has(ar) || isAdmin(ar) ? 0 : ar === 'owner' ? 1 : 2;
    const bs = ADMIN_ROLES.has(br) || isAdmin(br) ? 0 : br === 'owner' ? 1 : 2;
    return as - bs;
  });
  for (const member of ranked) {
    const email = String(member.email || '').trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  }
  const orgEmail = String(input.orgEmail || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(orgEmail)) return orgEmail;
  return '';
}

export function assembleGodOrgs(input: {
  orgs: GodOrgSource[];
  members: GodMember[];
}): GodOrgRow[] {
  const byOrg = new Map<string, GodMember[]>();
  for (const member of input.members) {
    const orgId = member.organizationId;
    if (orgId == null || orgId === '') continue;
    const key = String(orgId);
    const list = byOrg.get(key) || [];
    list.push(member);
    byOrg.set(key, list);
  }

  return input.orgs.map((org) => {
    const members = byOrg.get(String(org.id)) || [];
    const seen = new Set<string>();
    const users = members
      .filter((m) => {
        if (!m.id || seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      })
      .map((m) => ({
        id: m.id,
        name: memberName(m),
        email: String(m.email || '').trim(),
        role: String(m.role || 'member'),
      }));
    return {
      id: org.id,
      name: String(org.name || '').trim() || `Organization ${org.id}`,
      type: String(org.type || '').trim() || 'unknown',
      typeLabel: orgTypeLabel(org.type) || 'Organization',
      planKey: godPlanKey(org),
      planLabel: godPlanLabel(org),
      seats: users.length,
      adminEmail: pickAdminEmail({ orgEmail: org.email, members }),
      createdAt: org.created_at || null,
      users,
    };
  });
}

export type GodOrgFilters = {
  type?: string | null;
  plan?: string | null;
  q?: string | null;
};

export function filterGodOrgs(orgs: GodOrgRow[], filters: GodOrgFilters = {}): GodOrgRow[] {
  const type = String(filters.type || '').toLowerCase().trim();
  const plan = String(filters.plan || '').toLowerCase().trim();
  const q = String(filters.q || '').toLowerCase().trim();

  return orgs.filter((org) => {
    if (type && type !== 'all' && String(org.type).toLowerCase() !== type) return false;
    if (plan && plan !== 'all' && org.planKey !== plan) return false;
    if (!q) return true;
    const hay = [
      org.name,
      org.adminEmail,
      org.typeLabel,
      org.planLabel,
      ...org.users.map((u) => `${u.name} ${u.email}`),
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Selected org ids only — never implied "all". Empty means send nobody. */
export function selectedOrgIds(raw: unknown): Array<number | string> {
  if (!Array.isArray(raw)) return [];
  const out: Array<number | string> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (item == null || item === '') continue;
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const key = String(item).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(/^\d+$/.test(key) ? Number(key) : key);
  }
  return out;
}
