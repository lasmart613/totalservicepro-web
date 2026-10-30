'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/fa/locale';
import { getSupabaseClient } from '@/lib/supabase/client';
import { orgSeatLimit, seatAddBlocked, seatLimitMessage, type OrgPlanFields } from '@/lib/org-plan';

/**
 * Upgrade nudge when the org is at or over its seats (Free/Premium 1,
 * Team 10). Existing members stay; the server blocks new invites/adds.
 * Pass `org` when the page already has the plan fields, else `orgId`.
 */
export function SeatLimitNudge({
  used,
  org,
  orgId,
}: {
  used: number;
  org?: OrgPlanFields | null;
  orgId?: number | string | null;
}) {
  const t = useT();
  const [loaded, setLoaded] = useState<OrgPlanFields | null>(org ?? null);

  useEffect(() => {
    if (org) {
      setLoaded(org);
      return;
    }
    if (orgId == null || orgId === '') return;
    let live = true;
    getSupabaseClient()
      .from('organizations')
      .select('is_premium, subscription_tier, plan, premium_until, premium_grant')
      .eq('id', orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (live) setLoaded((data as OrgPlanFields | null) ?? null);
      });
    return () => {
      live = false;
    };
  }, [org, orgId]);

  if (!loaded) return null;
  const limit = orgSeatLimit(loaded);
  if (!seatAddBlocked(used, limit)) return null;
  return (
    <div
      role="status"
      data-testid="seat-limit-nudge"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--gold)]/50 bg-[var(--gold)]/10 px-4 py-3 text-sm"
    >
      <span dir="auto">{seatLimitMessage(used, limit)} {t('Current members keep their access.')}</span>
      <a href="/plans" className="btn btn-primary px-4 py-1.5 text-sm font-semibold">
        {t('Upgrade')}
      </a>
    </div>
  );
}
