'use client';

import Link from 'next/link';
import {
  newServiceReportHref,
  type ExistingTicketReport,
} from '@/lib/ticket-service-report';

type Props = {
  canCreate: boolean;
  ticketId: string | number;
  existingReports?: ExistingTicketReport[];
  /** header: desktop action. dock: fixed full-width bar on narrow screens. */
  placement?: 'header' | 'dock';
};

export function CreateServiceReportActions({
  canCreate,
  ticketId,
  existingReports = [],
  placement = 'header',
}: Props) {
  const href = newServiceReportHref(ticketId);
  const reports = existingReports.filter((report) => report.id);

  if (placement === 'dock') {
    if (!canCreate) return null;
    return (
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[var(--gold)] bg-[var(--surface)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Link
          href={href}
          data-testid="create-service-report"
          className="btn btn-primary flex w-full items-center justify-center gap-2"
        >
          Create Service Report
        </Link>
      </div>
    );
  }

  if (!canCreate && reports.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      {canCreate && (
        <Link
          href={href}
          data-testid="create-service-report"
          className="btn btn-primary hidden w-full items-center justify-center gap-2 sm:flex sm:w-auto"
        >
          Create Service Report
        </Link>
      )}
      {reports.length > 0 && (
        <div className="flex flex-col gap-1 text-xs text-[var(--text3)] sm:text-right">
          {reports.map((report) => (
            <Link key={report.id} href={`/reports/${report.id}`} className="underline">
              Open {report.reportNumber || 'existing report'}
              {report.status ? ` (${report.status})` : ''}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
