'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { useParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isOwnerish } from '@/lib/roles';
import { buildServiceReportPrintHTML } from '@/lib/service-report-print';
import { resolveCustomerEmailOnFile, sendBillingDocEmail } from '@/lib/billing/send-doc-email';
import { toast } from 'sonner';

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
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const supabase = getSupabaseClient();
  const [viewOnly, setViewOnly] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [emailing, setEmailing] = useState(false);
  const [emailOnFile, setEmailOnFile] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('role, organization_id')
          .eq('id', user.id)
          .maybeSingle();
        let oType: string | null = null;
        if (prof?.organization_id) {
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
      const html = buildServiceReportPrintHTML(report);
      const w = window.open('', '_blank');
      if (!w) {
        toast.error('Pop-up blocked — allow pop-ups to print');
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
      toast.error(e?.message || 'Print failed');
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
      toast.error('No email on file for this customer. Add one on the customer/clinic profile or the report.');
      return;
    }

    setEmailing(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expired — sign in again');
        return;
      }
      const html = buildServiceReportPrintHTML(report);
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
        toast.error(result.error || 'Email was not sent.');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Email failed');
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
        <Link href="/reports" className="text-[var(--gold)]">
          ← Back to list
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-4 mb-2">
          <h1 className="text-2xl font-bold">
            Service Report {report?.report_number || id}
          </h1>
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap gap-2 justify-end">
              {report && (
                <button type="button" className="btn btn-secondary text-sm" onClick={openPrint}>
                  Print / PDF
                </button>
              )}
              {report && (
                <button
                  type="button"
                  className="btn btn-primary text-sm"
                  onClick={emailReportToCustomer}
                  disabled={emailing}
                >
                  {emailing ? 'Emailing…' : 'Email report'}
                </button>
              )}
              {!viewOnly && report && (
                <Link href={`/reports/new?id=${id}`} className="btn btn-secondary text-sm">
                  Open in Editor
                </Link>
              )}
            </div>
            {report && (
              <div className="text-xs text-[var(--text3)]">
                {emailOnFile
                  ? `Email on file: ${emailOnFile}`
                  : isComplete
                    ? 'No email on file for this customer'
                    : ''}
              </div>
            )}
          </div>
        </div>

        {viewOnly && (
          <div className="mb-4 text-sm px-3 py-2 rounded border border-[var(--border)] bg-[var(--surface3)] text-[var(--text3)]">
            View-only (facility account). Contact your service provider to request changes.
          </div>
        )}

        <div className="card p-6">
          {loading ? (
            <p className="text-[var(--text3)]">Loading…</p>
          ) : report ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="text-[var(--text3)]">Status:</span>{' '}
                  <span className="capitalize font-medium">{report.status}</span>
                </div>
                <div>
                  <span className="text-[var(--text3)]">Service type:</span> {report.service_type || '—'}
                </div>
                <div>
                  <span className="text-[var(--text3)]">Customer:</span> {report.customer_name || '—'}
                </div>
                <div>
                  <span className="text-[var(--text3)]">Engineer (FSE):</span> {engineer}
                </div>
                <div>
                  <span className="text-[var(--text3)]">Equipment:</span>{' '}
                  {report.equipment_name || report.model_type || '—'}
                </div>
                <div>
                  <span className="text-[var(--text3)]">Serial:</span> {report.serial_number || '—'}
                </div>
                <div>
                  <span className="text-[var(--text3)]">Date:</span> {report.date_out || '—'}
                </div>
                <div>
                  <span className="text-[var(--text3)]">Next PM:</span> {report.next_pm_due || '—'}
                </div>
                {report.equipment_id != null && (
                  <div>
                    <span className="text-[var(--text3)]">Equipment ID:</span> {report.equipment_id}
                    {report.serial_number && (
                      <span className="text-[var(--text3)] text-xs ml-2">
                        (history follows this laser via serial / equipment link)
                      </span>
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
                    <h3 className="font-bold text-[var(--gold)] mb-2">{title as string}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs">
                      {Object.entries(data as Record<string, string>).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2 border-b border-[var(--border)] py-1">
                          <span className="text-[var(--text2)]">{k}</span>
                          <span className="font-bold">{v || '—'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {Array.isArray(report.power_measurements) && report.power_measurements.length > 0 && (
                <div>
                  <h3 className="font-bold text-[var(--gold)] mb-2">Performance Testing</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-left text-[var(--text3)]">
                          <th className="p-2 border-b border-[var(--border)]">Wavelength</th>
                          <th className="p-2 border-b border-[var(--border)]">Set</th>
                          <th className="p-2 border-b border-[var(--border)]">Actual</th>
                          <th className="p-2 border-b border-[var(--border)]">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.power_measurements.map((m: any, i: number) => (
                          <tr key={i}>
                            <td className="p-2 border-b border-[var(--border)]">
                              {m.wavelength || m.name || '—'}
                            </td>
                            <td className="p-2 border-b border-[var(--border)]">
                              {m.set ?? m.setting ?? '—'} {m.unit || ''}
                            </td>
                            <td className="p-2 border-b border-[var(--border)]">
                              {m.actual ?? m.measured ?? '—'}
                            </td>
                            <td className="p-2 border-b border-[var(--border)] font-bold">
                              {m.pass === true || m.result === 'PASS'
                                ? 'PASS'
                                : m.pass === false || m.result === 'FAIL'
                                  ? 'FAIL'
                                  : m.deviation || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {report.comments && (
                <div className="pt-3 border-t border-[var(--border)]">
                  <div className="text-[var(--text3)] mb-1">Notes</div>
                  <p className="whitespace-pre-wrap">{report.comments}</p>
                </div>
              )}

              {report.tech_signature && String(report.tech_signature).startsWith('data:image') && (
                <div className="pt-3 border-t border-[var(--border)]">
                  <div className="text-[var(--text3)] mb-1">Technician signature</div>
                  <img
                    src={report.tech_signature}
                    alt="Signature"
                    className="h-12 max-w-[200px] bg-white border border-[var(--border)] rounded"
                  />
                  {report.signed_date && (
                    <div className="text-xs text-[var(--text3)] mt-1">Date: {report.signed_date}</div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="mb-4">Report not found or you do not have access.</p>
          )}
        </div>
      </div>
    </div>
  );
}
