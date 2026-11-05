/**
 * Browser prefill for a job post: profile contact, then organization location.
 */

import { getSupabaseClient } from '../supabase/client.ts';
import { jobPrefillFromSources, type JobActor, type JobPrefill } from './jobs.ts';

export type JobComposer = {
  userId: string;
  actor: JobActor;
  prefill: JobPrefill;
};

export async function loadJobComposer(): Promise<JobComposer | null> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('first_name, last_name, phone, email, organization_id')
    .eq('id', user.id)
    .maybeSingle();

  let org: {
    id?: string | number | null;
    name?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    phone?: string | null;
    email?: string | null;
    contact_name?: string | null;
  } | null = null;

  const orgId = profile?.organization_id;
  if (orgId != null) {
    const full = await supabase
      .from('organizations')
      .select('id, name, address, city, state, phone, email, contact_name')
      .eq('id', orgId)
      .maybeSingle();
    if (!full.error) {
      org = full.data;
    } else {
      const slim = await supabase
        .from('organizations')
        .select('id, name, city, state, phone, email')
        .eq('id', orgId)
        .maybeSingle();
      org = slim.data;
    }
  }

  const { data: memberships } = await supabase
    .from('organization_memberships')
    .select('organization_id')
    .eq('user_id', user.id);

  return {
    userId: user.id,
    actor: {
      userId: user.id,
      orgId: profile?.organization_id ?? null,
      membershipOrgIds: (memberships || []).map((row) => row.organization_id),
    },
    prefill: jobPrefillFromSources({ profile, org }),
  };
}
