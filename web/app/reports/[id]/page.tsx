'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { useParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isOwnerish } from '@/lib/roles';

export default function ReportDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const supabase = getSupabaseClient();
  const [viewOnly, setViewOnly] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
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
        // Facility owners: view-only (no unlock for edit)
        if (isOwnerish(prof?.role, oType)) {
          setViewOnly(true);
        }
      }

      if (id) {
        try {
          const { data } = await supabase
            .from('service_reports')
            .select('id, report_number, equipment_name, serial_number, customer_name, service_type, status, date_out, comments, model_type')
            .eq('id', id)
            .maybeSingle();
          setReport(data);
        } catch {
          setReport(null);
        }
      }
      setLoading(false);
    })();
  }, [id, supabase]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-6xl mx-auto p-6 w-full">
        <Link href="/reports" className="text-[var(--gold)]">← Back to list</Link>
        <h1 className="text-2xl font-bold mt-4 mb-2">
          Service Report {report?.report_number || id}
        </h1>
        {viewOnly && (
          <div className="mb-4 text-sm px-3 py-2 rounded border border-[var(--border)] bg-[var(--surface3)] text-[var(--text3)]">
            View-only (facility account). Contact your service provider to request changes.
          </div>
        )}

        <div className="card p-6">
          {loading ? (
            <p className="text-[var(--text3)]">Loading…</p>
          ) : report ? (
            <div className="space-y-3 text-sm">
              <div><span className="text-[var(--text3)]">Status:</span> <span className="capitalize font-medium">{report.status}</span></div>
              <div><span className="text-[var(--text3)]">Customer:</span> {report.customer_name || '—'}</div>
              <div><span className="text-[var(--text3)]">Equipment:</span> {report.equipment_name || report.model_type || '—'}</div>
              <div><span className="text-[var(--text3)]">Serial:</span> {report.serial_number || '—'}</div>
              <div><span className="text-[var(--text3)]">Service type:</span> {report.service_type || '—'}</div>
              <div><span className="text-[var(--text3)]">Date:</span> {report.date_out || '—'}</div>
              {report.comments && (
                <div className="pt-3 border-t border-[var(--border)]">
                  <div className="text-[var(--text3)] mb-1">Notes</div>
                  <p className="whitespace-pre-wrap">{report.comments}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="mb-4">Full view / edit of report #{id}.</p>
          )}

          {!viewOnly && (
            <div className="mt-6">
              <p className="text-sm text-[var(--text3)] mb-3">
                Open in the editor to continue a draft or unlock for edits.
              </p>
              <Link href={`/reports/new?id=${id}`} className="btn btn-primary">Open in Editor</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
