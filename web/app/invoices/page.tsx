'use client';
import { useFormatDate } from '@/lib/use-format-date';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Header } from '@/components/Header';
import { useT } from '@/lib/fa/locale';
import { useOrgMoney } from '@/lib/use-org-money';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  coerceOrgId,
  isValidOrgId,
  parseJsonField,
} from '@/lib/billing/save-helpers';
import { buildInvoicePaymentPatch, existingPaidAmount } from '@/lib/billing/apply-invoice-payment';
import { canVoidInvoice, isVoidInvoiceStatus } from '@/lib/billing/void-invoice';
import { getOrgRole, voidInvoiceRole } from '@/lib/org-role';
import {
  releaseDeferredBalance,
  resolveInvoiceCollectable,
} from '@/lib/billing/invoice-collectable';
import { toast } from 'sonner';
import { DEFAULT_ORG_TIMEZONE, formatOrgDocumentDate, resolveNumberingTimeZone } from '@/lib/org-timezone';
import {
  invoiceListReloadSilently,
  invoiceListStatus,
  invoiceMatchesListFilter,
  invoiceStatusBadgeClass,
  invoiceStatusLabel,
  mergeInvoiceRows,
  readNativeSessionRestore,
  refreshStaleInvoiceSession,
  sessionNeedsRefresh,
  shouldRetryEmptyInvoiceList,
  subscribeInvoiceListResume,
} from '@/lib/billing/invoice-list';

type InvFilter = 'all' | 'draft' | 'sent' | 'paid' | 'partially_paid' | 'void';

type InvoiceRow = {
  id: string | number;
  customer_name?: string | null;
  status?: string | null;
  total?: number | null;
  invoice_date?: string | null;
  created_at?: string | null;
  invoice_number?: string | null;
  invoice_data?: any;
  organization_id?: any;
  created_by?: string | null;
};

function docNumber(inv: InvoiceRow): string {
  const idata = parseJsonField(inv.invoice_data);
  return inv.invoice_number || idata.invoice_number || idata.invNumber || '';
}

