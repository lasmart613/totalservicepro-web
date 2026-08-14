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
    // Keep a same-tab copy too (harmless if localStorage works)
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

export function destForKind(kind: PendingSignupKind, hasLasers = false): string {
  if (kind === 'company') return '/onboarding';
  if (kind === 'owner') return hasLasers ? '/my-lasers?justSetup=1' : '/?justSetup=1';
  return '/?justSetup=1';
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
      facility_type: meta.facility_type || null,
    },
  };
}

export function resolvePendingSignup(user: {
  email?: string | null;
  user_metadata?: Record<string, any> | null;
}): PendingSignup | null {
  const stored = loadPendingSignup();
  const email = (user.email || '').toLowerCase();
  if (stored && stored.email && stored.email.toLowerCase() === email) return stored;
  return pendingSignupFromMetadata(user);
}

/**
 * Create org + link founder profile from a pending signup payload.
 * Idempotent: if the user already has an organization_id, do not insert another org.
 */
export async function applyPendingSignup(
  supabase: SupabaseClient,
  userId: string,
  pending: PendingSignup
): Promise<{ orgId: string | number | null; dest: string }> {
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('organization_id, role')
    .eq('id', userId)
    .maybeSingle();

  if (existing?.organization_id) {
    clearPendingSignup();
    return { orgId: existing.organization_id, dest: destForKind(pending.kind) };
  }

  const orgInsert: Record<string, any> = {
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
    orgInsert.facility_type = pending.extra?.facility_type || null;
    orgInsert.num_lasers = pending.extra?.num_lasers ?? null;
    orgInsert.preferred_services = pending.extra?.preferred_services || null;
  }
  if (pending.kind === 'supplier') {
    orgInsert.num_techs = pending.extra?.num_techs ?? null;
    orgInsert.tax_id = pending.extra?.tax_id || null;
    orgInsert.services_offered = pending.extra?.services_offered || null;
  }

  const { data: orgData, error: orgError } = await supabase
    .from('organizations')
    .insert(orgInsert)
    .select('id')
    .single();

  if (orgError || !orgData?.id) {
    throw new Error(
      orgError?.message || 'Could not create your organization. Try again or sign in to finish setup.'
    );
  }

  const founderComplete = pending.kind !== 'company';
  const { error: profErr } = await supabase.from('user_profiles').upsert(
    {
      id: userId,
      first_name: pending.firstName,
      last_name: pending.lastName,
      email: pending.email,
      phone: pending.phone || null,
      role: pending.role,
      job_title: pending.extra?.job_title || null,
      organization_id: orgData.id,
      onboarding_completed: founderComplete,
      bio: pending.extra?.bio || null,
    },
    { onConflict: 'id' }
  );
  if (profErr) {
    const { error: forceErr } = await supabase
      .from('user_profiles')
      .update({
        organization_id: orgData.id,
        role: pending.role,
        first_name: pending.firstName || null,
        last_name: pending.lastName || null,
        onboarding_completed: founderComplete,
      })
      .eq('id', userId);
    if (forceErr) throw new Error(forceErr.message || 'Organization created but profile link failed.');
  }

  clearPendingSignup();
  return { orgId: orgData.id, dest: destForKind(pending.kind) };
}
