'use client';

import React, { useState } from 'react';
import {
  customerActionConfirmationTitle,
  estimateConfirmMode,
  parseCustomerActionKind,
  type CustomerActionKind,
  type EstimateEmailAction,
} from '@/lib/billing/save-helpers';
import { formatOrgMoney } from '@/lib/money-format';

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
  currencyCode?: string | null;
  numberFormat?: string | null;
};

function money(n: number, currencyCode?: string | null, numberFormat?: string | null) {
  return formatOrgMoney(n, { currencyCode, numberFormat });
}

function formatDate(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}

function noticeMessage(notice: string) {
  if (notice === 'confirm') {
    return 'Use the button on this page. Opening the email link does not approve or reject the estimate.';
  }
  if (notice === 'expired') {
    return 'This estimate has expired and can no longer be updated online.';
  }
  if (notice === 'failed') return 'Something went wrong. Please try the button again.';
  return '';
}

function actionVerb(action: CustomerActionKind | null) {
  if (action === 'approved') return 'approved';
  if (action === 'rejected') return 'rejected';
  return 'marked for modification';
}

export default function EstimateActionClient({
  token,
  confirm,
  estimate,
  requested,
  justCompleted,
  notice,
}: {
  token: string;
  confirm: string;
  estimate: PublicEstimate;
  requested: EstimateEmailAction | null;
  justCompleted: CustomerActionKind | null;
  notice: string;
}) {
  const [est, setEst] = useState(estimate);
  const [note, setNote] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [submitting, setSubmitting] = useState<EstimateEmailAction | null>(null);
  const [error, setError] = useState(noticeMessage(notice));
  const freshCompletion =
    justCompleted != null && justCompleted === estimate.customerAction ? justCompleted : null;
  const [done, setDone] = useState<CustomerActionKind | null>(
    freshCompletion ||
      (estimate.customerAction === 'approved' || estimate.customerAction === 'rejected'
        ? estimate.customerAction
        : null)
  );
  const [already, setAlready] = useState(
    (estimate.customerAction === 'approved' || estimate.customerAction === 'rejected') && !freshCompletion
  );

  async function submit(emailAction: EstimateEmailAction, extraNote?: string) {
    const kind = parseCustomerActionKind(emailAction);
    if (!kind || submitting) return;
    setSubmitting(emailAction);
    setError('');
    try {
      const res = await fetch('/api/billing/estimate-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          token,
          confirm,
          action: emailAction,
          note: extraNote,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || 'Something went wrong. Please contact the company.');
        if (json?.estimate) setEst(json.estimate);
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

  const company = est.companyName || 'the company';
  const mode = estimateConfirmMode({
    expired: est.expired,
    customerAction: done || est.customerAction,
    requested,
  });
  const confirmation = customerActionConfirmationTitle(done);
  const showConfirmation = !!confirmation && (mode.kind === 'final' || done === 'changes_requested');

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
          {submitting ? (
            <div className="py-10 text-center text-[var(--text3)]">
              {submitting === 'approve'
                ? 'Approving estimate…'
                : submitting === 'reject'
                  ? 'Recording rejection…'
                  : 'Sending modification request…'}
            </div>
          ) : showConfirmation && confirmation ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">
                {done === 'approved' ? '✓' : done === 'rejected' ? '✕' : '✎'}
              </div>
              <h1 className="text-2xl font-extrabold mb-2">{confirmation}</h1>
              <p className="text-[var(--text2)] leading-relaxed">
                {already ? `This estimate was already ${actionVerb(done)}. ` : null}
                We’ve notified <strong className="text-[var(--text)]">{company}</strong>.
              </p>
              {est.estimateNumber && (
                <p className="text-sm text-[var(--text3)] mt-4">
                  {est.estimateNumber} · {money(est.total, est.currencyCode, est.numberFormat)}
                </p>
              )}
              {(done === 'changes_requested' || done === 'rejected') && (est.customerActionNote || note || rejectNote) && (
                <p className="text-sm mt-4 p-3 rounded-xl border border-[var(--border2)] text-left">
                  {est.customerActionNote || (done === 'rejected' ? rejectNote : note)}
                </p>
              )}
              {done === 'changes_requested' && (
                <p className="text-sm text-[var(--text2)] mt-4 leading-relaxed">
                  You can still{' '}
                  <a className="underline" href="?action=approve">
                    approve this estimate
                  </a>{' '}
                  or{' '}
                  <a className="underline" href="?action=reject">
                    reject it
                  </a>
                  .
                </p>
              )}
            </div>
          ) : (
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
                  <div className="font-extrabold text-[var(--gold)] text-lg">
                    {money(est.total, est.currencyCode, est.numberFormat)}
                  </div>
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

              {mode.kind !== 'expired' && (mode.kind === 'confirm' || mode.kind === 'choose') && mode.priorModification && (
                <div className="mt-5 p-3 rounded-xl border border-[var(--border2)] text-sm text-left leading-relaxed">
                  You requested a modification
                  {est.customerActionNote ? `: “${est.customerActionNote}”` : ''}. You can still approve or
                  reject this estimate.
                </div>
              )}

              {mode.kind === 'expired' ? (
                <div className="mt-6 p-4 rounded-xl border border-red-700/50 bg-red-950/30 text-sm leading-relaxed">
                  This estimate has expired and can no longer be updated online. Please contact{' '}
                  <strong>{company}</strong> for an updated quote.
                </div>
              ) : (
                <div className="mt-6">
                  <p className="text-sm text-[var(--text2)] leading-relaxed mb-4">
                    Review the total, then confirm. Opening this page does not approve or reject the estimate.
                  </p>
                  {(mode.kind === 'choose' || (mode.kind === 'confirm' && mode.action === 'approve')) && (
                    <ConfirmForm
                      token={token}
                      confirm={confirm}
                      action="approve"
                      label="Approve estimate"
                      className="btn btn-primary w-full text-base py-3"
                      disabled={!!submitting}
                      onSubmit={() => submit('approve')}
                    />
                  )}
                  {(mode.kind === 'choose' || (mode.kind === 'confirm' && mode.action === 'reject')) && (
                    <form
                      className={mode.kind === 'choose' ? 'mt-4' : ''}
                      method="POST"
                      action="/api/billing/estimate-action"
                      onSubmit={(e) => {
                        e.preventDefault();
                        submit('reject', rejectNote.trim() || undefined);
                      }}
                    >
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="confirm" value={confirm} />
                      <input type="hidden" name="action" value="reject" />
                      <label className="text-xs text-[var(--text3)] font-semibold" htmlFor="reject-reason">
                        Reason for rejecting (optional)
                      </label>
                      <textarea
                        id="reject-reason"
                        name="note"
                        className="input mt-1 min-h-[90px]"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="Optional reason…"
                      />
                      <button
                        type="submit"
                        className="btn w-full mt-3 text-base py-3"
                        style={{ background: '#7f1d1d', color: '#fecaca', borderColor: '#991b1b' }}
                        disabled={!!submitting}
                      >
                        Reject estimate
                      </button>
                    </form>
                  )}
                  {(mode.kind === 'choose' || (mode.kind === 'confirm' && mode.action === 'modify')) && (
                    <form
                      className="mt-6 pt-5 border-t border-[var(--border2)]"
                      method="POST"
                      action="/api/billing/estimate-action"
                      onSubmit={(e) => {
                        e.preventDefault();
                        submit('modify', note.trim() || undefined);
                      }}
                    >
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="confirm" value={confirm} />
                      <input type="hidden" name="action" value="modify" />
                      <label className="text-xs text-[var(--text3)] font-semibold" htmlFor="modify-note">
                        Optional note for the service company
                      </label>
                      <textarea
                        id="modify-note"
                        name="note"
                        className="input mt-1 min-h-[110px]"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Short note (optional)…"
                      />
                      <button type="submit" className="btn btn-primary w-full mt-3" disabled={!!submitting}>
                        Request modification
                      </button>
                    </form>
                  )}
                  {mode.kind === 'confirm' && mode.action === 'approve' && (
                    <p className="text-center text-sm mt-4">
                      <a className="underline text-[var(--text3)]" href="?action=reject">
                        Reject instead
                      </a>
                    </p>
                  )}
                  {mode.kind === 'confirm' && mode.action === 'reject' && (
                    <p className="text-center text-sm mt-4">
                      <a className="underline text-[var(--text3)]" href="?action=approve">
                        Approve instead
                      </a>
                    </p>
                  )}
                  {mode.kind === 'confirm' && mode.action === 'modify' && (
                    <p className="text-center text-sm mt-4 text-[var(--text2)]">
                      Or{' '}
                      <a className="underline" href="?action=approve">
                        approve this estimate
                      </a>{' '}
                      or{' '}
                      <a className="underline" href="?action=reject">
                        reject it
                      </a>
                      .
                    </p>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-red-300 mt-4 text-center">{error}</p>}
            </>
          )}
        </div>

        <p className="text-center text-[11px] text-[var(--text3)] mt-6">
          No account required · Sent via Total Service Pro
        </p>
      </div>
    </div>
  );
}

function ConfirmForm({
  token,
  confirm,
  action,
  label,
  className,
  disabled,
  onSubmit,
}: {
  token: string;
  confirm: string;
  action: EstimateEmailAction;
  label: string;
  className: string;
  disabled: boolean;
  onSubmit: () => void;
}) {
  return (
    <form
      method="POST"
      action="/api/billing/estimate-action"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="confirm" value={confirm} />
      <input type="hidden" name="action" value={action} />
      <button type="submit" className={className} disabled={disabled}>
        {label}
      </button>
    </form>
  );
}
