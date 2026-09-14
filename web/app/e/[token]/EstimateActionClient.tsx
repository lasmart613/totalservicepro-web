'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  customerActionConfirmationTitle,
  parseCustomerActionKind,
  parseEstimateEmailAction,
  type CustomerActionKind,
  type EstimateEmailAction,
} from '@/lib/billing/save-helpers';

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
  customerAction: CustomerActionKind | null;
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

function actionFromSearch(searchParams: { get: (key: string) => string | null }): EstimateEmailAction | null {
  const explicit = parseEstimateEmailAction(searchParams.get('action'));
  if (explicit) return explicit;
  if (searchParams.get('changes') === '1') return 'modify';
  return null;
}

export default function EstimateActionClient({ token }: { token: string }) {
  const searchParams = useSearchParams();
  const requested = actionFromSearch(searchParams);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [est, setEst] = useState<PublicEstimate | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState<EstimateEmailAction | null>(null);
  const [done, setDone] = useState<CustomerActionKind | null>(null);
  const [already, setAlready] = useState(false);
  const autoPosted = useRef(false);

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
        if (!cancelled) {
          setEst(json.estimate);
          if (json.estimate.customerAction) {
            setDone(json.estimate.customerAction);
            setAlready(true);
          }
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
  }, [token]);

  async function submit(emailAction: EstimateEmailAction, extraNote?: string) {
    const kind = parseCustomerActionKind(emailAction);
    if (!kind) return;
    setSubmitting(emailAction);
    setError('');
    try {
      const res = await fetch('/api/billing/estimate-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          action: emailAction,
          note: extraNote,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || 'Something went wrong. Please contact the company.');
        if (json?.estimate) {
          setEst(json.estimate);
          if (json.estimate.customerAction) {
            setDone(json.estimate.customerAction);
            setAlready(true);
          }
        }
        return;
      }
      if (json.estimate) setEst(json.estimate);
      setDone(parseCustomerActionKind(json.action) || kind);
      setAlready(!!json.already);
    } catch {
      setError('Network error. Please try again or call the company.');
    } finally {
      setSubmitting(null);
    }
  }

  useEffect(() => {
    if (loading || !est || done || est.expired) return;
    if (requested !== 'approve' && requested !== 'reject') return;
    if (autoPosted.current) return;
    autoPosted.current = true;
    void submit(requested);
  }, [loading, est, done, requested]);

  const company = est?.companyName || 'the company';
  const confirmation = customerActionConfirmationTitle(done);
  const autoActing =
    !!est &&
    !done &&
    !est.expired &&
    (requested === 'approve' || requested === 'reject');
  const busy = loading || !!submitting || autoActing;

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
          {busy ? (
            <div className="py-10 text-center text-[var(--text3)]">
              {submitting === 'approve'
                ? 'Approving estimate…'
                : submitting === 'reject'
                  ? 'Recording rejection…'
                  : submitting === 'modify'
                    ? 'Sending modification request…'
                    : 'Loading estimate…'}
            </div>
          ) : error && !est ? (
            <div className="py-6 text-center">
              <h1 className="text-xl font-extrabold mb-2">Link not valid</h1>
              <p className="text-sm text-[var(--text2)]">{error}</p>
            </div>
          ) : est && confirmation ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">
                {done === 'approved' ? '✓' : done === 'rejected' ? '✕' : '✎'}
              </div>
              <h1 className="text-2xl font-extrabold mb-2">{confirmation}</h1>
              <p className="text-[var(--text2)] leading-relaxed">
                {already
                  ? `This estimate was already ${
                      done === 'approved'
                        ? 'approved'
                        : done === 'rejected'
                          ? 'rejected'
                          : 'marked for modification'
                    }. `
                  : null}
                We’ve notified <strong className="text-[var(--text)]">{company}</strong>.
              </p>
              {est.estimateNumber && (
                <p className="text-sm text-[var(--text3)] mt-4">
                  {est.estimateNumber} · {money(est.total)}
                </p>
              )}
              {done === 'changes_requested' && est.customerActionNote && (
                <p className="text-sm mt-4 p-3 rounded-xl border border-[var(--border2)] text-left">
                  {est.customerActionNote}
                </p>
              )}
            </div>
          ) : est ? (
            <>
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--gold)] mb-1">
                Service estimate
              </div>
              <h1 className="text-2xl font-extrabold">{est.estimateNumber || 'Estimate'}</h1>
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

              {est.expired ? (
                <div className="mt-6 p-4 rounded-xl border border-red-700/50 bg-red-950/30 text-sm leading-relaxed">
                  This estimate has expired and can no longer be updated online. Please contact{' '}
                  <strong>{company}</strong> for an updated quote.
                </div>
              ) : requested === 'modify' || !requested ? (
                <>
                  <div className="mt-6 grid gap-3">
                    {!requested && (
                      <button
                        type="button"
                        className="btn btn-primary w-full text-base py-3"
                        disabled={!!submitting}
                        onClick={() => submit('approve')}
                      >
                        Approve
                      </button>
                    )}
                    {!requested && (
                      <button
                        type="button"
                        className="btn w-full"
                        style={{ background: '#7f1d1d', color: '#fecaca', borderColor: '#991b1b' }}
                        disabled={!!submitting}
                        onClick={() => submit('reject')}
                      >
                        Reject
                      </button>
                    )}
                  </div>
                  <form
                    className="mt-6 pt-5 border-t border-[var(--border2)]"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submit('modify', note.trim() || undefined);
                    }}
                  >
                    <label className="text-xs text-[var(--text3)] font-semibold">
                      {requested === 'modify'
                        ? 'Optional note for the service company'
                        : 'Modify — optional note'}
                    </label>
                    <textarea
                      className="input mt-1 min-h-[110px]"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Short note (optional)…"
                    />
                    <button type="submit" className="btn btn-primary w-full mt-3" disabled={!!submitting}>
                      {submitting === 'modify' ? 'Sending…' : 'Request modification'}
                    </button>
                  </form>
                </>
              ) : null}

              {error && <p className="text-sm text-red-300 mt-4 text-center">{error}</p>}
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
