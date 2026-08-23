import type { SupabaseClient } from '@supabase/supabase-js';

const KEY = 'tsp-pending-signup';

export type PendingSignupKind = 'company' | 'owner' | 'supplier';

export type PendingSignup = {
  kind: PendingSignupKind;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  role: string;
  orgType: string;
  extra?: Record<string, any>;
};

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function savePendingSignup(p: PendingSignup) {
  try {
    const raw = JSON.stringify(p);
    const store = storage();
    if (store) store.setItem(KEY, raw);
    try {
      sessionStorage.setItem(KEY, raw);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

export function loadPendingSignup(): PendingSignup | null {
  try {
    const store = storage();
    const raw = (store && store.getItem(KEY)) || sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingSignup;
  } catch {
    return null;
  }
}

export function clearPendingSignup() {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function destForKind(kind: PendingSignupKind, _hasLasers = false): string {
  if (kind === 'company') return '/onboarding';
  if (kind === 'owner') return '/my-lasers?justSetup=1';
  return '/?justSetup=1';
}

export type PendingEquipmentItem = {
  manufacturer: string;
  model: string;
  serial_number: string;
};

/** Core org row — never include dropped columns such as organizations.num_lasers. */
export function organizationInsertFromPending(pending: PendingSignup, userId: string): Record<string, unknown> {
  const orgInsert: Record<string, unknown> = {
    name: pending.name,
    type: pending.orgType,
    address: pending.address || null,
    city: pending.city || null,
    state: pending.state || null,
    phone: pending.phone || null,
    website: pending.website || null,
    created_by: userId,
  };

  if (pending.kind === 'company') {
    orgInsert.services_offered = pending.extra?.services_offered || null;
    orgInsert.num_techs = pending.extra?.num_techs ?? null;
  }
  if (pending.kind === 'owner') {
    orgInsert.facility_type = pending.extra?.facility_type || facilityTypeForOwnerOrg(pending.orgType);
    orgInsert.preferred_services = pending.extra?.preferred_services || null;
    const count = pending.extra?.num_laser_systems ?? pending.extra?.num_lasers;
    if (count != null && Number.isFinite(Number(count))) {
      orgInsert.num_laser_systems = Number(count);
    }
  }
  if (pending.kind === 'supplier') {
    orgInsert.num_techs = pending.extra?.num_techs ?? null;
    orgInsert.tax_id = pending.extra?.tax_id || null;
    orgInsert.services_offered = pending.extra?.services_offered || null;
  }

  delete orgInsert.num_lasers;
  return orgInsert;
}

function coreOrganizationInsert(pending: PendingSignup, userId: string): Record<string, unknown> {
  return {
    name: pending.name,
    type: pending.orgType,
    address: pending.address || null,
    city: pending.city || null,
    state: pending.state || null,
    phone: pending.phone || null,
    website: pending.website || null,
    created_by: userId,
  };
}

export function facilityTypeForOwnerOrg(orgType?: string | null): string | null {
  const t = String(orgType || '').toLowerCase().trim();
  if (t === 'laser_rental') return 'Rental company';
  if (t === 'laser_reseller') return 'Reseller inventory';
  return null;
}

const OWNER_ORG_TYPES = new Set(['customer', 'laser_clinic', 'laser_rental', 'laser_reseller']);

/**
 * Rebuild the founder payload from auth user_metadata when localStorage is empty
 * (Gmail/Outlook open the confirm link in a new tab).
 */
export function pendingSignupFromMetadata(user: {
  email?: string | null;
  user_metadata?: Record<string, any> | null;
}): PendingSignup | null {
  const meta = user?.user_metadata || {};
  if (meta.invited_member) return null;

  const role = String(meta.role || '').toLowerCase().trim();
  const orgType = String(meta.organization_type || '').toLowerCase().trim();
  const name = String(meta.company || meta.facility || '').trim();
  const signupKind = String(meta.signup_kind || '').toLowerCase().trim();

  let kind: PendingSignupKind | null = null;
  if (
    signupKind === 'company' ||
    role === 'company_admin' ||
    role === 'admin' ||
    orgType === 'service_company'
  ) {
    kind = 'company';
  } else if (
    signupKind === 'owner' ||
    role === 'owner' ||
    role === 'customer' ||
    OWNER_ORG_TYPES.has(orgType)
  ) {
    kind = 'owner';
  } else if (
    signupKind === 'supplier' ||
    role === 'parts_supplier' ||
    role === 'supplier' ||
    orgType === 'parts_supplier'
  ) {
    kind = 'supplier';
  }

  if (!kind) return null;
  if (!name && !role && !orgType) return null;

  const resolvedOrgType =
    orgType ||
    (kind === 'company' ? 'service_company' : kind === 'owner' ? 'customer' : 'parts_supplier');
  const resolvedRole =
    role ||
    (kind === 'company' ? 'company_admin' : kind === 'owner' ? 'owner' : 'parts_supplier');

  return {
    kind,
    name: name || 'My Organization',
    firstName: String(meta.first_name || ''),
    lastName: String(meta.last_name || ''),
    email: String(user.email || ''),
    phone: meta.phone || null,
    address: meta.address || null,
    city: meta.city || null,
    state: meta.state || null,
    website: meta.website || null,
    role: resolvedRole,
    orgType: resolvedOrgType,
    extra: {
      job_title: meta.job_title || null,
      services_offered: meta.services_offered || null,
      facility_type: meta.facility_type || facilityTypeForOwnerOrg(resolvedOrgType),
      preferred_services: meta.preferred_services || null,
      num_laser_systems: meta.num_laser_systems ?? meta.num_lasers ?? null,
      claimToken: meta.claim_token || null,
    },
  };
}

export function resolvePendingSignup(user: {
  email?: string | null;
  user_metadata?: Record<string, any> | null;
}): PendingSignup | null {
  const stored = loadPendingSignup();
  const email = (user.email || '').toLowerCase();
  if (stored) {
    if (stored.email && stored.email.toLowerCase() === email) return stored;
    // Leftover payload from another account in this browser — do not apply it.
    clearPendingSignup();
  }
  return pendingSignupFromMetadata(user);
}

function pendingMatchesSession(
  userId: string,
  pending: PendingSignup,
  sessionUser: { id?: string; email?: string | null } | null
): boolean {
  if (!sessionUser?.id || sessionUser.id !== userId) return false;
  const pendingEmail = (pending.email || '').toLowerCase().trim();
  const sessionEmail = (sessionUser.email || '').toLowerCase().trim();
  return !!pendingEmail && pendingEmail === sessionEmail;
}

async function findCreatedOrganization(
  supabase: SupabaseClient,
  userId: string,
  name: string
): Promise<string | number | null> {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('created_by', userId)
    .ilike('name', trimmed)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

function ownerFallbackType(intended: string): string | null {
  const t = String(intended || '').toLowerCase();
  if (t === 'laser_rental' || t === 'laser_reseller' || t === 'laser_clinic') return 'customer';
  return null;
}

/**
 * Insert org. Rental/reseller types may be rejected by a live CHECK/enum that
 * only allows customer | service_company | parts_supplier — fall back to customer
 * and keep rental identity on facility_type.
 */
export async function insertOrganizationForPending(
  supabase: SupabaseClient,
  userId: string,
  pending: PendingSignup
): Promise<string | number> {
  const intended = organizationInsertFromPending(pending, userId);
  const core = coreOrganizationInsert(pending, userId);
  const attempts: Record<string, unknown>[] = [intended];
  if (JSON.stringify(intended) !== JSON.stringify(core)) attempts.push(core);

  const fallbackType = pending.kind === 'owner' ? ownerFallbackType(String(pending.orgType || '')) : null;
  if (fallbackType) {
    attempts.push({
      ...core,
      type: fallbackType,
      facility_type: pending.extra?.facility_type || facilityTypeForOwnerOrg(pending.orgType),
    });
    attempts.push({
      name: pending.name,
      type: fallbackType,
      created_by: userId,
    });
  }

  let lastError: { message?: string } | null = null;
  for (const row of attempts) {
    delete (row as any).num_lasers;
    const { data, error } = await supabase.from('organizations').insert(row).select('id').maybeSingle();
    if (data?.id) return data.id;
    lastError = error;
    const found = await findCreatedOrganization(supabase, userId, pending.name);
    if (found) return found;
  }

  throw new Error(
    lastError?.message || 'Could not create your organization. Try again or sign in to finish setup.'
  );
}

async function linkFounderProfile(
  supabase: SupabaseClient,
  userId: string,
  orgId: string | number,
  pending: PendingSignup
): Promise<void> {
  const founderComplete = pending.kind !== 'company';
  const payload = {
    id: userId,
    first_name: pending.firstName,
    last_name: pending.lastName,
    email: pending.email,
    phone: pending.phone || null,
    role: pending.role,
    job_title: pending.extra?.job_title || null,
    organization_id: orgId,
    onboarding_completed: founderComplete,
    bio: pending.extra?.bio || null,
  };

  let { error: profErr } = await supabase.from('user_profiles').upsert(payload, { onConflict: 'id' });
  if (profErr) {
    const slim = {
      organization_id: orgId,
      role: pending.role,
      first_name: pending.firstName || null,
      last_name: pending.lastName || null,
      onboarding_completed: founderComplete,
    };
    const { error: forceErr } = await supabase.from('user_profiles').update(slim).eq('id', userId);
    if (forceErr) {
      const r2 = await supabase
        .from('user_profiles')
        .update({ organization_id: orgId, role: pending.role, onboarding_completed: founderComplete })
        .eq('id', userId);
      if (r2.error) throw new Error(r2.error.message || 'Organization created but profile link failed.');
    }
  }

  const { data: check } = await supabase
    .from('user_profiles')
    .select('organization_id, role, onboarding_completed')
    .eq('id', userId)
    .maybeSingle();

  if (!check?.organization_id) {
    const { error: lastErr } = await supabase
      .from('user_profiles')
      .update({
        organization_id: orgId,
        role: pending.role,
        onboarding_completed: founderComplete,
      })
      .eq('id', userId);
    const { data: check2 } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', userId)
      .maybeSingle();
    if (!check2?.organization_id) {
      throw new Error(
        lastErr?.message ||
          'Organization created but could not link your account. Open Onboarding to finish.'
      );
    }
  }
}

/**
 * Create org + link founder profile from a pending signup payload.
 * Does not return success until user_profiles.organization_id is actually set.
 */
export async function applyPendingSignup(
  supabase: SupabaseClient,
  userId: string,
  pending: PendingSignup
): Promise<{ orgId: string | number | null; dest: string }> {
  const {
    data: { user: sessionUser },
  } = await supabase.auth.getUser();
  if (!pendingMatchesSession(userId, pending, sessionUser)) {
    clearPendingSignup();
    throw new Error('Signup details do not match the signed-in account. Sign out and try again.');
  }

  const { data: existing } = await supabase
    .from('user_profiles')
    .select('organization_id, role')
    .eq('id', userId)
    .maybeSingle();

  if (existing?.organization_id) {
    const { data: linkedOrg } = await supabase
      .from('organizations')
      .select('id, created_by')
      .eq('id', existing.organization_id)
      .maybeSingle();
    const ownOrg = linkedOrg && String(linkedOrg.created_by) === String(userId);
    // Never rewrite role onto an org this user did not create (stolen / invite / other account).
    if (ownOrg && pending.kind !== 'company' && existing.role !== pending.role) {
      const prior = String(existing.role || '').toLowerCase();
      if (!prior || prior === 'fse' || prior === 'pending' || prior === 'engineer') {
        await supabase
          .from('user_profiles')
          .update({ role: pending.role, onboarding_completed: true })
          .eq('id', userId);
      }
    }
    if (ownOrg) {
      await insertPendingOwnerEquipment(supabase, existing.organization_id, pending);
    }
    clearPendingSignup();
    return { orgId: existing.organization_id, dest: destForKind(pending.kind) };
  }

  const orphan = await findCreatedOrganization(supabase, userId, pending.name);
  const orgId = orphan || (await insertOrganizationForPending(supabase, userId, pending));

  await linkFounderProfile(supabase, userId, orgId, pending);
  await insertPendingOwnerEquipment(supabase, orgId, pending);

  clearPendingSignup();
  return { orgId, dest: destForKind(pending.kind) };
}

async function insertPendingOwnerEquipment(
  supabase: SupabaseClient,
  orgId: string | number,
  pending: PendingSignup
): Promise<void> {
  if (pending.kind !== 'owner') return;
  const items = Array.isArray(pending.extra?.equipment) ? pending.extra.equipment : [];
  for (const raw of items) {
    const manufacturer = String(raw?.manufacturer || '').trim() || 'Unknown';
    const model = String(raw?.model || raw?.modelKey || '').trim();
    const serial = String(raw?.serial_number || raw?.serialNumber || '').trim() || 'TBD';
    if (!model) continue;
    const payload = {
      customer_organization_id: orgId,
      manufacturer,
      model,
      serial_number: serial,
    };
    const { error } = await supabase.from('equipment').insert(payload);
    if (error) {
      const r2 = await supabase.from('equipment').insert(payload);
      if (r2.error) {
        console.error('Signup equipment insert failed', r2.error);
      }
    }
  }
}
