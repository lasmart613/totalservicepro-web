import type { NextRequest } from 'next/server';
import { loadBillingCaller } from '@/lib/billing/billing-caller';
import type { ConnectCallbackActor } from '@/lib/billing/stripe-connect';
import { loadConnectCaller } from '@/lib/billing/stripe-connect-api';

export async function connectActorFromRequest(req: NextRequest): Promise<ConnectCallbackActor | null> {
  const loaded = await loadBillingCaller(req);
  if ('error' in loaded) return null;
  const { data: profile } = await loaded.supabase
    .from('user_profiles')
    .select('role, organization_id, active_organization_id')
    .eq('id', loaded.user.id)
    .maybeSingle();
  const caller = await loadConnectCaller({
    userId: loaded.user.id,
    email: loaded.user.email,
    profile,
  });
  if ('error' in caller) return null;
  return {
    userId: caller.userId,
    orgId: caller.orgId,
    role: caller.role,
    orgType: caller.orgType,
  };
}
