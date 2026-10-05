import { NextRequest, NextResponse } from 'next/server';
import { FINANCIAL_REPORT_COOKIE } from '@/lib/financial-reporting-access';
import { loadAuthorizedFinancialReport } from '@/lib/financial-reporting-server';

export const dynamic = 'force-dynamic';

function tokenFrom(req: NextRequest): string {
  const header = req.headers.get('authorization') || '';
  const bearer = header.replace(/^Bearer\s+/i, '').trim();
  if (bearer) return bearer;
  return req.cookies.get(FINANCIAL_REPORT_COOKIE)?.value || '';
}

function clearAccessCookie(res: NextResponse) {
  res.cookies.set(FINANCIAL_REPORT_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/**
 * GET/POST /api/business/financial-reporting
 * Admin (admin / company_admin) or God only. Non-admins receive 403 and no figures.
 * POST stores an httpOnly cookie so the page can render on the server afterward.
 */
async function handle(req: NextRequest, persistCookie: boolean) {
  const token = tokenFrom(req);
  if (!token) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const detailRequested = req.nextUrl.searchParams.get('detail') === '1';
  const result = await loadAuthorizedFinancialReport(token, { detailRequested });
  if (!result.ok) {
    const res = NextResponse.json({ error: result.error }, { status: result.status });
    if (persistCookie || result.status === 403) clearAccessCookie(res);
    return res;
  }

  const res = NextResponse.json(result.report);
  if (persistCookie) {
    res.cookies.set(FINANCIAL_REPORT_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 8,
    });
  }
  return res;
}

export function GET(req: NextRequest) {
  return handle(req, false);
}

export function POST(req: NextRequest) {
  return handle(req, true);
}

/** Logout clears the httpOnly access cookie. The client cannot delete it. */
export function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearAccessCookie(res);
  return res;
}
