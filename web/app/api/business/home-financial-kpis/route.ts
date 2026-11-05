import { NextRequest, NextResponse } from 'next/server';
import { homepageFinancialKpiResponse } from '@/lib/home-financial-kpis';
import { loadAuthorizedFinancialReport } from '@/lib/financial-reporting-server';

export const dynamic = 'force-dynamic';

function tokenFrom(req: NextRequest): string {
  const header = req.headers.get('authorization') || '';
  return header.replace(/^Bearer\s+/i, '').trim();
}

/**
 * GET /api/business/home-financial-kpis
 * Same gate as Financial Reporting: admin, company_admin, platform admin, or God.
 * The caller's JWT is checked in loadAuthorizedFinancialReport. A refusal
 * returns the error and no amounts.
 * detailRequested stays false so a free org receives the summary and not a 402.
 * Premium cards are added only when that loader sets detailIncluded.
 */
export async function GET(req: NextRequest) {
  const token = tokenFrom(req);
  if (!token) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const browserTimeZone = req.nextUrl.searchParams.get('tz') || req.cookies.get('rp-tz')?.value || '';
  const result = await loadAuthorizedFinancialReport(token, {
    detailRequested: false,
    browserTimeZone,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(homepageFinancialKpiResponse(result.report));
}
