import { cookies } from 'next/headers';
import { Header } from '@/components/Header';
import { FINANCIAL_REPORT_COOKIE } from '@/lib/financial-reporting-access';
import { loadAuthorizedFinancialReport } from '@/lib/financial-reporting-server';
import { FinancialReportingGate } from './FinancialReportingGate';
import { FinancialReportingView } from './FinancialReportingView';

export const dynamic = 'force-dynamic';

/**
 * The report is rendered only after the server accepts the session.
 * Without an authorized cookie, this response contains no invoice figures.
 * The gate posts the session to the API, which returns 403 for non-admins.
 */
export default async function FinancialReportingPage() {
  const jar = await cookies();
  const token = jar.get(FINANCIAL_REPORT_COOKIE)?.value || '';

  if (!token) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <FinancialReportingGate />
      </div>
    );
  }

  const result = await loadAuthorizedFinancialReport(token);
  if (!result.ok) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <FinancialReportingGate />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <FinancialReportingView report={result.report} />
    </div>
  );
}
