'use client';

/**
 * Shop side of the locked service history teaser (000922).
 * Shown under a laser on the shop's customer page. Lazy: nothing is fetched
 * until the user opens it (the teaser RPC is rate limited).
 */
import React, { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toast } from 'sonner';
import {
  historyRequestErrorText,
  latestRequestByEquipment,
  listMyHistoryRequests,
  loadLockedTeaser,
  requestHistoryAccess,
  requestStatusText,
  type MyHistoryRequest,
  type TeaserRow,
  type TeaserState,
} from '@/lib/service-history-requests';
import { loadSharedServiceHistory, type SharedHistoryRow } from '@/lib/service-history-grants';

function fmtDay(d: string | null | undefined): string {
  if (!d) return '';
  const t = new Date(`${String(d).slice(0, 10)}T12:00:00`);
  return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleDateString();
}

export function LockedHistoryPanel({
  supabase,
  ownerOrgId,
  equipmentId,
  clinicName,
}: {
  supabase: SupabaseClient;
  ownerOrgId: string | number;
  equipmentId: string | number;
  clinicName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<TeaserState | null>(null);
  const [rows, setRows] = useState<TeaserRow[]>([]);
  const [shared, setShared] = useState<SharedHistoryRow[]>([]);
  const [request, setRequest] = useState<MyHistoryRequest | null>(null);
  const [confirmRef, setConfirmRef] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    const [teaser, mine, sharedPage] = await Promise.all([
      loadLockedTeaser(supabase, ownerOrgId, equipmentId),
      listMyHistoryRequests(supabase, equipmentId),
      loadSharedServiceHistory(supabase, ownerOrgId, equipmentId, { limit: 50 }),
    ]);
    setState(teaser.state);
    setRows(teaser.rows);
    setRequest(latestRequestByEquipment(mine).get(Number(equipmentId)) || null);
    setShared(sharedPage.rows);
    setLoading(false);
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && state == null) await load();
  }

  async function send(ref: string | null) {
    setSending(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error('Sign in again to send the request.');
        return;
      }
      const res = await requestHistoryAccess(fetch as any, token, { ownerOrgId, equipmentId, ref });
      if (!res.ok) {
        toast.error(historyRequestErrorText(res.error || 'error', res.retryAfter));
      } else if (res.status === 'approved') {
        toast.success('This history is already shared with you.');
      } else {
        toast.success(res.created ? `Request sent to ${clinicName || 'the clinic'}.` : 'You already asked. Waiting for the clinic.');
      }
      setConfirmRef(null);
      await load();
    } finally {
      setSending(false);
    }
  }

  const pending = request?.status === 'pending';
  const cooling = request?.status === 'denied' && request.retry_after && new Date(request.retry_after) > new Date();

  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
      <button type="button" className="text-xs font-semibold text-[var(--text2)] w-full text-left" onClick={toggle}>
        🔒 Earlier service history {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          {loading && <div className="text-[var(--text3)]">Loading…</div>}
          {!loading && state === 'unclaimed' && (
            <div className="text-[var(--text3)]">
              {clinicName || 'This clinic'} hasn&apos;t joined Total Service Pro yet. Invite them to request earlier
              history.
            </div>
          )}
          {!loading && state === 'rate_limited' && (
            <div className="text-amber-400">Too many lookups right now. Try again later.</div>
          )}
          {!loading && (state === 'unavailable' || state === 'error') && (
            <div className="text-[var(--text3)]">No earlier history is available for this laser.</div>
          )}
          {!loading && shared.length > 0 && (
            <div>
              <div className="font-semibold text-[var(--gold)] mb-1">Shared by {clinicName || 'the clinic'}</div>
              {shared.map((r) => (
                <div key={String(r.id)} className="flex justify-between gap-2 py-0.5">
                  <span>
                    {String(r.service_type || 'Service report')} · {String(r.service_company_name || 'Service company')}
                  </span>
                  <span className="text-[var(--text3)]">{fmtDay(r.date_out as string)}</span>
                </div>
              ))}
            </div>
          )}
          {!loading && state === 'ok' && rows.length === 0 && shared.length === 0 && (
            <div className="text-[var(--text3)]">No earlier reports from other service companies on this laser.</div>
          )}
          {!loading && state === 'ok' && rows.length > 0 && (
            <div>
              <div className="text-[var(--text3)] mb-1">
                {rows.length} earlier report{rows.length === 1 ? '' : 's'} by other service companies. Ask{' '}
                {clinicName || 'the clinic'} to see {rows.length === 1 ? 'it' : 'them'}.
              </div>
              {request && <div className="mb-1 font-semibold">{requestStatusText(request)}</div>}
              <ul className="space-y-1">
                {rows.map((r) => (
                  <li key={r.ref}>
                    <button
                      type="button"
                      disabled={pending || !!cooling || sending}
                      onClick={() => setConfirmRef(r.ref)}
                      className="w-full flex justify-between gap-2 rounded px-2 py-1 bg-[var(--surface2)] hover:bg-[var(--surface3)] disabled:opacity-60 text-left"
                    >
                      <span>🔒 Service report · {r.title}</span>
                      <span className="text-[var(--text3)]">{fmtDay(r.service_date)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {confirmRef && (
                <div className="mt-2 rounded border border-[var(--gold)] p-2">
                  <div className="mb-2">
                    Ask {clinicName || 'the clinic'} to share this laser&apos;s earlier history? Their owners and admins
                    will be notified by email.
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-primary text-xs" disabled={sending} onClick={() => send(confirmRef)}>
                      {sending ? 'Sending…' : 'Send request'}
                    </button>
                    <button type="button" className="btn btn-secondary text-xs" onClick={() => setConfirmRef(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
