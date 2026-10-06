'use client';

import React, { useState } from 'react';
import {
  customerActionConfirmationTitle,
  estimateConfirmMode,
  parseCustomerActionKind,
  type CustomerActionKind,
  type EstimateEmailAction,
} from '@/lib/billing/save-helpers';
import { useT } from '@/lib/fa/locale';
import { useFormatDate } from '@/lib/use-format-date';
import { formatOrgMoney } from '@/lib/money-format';

type PublicEstimate = {
  estimateId?: string | number | null;
  estimateNumber: string;
  customerName: string;
  total: number;
  companyName: string;
  validDays: number;
  validUntil: string | null;
  validityText?: string;
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

function fillSlots(template: string, slots: Record<string, React.ReactNode>): React.ReactNode {
  return template.split(/(\{[a-z]+\})/g).map((part, index) => {
    const match = /^\{([a-z]+)\}$/.exec(part);
    if (match && Object.prototype.hasOwnProperty.call(slots, match[1])) {
      return <React.Fragment key={index}>{slots[match[1]]}</React.Fragment>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

export function EstimateLinkFallback({ message }: { message: string }) {
  const t = useT();
  const unavailable = message.includes('temporarily unavailable');
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="text-[var(--gold)] font-extrabold tracking-wide text-sm uppercase">RepairPlanet</div>
      <h1 className="text-xl font-extrabold mb-2 mt-3">
        {unavailable ? t('Temporarily unavailable') : t('Link not valid')}
      </h1>
      <p className="text-sm text-[var(--text2)] max-w-md">{t(message)}</p>
    </div>
  );
}

export default function EstimateActionClient({
  token,
  confirms,
  estimate,
  requested,
  justCompleted,
  notice,
}: {
  token: string;
  confirms: Record<EstimateEmailAction, string>;
  estimate: PublicEstimate;
  requested: EstimateEmailAction | null;
  justCompleted: CustomerActionKind | null;
  notice: string;
}) {
  const t = useT();
  const { format } = useFormatDate();
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
  const [notified, setNotified] = useState(freshCompletion != null);

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
          confirm: confirms[emailAction],
          action: emailAction,
          note: extraNote,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json?.already && json?.conflict) {
        if (json.estimate) setEst(json.estimate);
        setDone(parseCustomerActionKind(json.action) || kind);
        setAlready(true);
        setNotified(false);
        setError('');
        return;
      }
      if (!res.ok) {
        setError(json?.error || 'Something went wrong. Please contact the company.');
        if (json?.estimate) setEst(json.estimate);
        return;
      }
      if (json.estimate) setEst(json.estimate);
      setDone(parseCustomerActionKind(json.action) || kind);
      setAlready(!!json.already);
      setNotified(!json.already);
    } catch {
      setError('Network error. Please try again or call the company.');
    } finally {
      setSubmitting(null);
    }
  }

  const company = est.companyName || t('the company');
  const through = est.validUntil
    ? format(est.validUntil, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  const validity = est.expired
    ? through
      ? t('Expired on {date}').replace('{date}', through)
      : t('Expired')
    : through
      ? t('Good for {days} days (through {date})')
          .replace('{days}', String(est.validDays))
          .replace('{date}', through)
      : t('Good for {days} days').replace('{days}', String(est.validDays));
  const alreadyLine =
    done === 'approved'
      ? t('This estimate was already approved.')
      : done === 'rejected'
        ? t('This estimate was already rejected.')
        : t('This estimate was already marked for modification.');
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
                ? t('Approving estimate…')
                : submitting === 'reject'
                  ? t('Recording rejection…')
                  : t('Sending modification request…')}
            </div>
          ) : showConfirmation && confirmation ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">
                {done === 'approved' ? '✓' : done === 'rejected' ? '✕' : '✎'}
              </div>
              <h1 className="text-2xl font-extrabold mb-2">{t(confirmation)}</h1>
              <p className="text-[var(--text2)] leading-relaxed">
                {already
                  ? alreadyLine
                  : notified
                    ? fillSlots(t('We’ve notified {company}.'), {
                        company: <strong className="text-[var(--text)]">{company}</strong>,
                      })
                    : null}
              </p>
              {est.estimateNumber && (
                <p className="text-sm text-[var(--text3)] mt-4">
                  {est.estimateNumber} · {money(est.total, est.currencyCode, est.numberFormat)}
                </p>
              )}
              {(done === 'changes_requested' || done === 'rejected') && (est.customerActionNote || note || rejectNote) && (
                <p className="text-sm mt-4 p-3 rounded-xl border border-[var(--border2)] text-start">
                  {est.customerActionNote || (done === 'rejected' ? rejectNote : note)}
                </p>
              )}
              {done === 'changes_requested' && (
                <p className="text-sm text-[var(--text2)] mt-4 leading-relaxed">
                  {fillSlots(t('You can still {approve} or {reject}.'), {
                    approve: (
                      <a className="underline" href="?action=approve">
                        {t('approve this estimate')}
                      </a>
                    ),
                    reject: (
                      <a className="underline" href="?action=reject">
                        {t('reject it')}
                      </a>
                    ),
                  })}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--gold)] mb-1">
                {t('Service estimate')}
              </div>
              <h1 className="text-2xl font-extrabold">{est.estimateNumber || t('Estimate')}</h1>
              <p className="text-sm text-[var(--text3)] mt-1">{company}</p>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text3)]">{t('Customer')}</div>
                  <div className="font-semibold">{est.customerName}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text3)]">{t('Total')}</div>
                  <div className="font-extrabold text-[var(--gold)] text-lg">
                    {money(est.total, est.currencyCode, est.numberFormat)}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text3)]">{t('Validity')}</div>
                  <div>{validity}</div>
                </div>
              </div>

              {mode.kind !== 'expired' && (mode.kind === 'confirm' || mode.kind === 'choose') && mode.priorModification && (
                <div className="mt-5 p-3 rounded-xl border border-[var(--border2)] text-sm text-start leading-relaxed">
                  {est.customerActionNote
                    ? t('You requested a modification: “{note}”. You can still approve or reject this estimate.').replace(
                        '{note}',
                        est.customerActionNote,
                      )
                    : t('You requested a modification. You can still approve or reject this estimate.')}
                </div>
              )}

              {mode.kind === 'expired' ? (
                <div className="mt-6 p-4 rounded-xl border border-red-700/50 bg-red-950/30 text-sm leading-relaxed">
                  {fillSlots(
                    t('This estimate has expired and can no longer be updated online. Please contact {company} for an updated quote.'),
                    { company: <strong>{company}</strong> },
                  )}
                </div>
              ) : (
                <div className="mt-6">
                  <p className="text-sm text-[var(--text2)] leading-relaxed mb-4">
                    {t('Review the total, then confirm. Opening this page does not approve or reject the estimate.')}
                  </p>
                  {(mode.kind === 'choose' || (mode.kind === 'confirm' && mode.action === 'approve')) && (
                    <ConfirmForm
                      token={token}
                      confirm={confirms.approve}
                      action="approve"
                      label={t('Approve estimate')}
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
                      <input type="hidden" name="confirm" value={confirms.reject} />
                      <input type="hidden" name="action" value="reject" />
                      <label className="text-xs text-[var(--text3)] font-semibold" htmlFor="reject-reason">
                        {t('Reason for rejecting (optional)')}
                      </label>
                      <textarea
                        id="reject-reason"
                        name="note"
                        className="input mt-1 min-h-[90px]"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder={t('Optional reason…')}
                      />
                      <button
                        type="submit"
                        className="btn w-full mt-3 text-base py-3"
                        style={{ background: '#7f1d1d', color: '#fecaca', borderColor: '#991b1b' }}
                        disabled={!!submitting}
                      >
                        {t('Reject estimate')}
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
                      <input type="hidden" name="confirm" value={confirms.modify} />
                      <input type="hidden" name="action" value="modify" />
                      <label className="text-xs text-[var(--text3)] font-semibold" htmlFor="modify-note">
                        {t('Optional note for the service company')}
                      </label>
                      <textarea
                        id="modify-note"
                        name="note"
                        className="input mt-1 min-h-[110px]"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={t('Short note (optional)…')}
                      />
                      <button type="submit" className="btn btn-primary w-full mt-3" disabled={!!submitting}>
                        {t('Request modification')}
                      </button>
                    </form>
                  )}
                  {mode.kind === 'confirm' && mode.action === 'approve' && (
                    <p className="text-center text-sm mt-4">
                      <a className="underline text-[var(--text3)]" href="?action=reject">
                        {t('Reject instead')}
                      </a>
                    </p>
                  )}
                  {mode.kind === 'confirm' && mode.action === 'reject' && (
                    <p className="text-center text-sm mt-4">
                      <a className="underline text-[var(--text3)]" href="?action=approve">
                        {t('Approve instead')}
                      </a>
                    </p>
                  )}
                  {mode.kind === 'confirm' && mode.action === 'modify' && (
                    <p className="text-center text-sm mt-4 text-[var(--text2)]">
                      {fillSlots(t('Or {approve} or {reject}.'), {
                        approve: (
                          <a className="underline" href="?action=approve">
                            {t('approve this estimate')}
                          </a>
                        ),
                        reject: (
                          <a className="underline" href="?action=reject">
                            {t('reject it')}
                          </a>
                        ),
                      })}
                    </p>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-red-300 mt-4 text-center">{t(error)}</p>}
            </>
          )}
        </div>

        <p className="text-center text-[11px] text-[var(--text3)] mt-6">
          {t('No account required · Sent via Total Service Pro')}
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
