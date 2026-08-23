'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { estimateCustomerPath } from '@/lib/share';

type PublicEstimate = {
  estimateId?: string | number | null;
  estimateNumber: string;
  customerName: string;
  total: number;
  companyName: string;
  validDays: number;
  validUntil: string | null;
  createdAt: string | null;
  expired: boolean;
  customerAction: 'approved' | 'changes_requested' | null;
  customerActionAt: string | null;
  customerActionNote: string | null;
};

function money(n: number) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function formatDate(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}

export default function EstimateActionClient({ token }: { token: string }) {
  const searchParams = useSearchParams();
  const wantChanges = searchParams.get('changes') === '1';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [est, setEst] = useState<PublicEstimate | null>(null);
  const [note, setNote] = useState('');
  const [showChanges, setShowChanges] = useState(wantChanges);
  const [submitting, setSubmitting] = useState<'approve' | 'request_changes' | null>(null);
  const [done, setDone] = useState<'approved' | 'changes_requested' | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(
          `/api/billing/estimate-action?token=${encodeURIComponent(token)}`,
          { cache: 'no-store' }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.estimate) {
          if (!cancelled) setError(json?.error || 'This estimate link is not valid.');
          return;
        }
        if (json.estimate.estimateId != null) {
          window.location.replace(
            estimateCustomerPath(json.estimate.estimateId, { changes: wantChanges })
          );
          return;
        }
        if (!cancelled) {
          setEst(json.estimate);
          if (json.estimate.customerAction === 'approved') setDone('approved');
        }
      } catch {
        if (!cancelled) setError('Could not load this estimate. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, wantChanges]);

  async function submit(action: 'approve' | 'request_changes') {
    if (action === 'request_changes' && !note.trim()) {
      setError('Please enter a short note describing the changes you need.');
      setShowChanges(true);
      return;
    }
    setSubmitting(action);
    setError('');
    try {
      const res = await fetch('/api/billing/estimate-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          action,
          note: action === 'request_changes' ? note.trim() : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || 'Something went wrong. Please contact the company.');
        if (json?.estimate) setEst(json.estimate);
        return;
      }
      if (json.estimate) setEst(json.estimate);
      setDone(action === 'approve' ? 'approved' : 'changes_requested');
      if (action === 'request_changes') setShowChanges(false);
    } catch {
      setError('Network error. Please try again or call the company.');
    } finally {
      setSubmitting(null);
    }
  }

  const company = est?.companyName || 'the company';

  return (
    <div className="min-h-[80vh] flex flex-col items-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="text-[var(--gold)] font-extrabold tracking-wide text-sm uppercase">
            RepairPlanet
          </div>
          <div className="text-xl font-extrabold mt-1">Total Service Pro</div>
        </div>

        <div className="card p-6 border-[var(--gold-border)]">
          {loading ? (
            <div className="py-10 text-center text-[var(--text3)]">Loading estimate…</div>
          ) : error && !est ? (
            <div className="py-6 text-center">
              <h1 className="text-xl font-extrabold mb-2">Link not valid</h1>
              <p className="text-sm text-[var(--text2)]">{error}</p>
            </div>
          ) : est && done === 'approved' ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">✓</div>
              <h1 className="text-2xl font-extrabold mb-2">Estimate approved</h1>
              <p className="text-[var(--text2)] leading-relaxed">
                We’ve notified <strong className="text-[var(--text)]">{company}</strong>.
                They’ll be in touch to schedule.
              </p>
              {est.estimateNumber && (
                <p className="text-sm text-[var(--text3)] mt-4">
                  {est.estimateNumber} · {money(est.total)}
                </p>
              )}
            </div>
          ) : est && done === 'changes_requested' && !showChanges ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">✉</div>
              <h1 className="text-2xl font-extrabold mb-2">Note sent</h1>
              <p className="text-[var(--text2)] leading-relaxed">
                Your request was sent to <strong className="text-[var(--text)]">{company}</strong>.
                They’ll follow up with you.
              </p>
              <button
                type="button"
                className="btn btn-secondary mt-6"
                onClick={() => {
                  setDone(null);
                  setShowChanges(false);
                }}
              >
                Back to estimate
              </button>
            </div>
          ) : est ? (
            <>
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--gold)] mb-1">
                Service estimate
              </div>
              <h1 className="text-2xl font-extrabold">
                {est.estimateNumber || 'Estimate'}
              </h1>
              <p className="text-sm text-[var(--text3)] mt-1">{company}</p>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text3)]">Customer</div>
                  <div className="font-semibold">{est.customerName}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text3)]">Total</div>
                  <div className="font-extrabold text-[var(--gold)] text-lg">{money(est.total)}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text3)]">Validity</div>
                  <div>
                    {est.expired
                      ? `Expired${est.validUntil ? ` on ${formatDate(est.validUntil)}` : ''}`
                      : `Good for ${est.validDays} days${
                          est.validUntil ? ` (through ${formatDate(est.validUntil)})` : ''
                        }`}
                  </div>
                </div>
              </div>

              {est.customerAction === 'changes_requested' && est.customerActionNote && (
                <div className="mt-4 p-3 rounded-xl border border-amber-700/40 bg-amber-950/20 text-sm">
                  A change request was already sent
                  {est.customerActionAt
                    ? ` on ${formatDate(est.customerActionAt)}`
                    : ''}
                  .
                </div>
              )}

              {est.expired ? (
                <div className="mt-6 p-4 rounded-xl border border-red-700/50 bg-red-950/30 text-sm leading-relaxed">
                  This estimate has expired and can no longer be approved online. Please contact{' '}
                  <strong>{company}</strong> for an updated quote.
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary w-full mt-6 text-base py-3"
                  disabled={!!submitting}
                  onClick={() => submit('approve')}
                >
                  {submitting === 'approve' ? 'Approving…' : 'Approve Estimate'}
                </button>
              )}

              <div className="mt-6 pt-5 border-t border-[var(--border2)]">
                <button
                  type="button"
                  className="btn btn-secondary w-full"
                  disabled={!!submitting}
                  onClick={() => setShowChanges((v) => !v)}
                >
                  Request Changes
                </button>
                {showChanges && (
                  <form
                    className="mt-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submit('request_changes');
                    }}
                  >
                    <label className="text-xs text-[var(--text3)] font-semibold">
                      What would you like changed?
                    </label>
                    <textarea
                      className="input mt-1 min-h-[110px]"
                      required
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Short note for the service company…"
                    />
                    <button
                      type="submit"
                      className="btn btn-primary w-full mt-3"
                      disabled={!!submitting || !note.trim()}
                    >
                      {submitting === 'request_changes' ? 'Sending…' : 'Send note'}
                    </button>
                  </form>
                )}
              </div>

              {error && (
                <p className="text-sm text-red-300 mt-4 text-center">{error}</p>
              )}
            </>
          ) : null}
        </div>

        <p className="text-center text-[11px] text-[var(--text3)] mt-6">
          No account required · Sent via Total Service Pro
        </p>
      </div>
    </div>
  );
}
