'use client';

/**
 * Clinic inbox for service history requests (000922). Owners/admins approve
 * (this laser by default, or all lasers) or deny. Nothing is shared without
 * approval; the grant goes through grant_service_history.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  historyEmailOn,
  historyRequestErrorText,
  inboxAccess,
  listIncomingHistoryRequests,
  positiveId,
  respondToHistoryRequest,
  withHistoryEmailPref,
  type InboxAccess,
  type IncomingHistoryRequest,
} from '@/lib/service-history-requests';

function day(s: string | null | undefined): string {
  if (!s) return '';
  const t = new Date(String(s).length <= 10 ? `${s}T12:00:00` : String(s));
  return Number.isNaN(t.getTime()) ? String(s) : t.toLocaleDateString();
}

function closedText(r: IncomingHistoryRequest): string {
  if (r.status === 'approved') return r.approved_scope === 'all' ? 'Approved · all lasers' : 'Approved · this laser';
  if (r.status === 'denied') return 'Denied';
  if (r.close_reason === 'equipment_moved') return 'Closed · laser no longer yours';
  if (r.close_reason === 'blocked') return 'Closed · company removed';
  if (r.close_reason === 'link_removed') return 'Closed · company no longer linked';
  return 'Expired';
}

function Inbox() {
  const supabase = getSupabaseClient();
  const search = useSearchParams();
  const focusEq = positiveId(search?.get('eq'));
  const focusReq = positiveId(search?.get('r'));
  const [ownerOrg, setOwnerOrg] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<unknown>(null);
  const [tab, setTab] = useState<'pending' | 'closed'>('pending');
  const [rows, setRows] = useState<IncomingHistoryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // L-4: who may see the inbox at all; and why a list failed.
  const [access, setAccess] = useState<InboxAccess | 'signed_out' | null>(null);
  const [listError, setListError] = useState<'forbidden' | 'unavailable' | 'error' | null>(null);
  const [scope, setScope] = useState<Record<number, 'equipment' | 'all'>>({});
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setAccess('signed_out');
        setLoading(false);
        return;
      }
      setUserId(user.id);
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id, active_organization_id, notification_prefs')
        .eq('id', user.id)
        .maybeSingle();
      setPrefs(prof?.notification_prefs ?? null);
      const org = positiveId(prof?.active_organization_id ?? prof?.organization_id);
      let orgType: unknown = null;
      let role: unknown = null;
      if (org) {
        const [{ data: o }, { data: m }] = await Promise.all([
          supabase.from('organizations').select('type').eq('id', org).maybeSingle(),
          supabase
            .from('organization_memberships')
            .select('role')
            .eq('organization_id', org)
            .eq('user_id', user.id)
            .maybeSingle(),
        ]);
        orgType = o?.type;
        role = m?.role;
      }
      const a = inboxAccess(org, orgType, role);
      setAccess(a);
      if (a === 'owner') setOwnerOrg(org);
      else setLoading(false);
    })().catch(() => {
      setAccess('no_org');
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    if (!ownerOrg) return;
    setLoading(true);
    const res = await listIncomingHistoryRequests(supabase, ownerOrg, {
      status: tab,
      equipmentId: focusEq,
      limit: 100,
    });
    setListError(
      !res.error
        ? null
        : res.errorKind === 'unavailable'
          ? 'unavailable'
          : res.errorKind === 'forbidden'
            ? 'forbidden'
            : 'error',
    );
    setRows(res.rows);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerOrg, tab, focusEq]);

  async function answer(r: IncomingHistoryRequest, decision: 'approve' | 'deny') {
    const s = scope[r.id] || 'equipment';
    if (decision === 'approve' && s === 'all') {
      if (!window.confirm(`Share the service history of ALL your lasers with ${r.shop_name || 'this company'}?`))
        return;
    }
    setBusy(r.id);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error('Sign in again.');
        return;
      }
      const res = await respondToHistoryRequest(fetch as any, token, r.id, decision, s);
      if (!res.ok) toast.error(historyRequestErrorText(res.error || 'error'));
      else if (res.status === 'approved') toast.success(`Shared with ${r.shop_name || 'the company'}`);
      else if (res.status === 'denied') toast.success('Request denied');
      else toast.message('This request was closed (the laser changed or the company was removed).');
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function toggleEmail(on: boolean) {
    if (!userId) return;
    const next = withHistoryEmailPref(prefs, on);
    const { error } = await supabase.from('user_profiles').update({ notification_prefs: next }).eq('id', userId);
    if (error) toast.error(error.message);
    else {
      setPrefs(next);
      toast.success(on ? 'Emails on' : 'Emails off');
    }
  }

  const emailOn = useMemo(() => historyEmailOn(prefs), [prefs]);
  const isOwner = access === 'owner';
  const accessText: Record<string, string> = {
    signed_out: 'Sign in to see history requests for your lasers.',
    no_org: 'Your account isn’t part of a clinic yet, so there are no history requests to answer.',
    not_clinic:
      'History requests are answered by the clinic that owns the laser. This page is for clinic owners and admins.',
    not_admin: 'Only your clinic’s owners and admins can answer history requests.',
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Link href="/my-lasers" className="text-sm text-[var(--text3)]">
        ← My lasers
      </Link>
      <h1 className="text-xl font-bold mt-2">Service history requests</h1>
      <p className="text-sm text-[var(--text3)] mt-1">
        Service companies ask to see the earlier service history of your lasers. Nothing is shared unless you approve,
        and you can revoke access on the laser&apos;s page.
      </p>
      {isOwner && (
        <label className="flex items-center gap-2 text-sm mt-3">
          <input type="checkbox" checked={emailOn} onChange={(e) => toggleEmail(e.target.checked)} />
          Email me when a company asks
        </label>
      )}
      {access && !isOwner && !loading ? (
        <div className="card p-5 text-sm text-[var(--text3)] mt-4">{accessText[access]}</div>
      ) : (
        <>
          <div className="flex gap-2 mt-4">
            {(['pending', 'closed'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`btn text-sm ${tab === k ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTab(k)}
              >
                {k === 'pending' ? 'Waiting for you' : 'History'}
              </button>
            ))}
          </div>
          {focusEq && (
            <div className="text-xs text-[var(--text3)] mt-2">
              Showing one laser.{' '}
              <Link href="/my-lasers/history-requests" className="underline">
                Show all
              </Link>
            </div>
          )}
          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="card p-5 text-sm text-[var(--text3)]">Loading…</div>
            ) : listError ? (
              <div className="card p-5 text-sm text-[var(--text3)]">
                {listError === 'unavailable'
                  ? 'History requests aren’t turned on yet. Check back soon.'
                  : listError === 'forbidden'
                    ? 'Only your clinic’s owners and admins can answer history requests.'
                    : 'Couldn’t load requests. Try again.'}
              </div>
            ) : rows.length === 0 ? (
              <div className="card p-5 text-sm text-[var(--text3)]">
                {tab === 'pending' ? 'No requests waiting.' : 'No earlier requests.'}
              </div>
            ) : (
              rows.map((r) => (
                <div
                  key={r.id}
                  className={`card p-4 text-sm ${focusReq === r.id ? 'border border-[var(--gold)]' : ''}`}
                >
                  <div className="font-semibold">{r.shop_name || 'A service company'}</div>
                  <div className="text-[var(--text2)] mt-1">
                    {[r.manufacturer, r.model].filter(Boolean).join(' ') || 'Laser'}
                    {r.serial_number ? ` · SN ${r.serial_number}` : ''}
                  </div>
                  <div className="text-xs text-[var(--text3)] mt-1">
                    {r.teaser_count} earlier report
                    {r.teaser_count === 1 ? '' : 's'}
                    {r.requested_title ? ` · asked about: ${r.requested_title} on ${day(r.requested_date)}` : ''}
                    {r.requested_by_name ? ` · by ${r.requested_by_name}` : ''} · {day(r.created_at)}
                  </div>
                  {r.status === 'pending' ? (
                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap gap-3 text-xs">
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name={`scope-${r.id}`}
                            checked={(scope[r.id] || 'equipment') === 'equipment'}
                            onChange={() => setScope((p) => ({ ...p, [r.id]: 'equipment' }))}
                          />
                          This laser only
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            name={`scope-${r.id}`}
                            checked={scope[r.id] === 'all'}
                            onChange={() => setScope((p) => ({ ...p, [r.id]: 'all' }))}
                          />
                          All my lasers
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn btn-primary text-sm"
                          disabled={busy === r.id}
                          onClick={() => answer(r, 'approve')}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary text-sm"
                          disabled={busy === r.id}
                          onClick={() => answer(r, 'deny')}
                        >
                          Deny
                        </button>
                      </div>
                      <div className="text-xs text-[var(--text3)]">Expires {day(r.expires_at)}</div>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs font-semibold">{closedText(r)}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function HistoryRequestsPage() {
  return (
    <>
      <Header />
      <Suspense fallback={<div className="p-6 text-sm">Loading…</div>}>
        <Inbox />
      </Suspense>
    </>
  );
}
