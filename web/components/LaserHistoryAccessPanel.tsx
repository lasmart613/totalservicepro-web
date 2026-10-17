'use client';

/**
 * Clinic side, on a laser's page (000922): a banner for pending history
 * requests and the "Shared with" list with Revoke. Renders nothing for
 * members who are not owners/admins (the RPCs refuse them).
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toast } from 'sonner';
import {
  INBOX_PATH,
  listIncomingHistoryRequests,
  listOwnerHistoryGrants,
  type IncomingHistoryRequest,
  type OwnerHistoryGrant,
} from '@/lib/service-history-requests';
import { revokeServiceHistory } from '@/lib/service-history-grants';

export function LaserHistoryAccessPanel({
  supabase,
  ownerOrgId,
  equipmentId,
}: {
  supabase: SupabaseClient;
  ownerOrgId: string | number | null | undefined;
  equipmentId: string | number;
}) {
  const [allowed, setAllowed] = useState(false);
  const [pending, setPending] = useState<IncomingHistoryRequest[]>([]);
  const [grants, setGrants] = useState<OwnerHistoryGrant[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    if (!ownerOrgId) return;
    const [inc, g] = await Promise.all([
      listIncomingHistoryRequests(supabase, ownerOrgId, { status: 'pending', equipmentId }),
      listOwnerHistoryGrants(supabase, ownerOrgId, equipmentId),
    ]);
    if (inc.error && g.error) {
      setAllowed(false);
      return;
    }
    setAllowed(true);
    setPending(inc.rows);
    setGrants(g.rows);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerOrgId, equipmentId]);

  async function revoke(g: OwnerHistoryGrant) {
    const what = g.equipment_id == null ? 'all of your lasers' : 'this laser';
    if (!window.confirm(`Stop sharing the service history of ${what} with ${g.shop_name || 'this company'}?`)) return;
    setBusy(g.id);
    const res = await revokeServiceHistory(supabase, g.id);
    setBusy(null);
    if (res.error) toast.error(res.error);
    else toast.success('Access revoked');
    await load();
  }

  if (!allowed) return null;
  return (
    <div className="mt-6 space-y-3">
      {pending.length > 0 && (
        <Link
          href={`${INBOX_PATH}?eq=${equipmentId}`}
          className="block card p-4 border border-[var(--gold)] text-sm"
        >
          🔔 {pending.length === 1 ? `${pending[0].shop_name || 'A service company'} is` : `${pending.length} service companies are`}{' '}
          asking to see this laser&apos;s service history. <span className="underline">Review</span>
        </Link>
      )}
      <div>
        <h2 className="font-bold text-[var(--gold)] mb-2">Service history shared with</h2>
        {grants.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--text3)]">Not shared with any other service company.</div>
        ) : (
          <div className="space-y-2">
            {grants.map((g) => (
              <div key={g.id} className="card p-3 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{g.shop_name || 'Service company'}</div>
                  <div className="text-xs text-[var(--text3)]">
                    {g.equipment_id == null ? 'All lasers' : 'This laser'} · since{' '}
                    {new Date(g.granted_at).toLocaleDateString()}
                  </div>
                </div>
                <button type="button" className="btn btn-secondary text-xs" disabled={busy === g.id} onClick={() => revoke(g)}>
                  {busy === g.id ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
