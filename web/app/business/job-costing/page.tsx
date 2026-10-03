import { cookies } from 'next/headers';
import { Header } from '@/components/Header';
import { JOB_COSTING_COOKIE } from '@/lib/job-costing-access';
import { loadAuthorizedJobCostReport } from '@/lib/job-costing-server';
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
        <JobCostingGate />
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
