'use client';
import { useFormatDate } from '@/lib/use-format-date';
import { useT } from '@/lib/fa/locale';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { useParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isOwnerish } from '@/lib/roles';
import { buildServiceReportPrintHTML } from '@/lib/service-report-print';
import { viewMeasurement } from '@/lib/fluence-measurement';
import { systemParameterRows } from '@/lib/models';
import { getCompanyTheme, REPAIR_PLANET_THEME, type CompanyTheme } from '@/lib/company-theme';
import { resolveCustomerEmailOnFile, sendBillingDocEmail } from '@/lib/billing/send-doc-email';
import { toast } from 'sonner';
import { displayModelText } from '@/lib/model-display';

function parseMaybeJson(val: any): any {
  if (val == null) return val;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}

export default function ReportDetail() {
  const t = useT();
  const { format, locale } = useFormatDate();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const supabase = getSupabaseClient();
  const [viewOnly, setViewOnly] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [emailing, setEmailing] = useState(false);
  const [emailOnFile, setEmailOnFile] = useState('');
  const [theme, setTheme] = useState<CompanyTheme>(REPAIR_PLANET_THEME);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      let viewerOrgId: string | number | null = null;
      if (user) {
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('role, organization_id')
          .eq('id', user.id)
          .maybeSingle();
        let oType: string | null = null;
        if (prof?.organization_id) {
          viewerOrgId = prof.organization_id;
          const { data: org } = await supabase
            .from('organizations')
            .select('type')
            .eq('id', prof.organization_id)
            .maybeSingle();
          oType = org?.type || null;
        }
        if (isOwnerish(prof?.role, oType)) {
          setViewOnly(true);
        }
      }

      if (id) {
        try {
          const { data } = await supabase.from('service_reports').select('*').eq('id', id).maybeSingle();
          if (data) {
            data.checklist_electrical = parseMaybeJson(data.checklist_electrical);
            data.checklist_mechanical = parseMaybeJson(data.checklist_mechanical);
            data.checklist_aesthetic = parseMaybeJson(data.checklist_aesthetic);
            data.power_measurements = parseMaybeJson(data.power_measurements);
            data.model_parameters = parseMaybeJson(data.model_parameters);
            data.test_equipment = parseMaybeJson(data.test_equipment);
          }
          setReport(data);
          const themeOrgId = data?.organization_id || viewerOrgId;
          if (themeOrgId) {
            try {
              setTheme(await getCompanyTheme(themeOrgId, supabase));
            } catch (themeErr) {
              console.warn('company theme', themeErr);
            }
          }
        } catch {
          setReport(null);
        }
      }
      setLoading(false);
    })();
  }, [id, supabase]);

  useEffect(() => {
    if (!report) {
      setEmailOnFile('');
      return;
    }
    let cancelled = false;
    (async () => {
      const dest = await resolveCustomerEmailOnFile({
        supabase,
        customerOrganizationId: report.customer_organization_id,
        customerEmail: report.customer_email,
        customerName: report.customer_name,
      });
      if (!cancelled) setEmailOnFile(dest.email);
    })();
    return () => {
      cancelled = true;
    };
  }, [report, supabase]);

  function openPrint() {
    if (!report) return;
    try {
      const html = buildServiceReportPrintHTML({ ...report, theme, themeScope: 'document', locale });
      const w = window.open('', '_blank');
      if (!w) {
        toast.error(t('Pop-up blocked — allow pop-ups to print'));
        return;
      }
      w.document.write(html);
      w.document.close();
      setTimeout(() => {
        try {
          w.focus();
          w.print();
        } catch {
          /* ignore */
        }
      }, 400);
    } catch (e: any) {
      toast.error(e?.message || t('Print failed'));
    }
  }

  async function emailReportToCustomer() {
    if (!report || emailing) return;
    const dest = await resolveCustomerEmailOnFile({
      supabase,
      customerOrganizationId: report.customer_organization_id,
      customerEmail: report.customer_email,
      customerName: report.customer_name,
    });
    setEmailOnFile(dest.email);
    if (!dest.email) {
      toast.error(t('No email on file for this customer. Add one on the customer/clinic profile or the report.'));
      return;
    }

    setEmailing(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error(t('Session expired — sign in again'));
        return;
      }
      const html = buildServiceReportPrintHTML({ ...report, theme, themeScope: 'email', locale });
      const result = await sendBillingDocEmail({
        kind: 'report',
        accessToken: session.access_token,
        payload: {
          report_id: report.id,
          to_email: dest.email,
          report_number: report.report_number || '',
          customer_organization_id: report.customer_organization_id || undefined,
          reply_to: report.tech_email || report.tech_company_email || undefined,
          html,
          subject: report.report_number
            ? `Service Report ${report.report_number} from Total Service Pro`
            : 'Service report from Total Service Pro',
        },
      });
      if (result.emailSent) {
        toast.success(`Service report emailed to ${result.to || dest.email}`);
      } else {
        toast.error(result.error || t('Email was not sent.'));
      }
    } catch (e: any) {
      toast.error(e?.message || t('Email failed'));
    } finally {
      setEmailing(false);
    }
  }

  const engineer = report?.service_engineer || report?.tech_name || '—';
  const isComplete = String(report?.status || '').toLowerCase() === 'complete';

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-6xl mx-auto p-6 w-full">
        <Link href="/reports" className="text-[var(--gold)]">{t('← Back to list')}</Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-4 mb-2">
          <h1 className="text-2xl font-bold">
            {t('Service Report')} {report?.report_number || id}
          </h1>
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap gap-2 justify-end">
              {report && (
                <button type="button" className="btn btn-secondary text-sm" onClick={openPrint}>{t('Print / PDF')}</button>
              )}
              {report && (
                <button
                  type="button"
                  className="btn btn-primary text-sm"
                  onClick={emailReportToCustomer}
                  disabled={emailing}
                >
                  {emailing ? t('Emailing…') : t('Email report')}
                </button>
              )}
              {!viewOnly && report && (
                <Link href={`/reports/new?id=${id}`} className="btn btn-secondary text-sm">{t('Open in Editor')}</Link>
              )}
            </div>
            {report && (
              <div className="text-xs text-[var(--text3)]">
                {emailOnFile
                  ? t('Email on file: {email}').replace('{email}', emailOnFile)
                  : isComplete
                    ? t('No email on file for this customer')
                    : ''}
              </div>
            )}
          </div>
        </div>

        {viewOnly && (
          <div className="mb-4 text-sm px-3 py-2 rounded border border-[var(--border)] bg-[var(--surface3)] text-[var(--text3)]">{t('View-only (facility account). Contact your service provider to request changes.')}</div>
        )}

        {theme.branded && (
          <div
            className="mb-4 flex items-center justify-between gap-4 rounded-xl px-4 py-3"
            style={{ background: theme.primary, color: theme.onPrimary, borderBottom: `3px solid ${theme.accent}` }}
          >
            <div className="flex items-center gap-3">
              {theme.logoUrl ? (
                <img
                  src={theme.logoUrl}
                  alt=""
                  className="max-h-12 max-w-[120px] rounded bg-white p-1 object-contain"
                />
              ) : null}
              <div className="font-bold">{theme.companyName}</div>
            </div>
            <div className="text-sm font-semibold">{t('Service Report')}</div>
          </div>
        )}

        <div className="card p-6">
          {loading ? (
            <p className="text-[var(--text3)]">{t('Loading…')}</p>
          ) : report ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="text-[var(--text3)]">{t('Status:')}</span>{' '}
                  <span className="capitalize font-medium">{report.status}</span>
                </div>
                <div>
                  <span className="text-[var(--text3)]">{t('Service type:')}</span> {report.service_type || '—'}
                </div>
                <div>
                  <span className="text-[var(--text3)]">{t('Customer:')}</span> {report.customer_name || '—'}
                </div>
                <div>
                  <span className="text-[var(--text3)]">{t('Engineer (FSE):')}</span> {engineer}
                </div>
                <div>
                  <span className="text-[var(--text3)]">{t('Equipment:')}</span>{' '}
                  {displayModelText(report.equipment_name || report.model_type || '') || '—'}
                </div>
                <div>
                  <span className="text-[var(--text3)]">{t('Serial:')}</span> {report.serial_number || '—'}
                </div>
                <div>
                  <span className="text-[var(--text3)]">{t('Date:')}</span> {report.date_out ? format(report.date_out) : '—'}
                </div>
                <div>
                  <span className="text-[var(--text3)]">{t('Next PM:')}</span> {report.next_pm_due ? format(report.next_pm_due) : '—'}
                </div>
                {report.equipment_id != null && (
                  <div>
                    <span className="text-[var(--text3)]">{t('Equipment ID:')}</span> {report.equipment_id}
                    {report.serial_number && (
                      <span className="text-[var(--text3)] text-xs ml-2">{t('(history follows this laser via serial / equipment link)')}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Checklist summaries */}
              {[
                ['Electrical', report.checklist_electrical],
                ['Mechanical & Optical', report.checklist_mechanical],
                ['Aesthetic', report.checklist_aesthetic],
              ].map(([title, data]) => {
                if (!data || typeof data !== 'object' || !Object.keys(data).length) return null;
                return (
                  <div key={String(title)}>
                    <h3 className="font-bold text-[var(--gold)] mb-2">{t(title as string)}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs">
                      {Object.entries(data as Record<string, string>).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2 border-b border-[var(--border)] py-1">
                          <span className="text-[var(--text2)]">{t(k)}</span>
                          <span className="font-bold">{v ? t(String(v)) : '—'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {Array.isArray(report.power_measurements) && report.power_measurements.length > 0 && (
                <div>
                  <h3 className="font-bold text-[var(--gold)] mb-2">{t('Performance Testing')}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-left text-[var(--text3)]">
                          <th className="p-2 border-b border-[var(--border)]">{t('Wavelength')}</th>
                          <th className="p-2 border-b border-[var(--border)]">{t('Spot')}</th>
                          <th className="p-2 border-b border-[var(--border)]">{t('Set')}</th>
                          <th className="p-2 border-b border-[var(--border)]">{t('Measured')}</th>
                          <th className="p-2 border-b border-[var(--border)]">{t('Result')}</th>
                          <th className="p-2 border-b border-[var(--border)]">{t('Error %')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.power_measurements.map((m: any, i: number) => {
                          const view = viewMeasurement(m);
                          const outcome = view.pass === true ? 'PASS' : view.pass === false ? 'FAIL' : '';
                          const resultText = view.legacy
                            ? view.result
                            : `${view.result}${outcome ? ` ${outcome}` : ''}`.trim();
                          return (
                            <tr key={i}>
                              <td className="p-2 border-b border-[var(--border)]">{view.wavelength}</td>
                              <td className="p-2 border-b border-[var(--border)]">{view.spot}</td>
                              <td className="p-2 border-b border-[var(--border)]">{view.set}</td>
                              <td className="p-2 border-b border-[var(--border)]">{view.measured}</td>
                              <td className="p-2 border-b border-[var(--border)]">{resultText}</td>
                              <td
                                className={`p-2 border-b border-[var(--border)] font-bold ${
                                  view.pass === false
                                    ? 'text-red-400'
                                    : view.pass
                                      ? 'text-green-400'
                                      : ''
                                }`}
                              >
                                {view.error}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(() => {
                const parameterRows = systemParameterRows(
                  report.model_parameters,
                  report.model_type,
                  report.equipment_name
                );
                if (!parameterRows.length) return null;
                return (
                  <div>
                    <h3 className="font-bold text-[var(--gold)] mb-2">{t('System Parameters')}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs">
                      {parameterRows.map((row) => (
                        <div key={row.key} className="flex justify-between gap-2 border-b border-[var(--border)] py-1">
                          <span className="text-[var(--text2)]">{t(row.label)}</span>
                          <span className="font-bold">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {report.comments && (
                <div className="pt-3 border-t border-[var(--border)]">
                  <div className="text-[var(--text3)] mb-1">{t('Notes')}</div>
                  <p className="whitespace-pre-wrap">{report.comments}</p>
                </div>
              )}

              {report.tech_signature && String(report.tech_signature).startsWith('data:image') && (
                <div className="pt-3 border-t border-[var(--border)]">
                  <div className="text-[var(--text3)] mb-1">{t('Technician signature')}</div>
                  <img
                    src={report.tech_signature}
                    alt={t('Signature')}
                    className="h-12 max-w-[200px] bg-white border border-[var(--border)] rounded"
                  />
                  {report.signed_date && (
                    <div className="text-xs text-[var(--text3)] mt-1">{t('Date:')} {format(report.signed_date)}</div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="mb-4">{t('Report not found or you do not have access.')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
