'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  customerActionConfirmationTitle,
  customerActionLabel,
  isEstimateExpired,
  money,
  parseCustomerActionKind,
  validUntilLabel,
  type CustomerActionKind,
  type EstimateEmailAction,
} from '@/lib/billing/save-helpers';
import { ESTIMATE_LIST_POLL_MS } from '@/lib/billing/estimate-list-live';
import { isUnreadPollVisible } from '@/lib/unread-poll';

type InboxRow = {
  estimateId: string | number;
  estimateNumber: string;
  customerName: string;
  total: number;
  companyName: string;
  validUntil: string | null;
  createdAt: string | null;
  expired: boolean;
  customerAction: CustomerActionKind | null;
  customerActionNote: string | null;
  status?: string | null;
  deviceModel?: string | null;
  awaitingAction: boolean;
};

export default function CustomerEstimatesInbox() {
  const supabase = getSupabaseClient();
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState('');

  async function authHeader(): Promise<HeadersInit | null> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  async function loadInbox(): Promise<boolean> {
    try {
      const headers = await authHeader();
      if (!headers) return false;
      const res = await fetch('/api/billing/estimates', { cache: 'no-store', headers });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || 'Could not load estimates.');
        return res.status >= 500;
      }
      setRows(json.estimates || []);
      setError('');
      return false;
    } catch {
      setError('Could not load estimates.');
      return true;
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadInbox();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const channel = supabase
      .channel('clinic-estimates-inbox')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_estimates' },
        () => {
          void loadInbox();
        }
      )
      .subscribe();

    const arm = () => {
      if (stopped || !isUnreadPollVisible(document.visibilityState)) return;
      timer = setTimeout(async () => {
        timer = null;
        if (stopped || !isUnreadPollVisible(document.visibilityState)) return;
        await loadInbox();
        arm();
      }, ESTIMATE_LIST_POLL_MS);
    };
    const onVis = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      arm();
    };
    document.addEventListener('visibilitychange', onVis);
    arm();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  async function submit(row: InboxRow, action: EstimateEmailAction) {
    const key = `${row.estimateId}:${action}`;
    setSubmitting(key);
    setError('');
    try {
      const headers = await authHeader();
      if (!headers) return;
      const res = await fetch(`/api/billing/estimates/${encodeURIComponent(String(row.estimateId))}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action,
          note: action === 'modify' ? note.trim() || undefined : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || 'Could not update this estimate.');
        return;
      }
      const nextAction = parseCustomerActionKind(json.action) || parseCustomerActionKind(action);
      setRows((prev) =>
        prev.map((r) =>
          String(r.estimateId) === String(row.estimateId)
            ? {
                ...r,
                customerAction: nextAction,
                customerActionNote:
                  nextAction === 'changes_requested' ? note.trim() || r.customerActionNote : r.customerActionNote,
                awaitingAction: nextAction === 'changes_requested',
              }
            : r
        )
      );
      setFlash(customerActionConfirmationTitle(nextAction) || 'Estimate updated');
      setNoteFor(null);
      setNote('');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(null);
    }
  }

  const awaiting = rows.filter((r) => r.awaitingAction && !r.expired);
  const others = rows.filter((r) => !awaiting.includes(r));

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="page max-w-4xl mx-auto w-full px-4 py-6 pb-24">
        <h1 className="text-2xl font-extrabold">📝 Estimates</h1>
        <p className="text-[var(--text3)] text-sm mt-1">
          Review quotes from your service company. Approve, reject, or request a modification.
        </p>

        {flash && (
          <div className="mt-4 p-3 rounded-xl border border-green-700/50 bg-green-950/20 text-sm">
            {flash}
          </div>
        )}
        {error && (
          <div className="mt-4 p-3 rounded-xl border border-red-700/50 bg-red-950/20 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="empty-state mt-8">
            <div className="animate-spin h-6 w-6 border-2 border-[var(--gold)] border-t-transparent rounded-full mx-auto" />
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state card p-8 text-center mt-6">
            <div className="text-4xl mb-3">📝</div>
            <div className="font-semibold">No estimates yet</div>
            <p className="text-sm mt-1 text-[var(--text3)]">
              When a service company emails you a quote, it will show up here.
            </p>
          </div>
        ) : (
          <>
            {awaiting.length > 0 && (
              <section className="mt-6">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-[var(--gold)] mb-3">
                  Awaiting your response ({awaiting.length})
                </h2>
                <div className="space-y-3">
                  {awaiting.map((row) => (
                    <InboxCard
                      key={String(row.estimateId)}
                      row={row}
                      note={note}
                      noteOpen={noteFor === String(row.estimateId)}
                      submitting={submitting}
                      onNoteChange={setNote}
                      onToggleNote={() => {
                        const id = String(row.estimateId);
                        setNoteFor((cur) => (cur === id ? null : id));
                        setNote('');
                      }}
                      onSubmit={submit}
                    />
                  ))}
                </div>
              </section>
            )}

            {others.length > 0 && (
              <section className="mt-8">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-[var(--text3)] mb-3">
                  Earlier estimates
                </h2>
                <div className="space-y-3">
                  {others.map((row) => (
                    <InboxCard
                      key={String(row.estimateId)}
                      row={row}
                      note={note}
                      noteOpen={false}
                      submitting={submitting}
                      readOnly
                      onNoteChange={setNote}
                      onToggleNote={() => {}}
                      onSubmit={submit}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function InboxCard({
  row,
  note,
  noteOpen,
  submitting,
  readOnly,
  onNoteChange,
  onToggleNote,
  onSubmit,
}: {
  row: InboxRow;
  note: string;
  noteOpen: boolean;
  submitting: string | null;
  readOnly?: boolean;
  onNoteChange: (v: string) => void;
  onToggleNote: () => void;
  onSubmit: (row: InboxRow, action: EstimateEmailAction) => void;
}) {
  const busy = submitting?.startsWith(`${row.estimateId}:`);
  const until = validUntilLabel(row.createdAt);
  const expired = row.expired || isEstimateExpired({ created_at: row.createdAt, status: row.status });
  const actionLabel = customerActionLabel(row.customerAction);

  return (
    <div className="card p-4 border-[var(--gold-border)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/estimates/${row.estimateId}`} className="font-bold text-base hover:text-[var(--gold)]">
            {row.estimateNumber || 'Estimate'} · {row.companyName}
          </Link>
          <div className="text-xs text-[var(--text3)] mt-1">
            {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—'}
            {expired ? ' · Expired' : until ? ` · Valid thru ${until}` : ''}
            {row.deviceModel ? ` · ${row.deviceModel}` : ''}
          </div>
          {actionLabel && (
            <span
              className={`inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                row.customerAction === 'approved'
                  ? 'bg-green-900/40 text-green-200 border-green-700'
                  : row.customerAction === 'rejected'
                    ? 'bg-red-900/40 text-red-200 border-red-700'
                    : 'bg-amber-900/40 text-amber-200 border-amber-700'
              }`}
            >
              {actionLabel}
            </span>
          )}
          {row.customerActionNote && (
            <div className="text-xs text-[var(--text2)] mt-2">Note: {row.customerActionNote}</div>
          )}
        </div>
        <div className="font-extrabold text-[var(--gold)] text-lg whitespace-nowrap">{money(row.total)}</div>
      </div>

      {!readOnly && !expired && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            type="button"
            className="btn btn-primary text-sm py-2.5"
            disabled={!!busy}
            onClick={() => onSubmit(row, 'approve')}
          >
            {submitting === `${row.estimateId}:approve` ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            className="btn text-sm py-2.5"
            style={{ background: '#7f1d1d', color: '#fecaca', borderColor: '#991b1b' }}
            disabled={!!busy}
            onClick={() => onSubmit(row, 'reject')}
          >
            {submitting === `${row.estimateId}:reject` ? 'Rejecting…' : 'Reject'}
          </button>
          <button
            type="button"
            className="btn btn-secondary text-sm py-2.5"
            disabled={!!busy}
            onClick={onToggleNote}
          >
            Modify
          </button>
        </div>
      )}

      {!readOnly && noteOpen && (
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(row, 'modify');
          }}
        >
          <textarea
            className="input min-h-[80px]"
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="Optional note for the service company…"
          />
          <button type="submit" className="btn btn-primary w-full mt-2" disabled={!!busy}>
            {submitting === `${row.estimateId}:modify` ? 'Sending…' : 'Request modification'}
          </button>
        </form>
      )}
    </div>
  );
}
