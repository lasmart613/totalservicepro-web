import { cookies } from 'next/headers';
import { Header } from '@/components/Header';
import { JOB_COSTING_COOKIE } from '@/lib/job-costing-access';
import { loadAuthorizedJobCostReport } from '@/lib/job-costing-server';
import { ReportUpgradeLock } from '@/components/ReportUpgradeLock';
import { JobCostingGate } from './JobCostingGate';
import { JobCostingView } from './JobCostingView';

export const dynamic = 'force-dynamic';

/**
 * The report is rendered only after the server accepts the session.
 * Without an authorized cookie, this response contains no cost figures.
 * The gate posts the session to the API, which returns 403 for non-admins.
 */
export default async function JobCostingPage() {
  const jar = await cookies();
  const token = jar.get(JOB_COSTING_COOKIE)?.value || '';

  if (!token) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <JobCostingGate />
      </div>
    );
  }

  const result = await loadAuthorizedJobCostReport(token);
  if (!result.ok) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        {result.status === 402 ? (
          <div className="max-w-3xl mx-auto w-full px-4 py-8">
            <h1 className="text-2xl font-extrabold">Job Costing</h1>
            <ReportUpgradeLock feature="Job Costing" sections={['Repair orders', 'Labor cost', 'Parts and materials', 'Margin']} />
          </div>
        ) : (
          <JobCostingGate />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <JobCostingView report={result.report} />
    </div>
  );
}