export default function InvoicesListPage() {
  const { money } = useOrgMoney();
  const t = useT();
  const { locale } = useFormatDate();
  const supabase = getSupabaseClient();
  const router = useRouter();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [filtered, setFiltered] = useState<InvoiceRow[]>([]);
  const [activeFilter, setActiveFilter] = useState<InvFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [payRow, setPayRow] = useState<InvoiceRow | null>(null);
  const [payAmt, setPayAmt] = useState('');
  const [payMethod, setPayMethod] = useState('Check');
  const [paying, setPaying] = useState(false);
  const [callerRole, setCallerRole] = useState('');
  const [voidRow, setVoidRow] = useState<InvoiceRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [docZone, setDocZone] = useState(DEFAULT_ORG_TIMEZONE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initGen = useRef(0);
  const rowsRef = useRef<InvoiceRow[]>([]);
  rowsRef.current = rows;

  useEffect(() => {
    void init();
    const stopResume = subscribeInvoiceListResume(() => {
      void init({ silent: invoiceListReloadSilently(rowsRef.current.length) });
    });
    try {
      const sid = new URL(window.location.href).searchParams.get('session_id');
      if (sid) {
        fetch('/api/billing/invoices/confirm?session_id=' + encodeURIComponent(sid))
          .then((r) => r.json())
          .then((j) => {
            if (j?.ok) {
              toast.success(j.status === 'partially_paid' ? 'Partial Stripe payment recorded.' : 'Stripe payment recorded — marked paid.');
              init();
            }
          })
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
    return () => {
      stopResume();
    };
  }, []);

  useEffect(() => {
    applyFilters();
  }, [rows, activeFilter, search]);

  async function ensureFreshInvoiceSession(): Promise<boolean> {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session?.access_token) {
      router.push('/login');
      throw new Error('SIGN_IN_REQUIRED');
    }
    const stale = sessionNeedsRefresh(session.expires_at, Date.now());
    if (!stale) return false;
    await refreshStaleInvoiceSession({
      restoreNative: readNativeSessionRestore(typeof window !== 'undefined' ? window : null),
      refreshSession: () => supabase.auth.refreshSession(),
    });
    const again = await supabase.auth.getSession();
    if (!again.data.session?.access_token) {
      router.push('/login');
      throw new Error('SIGN_IN_REQUIRED');
    }
    return true;
  }

  async function init(opts?: { silent?: boolean }) {
    const gen = ++initGen.current;
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const sessionWasStale = await ensureFreshInvoiceSession();
      if (gen !== initGen.current) return;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id, role')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) throw new Error(profileError.message || 'Could not load your profile');
      const orgId = coerceOrgId(profile?.organization_id);
      const orgForLookups = isValidOrgId(orgId) ? orgId : null;
      // Role and timezone paint the void button and dates. They must not hold the list query.
      void getOrgRole(supabase, user.id, orgForLookups)
        .then((looked) => {
          if (gen !== initGen.current) return;
          setCallerRole(looked.ok ? voidInvoiceRole(looked) : '');
        })
        .catch(() => {
          if (gen !== initGen.current) return;
          setCallerRole('');
        });
      void resolveNumberingTimeZone(supabase, orgForLookups, { allowBrowser: false })
        .then((zone) => {
          if (gen !== initGen.current) return;
          setDocZone(zone.timeZone);
        })
        .catch(() => {});
      await loadInvoices(orgId, user.id, { sessionWasStale, gen, preserveOnError: silent });
    } catch (e) {
      if (gen !== initGen.current) return;
      if (e instanceof Error && e.message === 'SIGN_IN_REQUIRED') return;
      setLoadError(e instanceof Error ? e.message : 'Could not load invoices');
    } finally {
      if (gen === initGen.current) setLoading(false);
    }
  }

  async function loadInvoices(
    orgId: string | number | null,
    userId: string,
    opts: { sessionWasStale: boolean; gen: number; preserveOnError?: boolean }
  ) {
    const run = async () => {
      const errors: string[] = [];
      const batches: InvoiceRow[][] = [];
      if (isValidOrgId(orgId)) {
        const q1 = await supabase
          .from('service_invoices')
          .select('*')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .limit(150);
        if (q1.error) errors.push(q1.error.message || 'Could not load company invoices');
        else batches.push((q1.data || []) as InvoiceRow[]);
      }

      const q2 = await supabase
        .from('service_invoices')
        .select('*')
        .eq('created_by', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (q2.error) errors.push(q2.error.message || 'Could not load your invoices');
      else batches.push((q2.data || []) as InvoiceRow[]);
      return { rows: mergeInvoiceRows(batches), errors };
    };

    let { rows, errors } = await run();
    if (
      shouldRetryEmptyInvoiceList({
        sessionWasStale: opts.sessionWasStale,
        rowCount: rows.length,
        hadError: errors.length > 0,
        alreadyRetried: false,
      })
    ) {
      await refreshStaleInvoiceSession({
        restoreNative: readNativeSessionRestore(typeof window !== 'undefined' ? window : null),
        refreshSession: () => supabase.auth.refreshSession(),
      });
      ({ rows, errors } = await run());
    }
    if (opts.gen !== initGen.current) return;

    if (isValidOrgId(orgId)) {
      for (const r of rows) {
        if (r.created_by === userId && (r.organization_id == null || r.organization_id === '')) {
          supabase
            .from('service_invoices')
            .update({ organization_id: orgId })
            .eq('id', r.id)
            .then(() => {});
        }
      }
    }

    if (opts.preserveOnError && errors.length) {
      setLoadError(errors.join(' '));
      return;
    }
    setRows(rows);
    setLoadError(errors.length ? errors.join(' ') : null);
  }

  function applyFilters() {
    let res = rows.filter((e) => invoiceMatchesListFilter(e, activeFilter));
    const q = search.trim().toLowerCase();
    if (q) {
      res = res.filter((e) => {
        const hay = [e.customer_name, docNumber(e), e.status, String(e.total ?? '')]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    setFiltered(res);
  }

  async function submitVoid() {
    if (!voidRow) return;
    setVoiding(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const access = sessionData.session?.access_token;
      if (!access) throw new Error('Sign in required');
      const res = await fetch('/api/billing/invoices/void', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ invoice_id: voidRow.id, reason: voidReason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not void invoice');
      toast.success('Invoice voided');
      setVoidRow(null);
      setVoidReason('');
      await init();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not void invoice');
    } finally {
      setVoiding(false);
    }
  }

  async function applyManualPayment(inv: InvoiceRow, addAmount: number, method: string) {
    setPaying(true);
    try {
      const patch = buildInvoicePaymentPatch({
        invoice: inv,
        addAmount,
        method,
      });
      const payload: Record<string, unknown> = { ...patch };
      let lastErr: { message?: string } | null = null;
      for (let i = 0; i < 8; i++) {
        const { error } = await supabase.from('service_invoices').update(payload).eq('id', inv.id);
        if (!error) {
          lastErr = null;
          break;
        }
        lastErr = error;
        const col = error.message?.match(/Could not find the '([^']+)' column/i)?.[1];
        if (col && col in payload) {
          delete payload[col];
          continue;
        }
        break;
      }
      if (lastErr) throw new Error(lastErr.message);
      toast.success(patch.status === 'paid' ? 'Invoice marked paid.' : 'Partial payment recorded.');
      setPayRow(null);
      await init();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not record payment');
    } finally {
      setPaying(false);
    }
  }

  async function collectRemaining(inv: InvoiceRow) {
    const split = resolveInvoiceCollectable({
      total: inv.total,
      amountPaid: existingPaidAmount(inv),
      invoice_data: parseJsonField(inv.invoice_data),
    });
    if (!split.hasDeferredSplit || split.deferredReleased) {
      toast.message('No deferred remainder to collect.');
      return;
    }
    if (
      !confirm(
        `Release the remaining ${money(split.deferredUnpaid)} so the Stripe pay link can charge it? Open the invoice and email/resend to send the new link.`
      )
    ) {
      return;
    }
    try {
      const idata = releaseDeferredBalance(parseJsonField(inv.invoice_data));
      const { error } = await supabase
        .from('service_invoices')
        .update({ invoice_data: idata, updated_at: new Date().toISOString() })
        .eq('id', inv.id);
      if (error) throw new Error(error.message);
      toast.success('Remaining balance is now collectable. Email the invoice to send a Stripe pay link.');
      await init();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not release remaining balance');
    }
  }

  const drafts = rows.filter((r) => invoiceListStatus(r) === 'draft').length;
  const sent = rows.filter((r) => invoiceListStatus(r) === 'sent').length;
  const partial = rows.filter((r) => invoiceListStatus(r) === 'partially_paid').length;
  const paid = rows.filter((r) => invoiceListStatus(r) === 'paid').length;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="page max-w-7xl mx-auto w-full px-4 py-6 pb-24">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-extrabold">🧾 {t('Invoices')}</h1>
            <p className="text-[var(--text3)] text-sm">{t('Billing & collections')}</p>
          </div>
          <Link href="/invoices/new" className="btn btn-primary hidden sm:flex items-center gap-2">
            <Plus size={18} /> {t('New Invoice')}
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-[var(--gold)]">{loading ? '—' : drafts}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">
              {t('DRAFTS')}
            </div>
          </div>
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-blue-300">{loading ? '—' : sent}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">
              {t('SENT')}
            </div>
          </div>
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-amber-300">{loading ? '—' : partial}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">
              {t('PARTIAL')}
            </div>
          </div>
          <div className="stat-card card p-3 text-center">
            <div className="text-2xl font-extrabold text-[var(--green)]">{loading ? '—' : paid}</div>
            <div className="text-[10px] font-semibold tracking-wider text-[var(--text3)] mt-1">
              {t('PAID')}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <input
            className="input"
            placeholder={t('Search customer, invoice #...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {(
            [
              ['all', 'All'],
              ['draft', 'Drafts'],
              ['sent', 'Sent'],
              ['partially_paid', 'Partial'],
              ['paid', 'Paid'],
              ['void', 'Void'],
            ] as [InvFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`filter-chip ${activeFilter === key ? 'active' : ''}`}
              onClick={() => setActiveFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {loadError && !loading && (
          <div className="card p-4 mb-4 border border-rose-700" role="alert">
            <p className="font-semibold text-rose-200">Could not load invoices</p>
            <p className="text-sm text-[var(--text3)] mt-1">{loadError}</p>
            <button type="button" className="btn btn-secondary mt-3" onClick={() => void init()}>
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="empty-state">
            <div className="animate-spin h-6 w-6 border-2 border-[var(--gold)] border-t-transparent rounded-full mx-auto" />
          </div>
        ) : filtered.length === 0 && !loadError ? (
          <div className="empty-state card p-8 text-center">
            <div className="text-4xl mb-3">🧾</div>
            <div className="font-semibold">{t('No invoices yet')}</div>
            <p className="text-sm mt-1 text-[var(--text3)]">
              Create an invoice or convert from an estimate.
            </p>
            <Link href="/invoices/new" className="btn btn-primary mt-4 inline-flex">
              + {t('New Invoice')}
            </Link>
          </div>
        ) : filtered.length === 0 ? null : (
          <div className="space-y-3">
            {filtered.map((inv) => {
              const st = invoiceListStatus(inv);
              const num = docNumber(inv);
              const dateStr =
                formatOrgDocumentDate(inv.invoice_date || inv.created_at, docZone, locale) || '—';
              const alreadyPaid = st === 'paid' || isVoidInvoiceStatus(st);
              const voidable = canVoidInvoice({
                status: inv.status,
                amount_paid: existingPaidAmount(inv),
                invoice_data: inv.invoice_data,
                role: callerRole,
              }).ok;
              return (
                <div
                  key={String(inv.id)}
                  className="card p-4 flex flex-wrap items-center justify-between gap-3 hover:border-[var(--gold-border)]"
                >
                  <Link href={`/invoices/new?id=${inv.id}`} className="flex-1 min-w-0">
                    <div className="font-bold text-base truncate">
                      {inv.customer_name || 'Unknown Customer'}
                    </div>
                    <div className="text-xs text-[var(--text3)] mt-1 flex flex-wrap gap-x-2 gap-y-1 items-center">
                      {num && <span className="text-[var(--gold)] font-bold">{num}</span>}
                      <span>{dateStr}</span>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${invoiceStatusBadgeClass(
                          st
                        )}`}
                      >
                        {invoiceStatusLabel(st)}
                      </span>
                    </div>
                  </Link>
                  <div className="font-bold text-[var(--gold)] text-lg flex-shrink-0 text-right">
                    <div>{money(Number(inv.total) || 0)}</div>
                    {(() => {
                      const split = resolveInvoiceCollectable({
                        total: inv.total,
                        amountPaid: existingPaidAmount(inv),
                        invoice_data: parseJsonField(inv.invoice_data),
                      });
                      if (!split.hasDeferredSplit) return null;
                      if (split.deferredReleased) {
                        return (
                          <div className="text-[10px] font-semibold text-[var(--text3)]">
                            Balance due {money(split.stripeAmount)}
                          </div>
                        );
                      }
                      return (
                        <div className="text-[10px] font-semibold text-amber-200">
                          {split.amountPaid > 0
                            ? `Deposit paid · ${money(split.deferredUnpaid)} due on completion`
                            : `Due now ${money(split.stripeAmount)} · ${money(split.deferredUnpaid)} deferred`}
                        </div>
                      );
                    })()}
                  </div>
                  {!alreadyPaid && (
                    <div className="flex gap-2 w-full sm:w-auto flex-wrap">
                      <button
                        type="button"
                        className="btn btn-secondary text-xs"
                        onClick={() => {
                          setPayRow(inv);
                          const split = resolveInvoiceCollectable({
                            total: inv.total,
                            amountPaid: existingPaidAmount(inv),
                            invoice_data: parseJsonField(inv.invoice_data),
                          });
                          const remain = split.stripeAmount || split.remainingOwed;
                          setPayAmt(remain ? String(remain) : '');
                          setPayMethod('Check');
                        }}
                      >
                        Record payment
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary text-xs"
                        onClick={() =>
                          applyManualPayment(
                            inv,
                            Math.max(0, Number(inv.total || 0) - existingPaidAmount(inv)),
                            'Other'
                          )
                        }
                      >
                        {t('Mark paid')}
                      </button>
                      {(() => {
                        const split = resolveInvoiceCollectable({
                          total: inv.total,
                          amountPaid: existingPaidAmount(inv),
                          invoice_data: parseJsonField(inv.invoice_data),
                        });
                        if (!split.hasDeferredSplit || split.deferredReleased) return null;
                        return (
                          <button
                            type="button"
                            className="btn btn-secondary text-xs"
                            onClick={() => collectRemaining(inv)}
                          >
                            Collect remaining
                          </button>
                        );
                      })()}
                      {voidable && (
                        <button
                          type="button"
                          className="btn btn-secondary text-xs"
                          onClick={() => {
                            setVoidRow(inv);
                            setVoidReason('');
                          }}
                        >
                          Void invoice
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Link href="/invoices/new" className="fab sm:hidden" title={t('New Invoice')}>
        <Plus size={28} />
      </Link>

      {payRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPayRow(null)}>
          <div className="card w-full max-w-sm p-5 hover:transform-none" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-extrabold text-[var(--gold)] mb-1">Record payment</h2>
            <p className="text-xs text-[var(--text3)] mb-3">
              {payRow.customer_name || 'Customer'} · {money(Number(payRow.total) || 0)} due
            </p>
            <label className="label">{t('Amount received')}</label>
            <input
              className="input mb-2"
              type="number"
              min="0"
              step="0.01"
              value={payAmt}
              onChange={(e) => setPayAmt(e.target.value)}
            />
            <label className="label">{t('Method')}</label>
            <select className="select mb-4" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              <option>{t('Cash')}</option>
              <option>{t('Check')}</option>
              <option>{t('Credit Card')}</option>
              <option>{t('ACH / Wire')}</option>
              <option>Stripe</option>
              <option>{t('Other')}</option>
            </select>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary flex-1" onClick={() => setPayRow(null)}>{t('Cancel')}</button>
              <button
                type="button"
                className="btn btn-primary flex-1"
                disabled={paying}
                onClick={() => applyManualPayment(payRow, Number(payAmt) || 0, payMethod)}
              >
                {paying ? t('Saving…') : t('Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {voidRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setVoidRow(null)}>
          <div className="card w-full max-w-sm p-5 hover:transform-none" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-extrabold mb-1">Void invoice</h2>
            <p className="text-xs text-[var(--text3)] mb-3">
              {docNumber(voidRow) || 'This invoice'} will be voided. An open payment link is expired. No charge or refund is made.
            </p>
            <label className="text-xs text-[var(--text3)] font-bold">Reason (optional)</label>
            <textarea
              className="input mt-1 min-h-[80px]"
              value={voidReason}
              maxLength={500}
              onChange={(e) => setVoidReason(e.target.value)}
            />
            <div className="flex gap-2 mt-4">
              <button type="button" className="btn btn-secondary flex-1" onClick={() => setVoidRow(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary flex-1" disabled={voiding} onClick={() => submitVoid()}>
                {voiding ? 'Voiding…' : 'Void invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
