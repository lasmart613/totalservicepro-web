'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { loginHref } from '@/lib/login-next';
import { estimateCustomerPath } from '@/lib/share';
import {
  customerActionConfirmationTitle,
  parseCustomerActionKind,
  type CustomerActionKind,
  type EstimateEmailAction,
} from '@/lib/billing/save-helpers';

type EstimateView = {
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
  customerOrgLinked?: boolean;
};

type RequestRef = { id?: string | number | null; number?: string | null } | null;

function money(n: number) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function formatDate(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}

export default function EstimateCustomerClient({
  estimateId,
  wantChanges,
}: {
  estimateId: string;
  wantChanges: boolean;
}) {
  const supabase = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [role, setRole] = useState<'shop' | 'customer' | null>(null);
  const [est, setEst] = useState<EstimateView | null>(null);
  const [request, setRequest] = useState<RequestRef>(null);
  const [note, setNote] = useState('');
  const [showChanges, setShowChanges] = useState(wantChanges);
  const [submitting, setSubmitting] = useState<EstimateEmailAction | null>(null);
  const [done, setDone] = useState<CustomerActionKind | null>(null);

  async function authHeader(): Promise<HeadersInit | null> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const headers = await authHeader();
        if (!headers) {
          window.location.replace(loginHref(estimateCustomerPath(estimateId, { changes: wantChanges })));
          return;
        }
        const res = await fetch(`/api/billing/estimates/${encodeURIComponent(estimateId)}`, {
          cache: 'no-store',
          headers,
        });
        const json = await res.json().catch(() => ({}));
        if (res.status === 401) {
          window.location.replace(loginHref(estimateCustomerPath(estimateId, { changes: wantChanges })));
          return;
        }
        if (!res.ok || !json?.estimate) {
          if (!cancelled) setError(json?.error || 'This estimate is not available.');
          return;
        }
        if (!cancelled) {
          setEst(json.estimate);
          setRole(json.role || null);
          setRequest(json.request || null);
          if (json.estimate.customerAction) {
            setDone(json.estimate.customerAction);
          } else if (json.request?.number) {
            setDone('approved');
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
  }, [estimateId, wantChanges]);

  async function submit(action: EstimateEmailAction) {
    setSubmitting(action);
    setError('');
    try {
      const headers = await authHeader();
      if (!headers) {
        window.location.replace(loginHref(estimateCustomerPath(estimateId)));
        return;
      }
      const res = await fetch(`/api/billing/estimates/${encodeURIComponent(estimateId)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action,
          note: action === 'modify' ? note.trim() || undefined : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.replace(loginHref(estimateCustomerPath(estimateId)));
        return;
      }
      if (!res.ok) {
        setError(json?.error || 'Something went wrong. Please contact the company.');
        if (json?.estimate) setEst(json.estimate);
        return;
      }
      if (json.estimate) setEst(json.estimate);
      if (json.request) setRequest(json.request);
      setDone(parseCustomerActionKind(json.action) || parseCustomerActionKind(action));
      if (action === 'modify') setShowChanges(false);
    } catch {
      setError('Network error. Please try again or call the company.');
    } finally {
      setSubmitting(null);
    }
  }

  const company = est?.companyName || 'the company';
  const requestNumber = request?.number || '';

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex-1 flex flex-col items-center p-6">
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
                <h1 className="text-xl font-extrabold mb-2">Estimate not available</h1>
                <p className="text-sm text-[var(--text2)]">{error}</p>
                <Link href="/" className="btn btn-secondary mt-6 inline-flex">
                  Back to dashboard
                </Link>
              </div>
            ) : est && done && !showChanges ? (
              <div className="text-center py-4">
                <div className="text-4xl mb-3">
                  {done === 'approved' ? '✓' : done === 'rejected' ? '✕' : '✎'}
                </div>
                <h1 className="text-2xl font-extrabold mb-2">
                  {customerActionConfirmationTitle(done)}
                </h1>
                <p className="text-[var(--text2)] leading-relaxed">
                  {done === 'approved' && requestNumber ? (
                    <>
                      Service request <strong className="text-[var(--text)]">{requestNumber}</strong> is
                      unscheduled with <strong className="text-[var(--text)]">{company}</strong>. Other
                      shops cannot see it.
                    </>
                  ) : (
                    <>
                      We’ve notified <strong className="text-[var(--text)]">{company}</strong>.
                    </>
                  )}
                </p>
                {est.estimateNumber && (
                  <p className="text-sm text-[var(--text3)] mt-4">
                    {est.estimateNumber} · {money(est.total)}
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

                {role === 'shop' && (
                  <div className="mt-5 p-3 rounded-xl border border-[var(--border2)] text-sm leading-relaxed">
                    You are signed in as the service company that wrote this estimate. The clinic
                    customer approves it here. It will become an unscheduled request only you can see.
                    <div className="mt-3">
                      <Link href={`/estimates/new?id=${encodeURIComponent(estimateId)}`} className="btn btn-secondary text-sm">
                        Open editor
                      </Link>
                    </div>
                  </div>
                )}

                {est.customerAction === 'changes_requested' && est.customerActionNote && (
                  <div className="mt-4 p-3 rounded-xl border border-amber-700/40 bg-amber-950/20 text-sm">
                    A modification request was already sent
                    {est.customerActionAt ? ` on ${formatDate(est.customerActionAt)}` : ''}.
                  </div>
                )}

                {role === 'customer' &&
                  (est.expired ? (
                    <div className="mt-6 p-4 rounded-xl border border-red-700/50 bg-red-950/30 text-sm leading-relaxed">
                      This estimate has expired and can no longer be updated online. Please contact{' '}
                      <strong>{company}</strong> for an updated quote.
                    </div>
                  ) : (
                    <div className="mt-6 grid gap-3">
                      <button
                        type="button"
                        className="btn btn-primary w-full text-base py-3"
                        disabled={!!submitting}
                        onClick={() => submit('approve')}
                      >
                        {submitting === 'approve' ? 'Approving…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className="btn w-full"
                        style={{ background: '#7f1d1d', color: '#fecaca', borderColor: '#991b1b' }}
                        disabled={!!submitting}
                        onClick={() => submit('reject')}
                      >
                        {submitting === 'reject' ? 'Rejecting…' : 'Reject'}
                      </button>
                    </div>
                  ))}

                {role === 'customer' && !est.expired && (
                  <div className="mt-6 pt-5 border-t border-[var(--border2)]">
                    <button
                      type="button"
                      className="btn btn-secondary w-full"
                      disabled={!!submitting}
                      onClick={() => setShowChanges((v) => !v)}
                    >
                      Modify
                    </button>
                    {showChanges && (
                      <form
                        className="mt-4"
                        onSubmit={(e) => {
                          e.preventDefault();
                          submit('modify');
                        }}
                      >
                        <label className="text-xs text-[var(--text3)] font-semibold">
                          Optional note for the service company
                        </label>
                        <textarea
                          className="input mt-1 min-h-[110px]"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Short note (optional)…"
                        />
                        <button
                          type="submit"
                          className="btn btn-primary w-full mt-3"
                          disabled={!!submitting}
                        >
                          {submitting === 'modify' ? 'Sending…' : 'Request modification'}
                        </button>
                      </form>
                    )}
                  </div>
                )}

                {error && <p className="text-sm text-red-300 mt-4 text-center">{error}</p>}
              </>
            ) : null}
          </div>

          <p className="text-center text-[11px] text-[var(--text3)] mt-6">
            Approving creates one unscheduled request for {company} only — not the marketplace.
          </p>
        </div>
      </div>
    </div>
  );
}
