'use client';

import { useEffect, useState } from 'react';
import { canAddListingToInvoice } from '@/lib/billing/listing-invoice';
import { coerceOrgId } from '@/lib/billing/save-helpers';
import { getSupabaseClient } from '@/lib/supabase/client';

export type ServiceCompanyOrg = {
  ready: boolean;
  orgId: string | number | null;
  userId: string | null;
  orgType: string | null;
};

const empty: ServiceCompanyOrg = { ready: false, orgId: null, userId: null, orgType: null };

let snapshot: ServiceCompanyOrg = empty;
let pending: Promise<void> | null = null;
const listeners = new Set<(snap: ServiceCompanyOrg) => void>();

function publish(next: ServiceCompanyOrg) {
  snapshot = next;
  listeners.forEach((fn) => fn(snapshot));
}

function refresh(): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        publish({ ready: true, orgId: null, userId: null, orgType: null });
        return;
      }
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      const orgId = coerceOrgId(profile?.organization_id);
      if (orgId == null) {
        publish({ ready: true, orgId: null, userId: user.id, orgType: null });
        return;
      }
      const { data: org } = await supabase
        .from('organizations')
        .select('type')
        .eq('id', orgId)
        .maybeSingle();
      publish({
        ready: true,
        orgId: canAddListingToInvoice(org?.type) ? orgId : null,
        userId: user.id,
        orgType: org?.type ?? null,
      });
    } catch {
      publish({ ready: true, orgId: null, userId: null, orgType: null });
    }
  })().finally(() => {
    pending = null;
  });
  return pending;
}

/** Active org when it is a service company. Shared across listing cards. */
export function useServiceCompanyOrg(): ServiceCompanyOrg {
  const [state, setState] = useState<ServiceCompanyOrg>(snapshot);

  useEffect(() => {
    listeners.add(setState);
    setState(snapshot);
    void refresh();
    return () => {
      listeners.delete(setState);
    };
  }, []);

  return state;
}
