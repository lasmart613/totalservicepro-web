import { NextRequest, NextResponse } from 'next/server';
import { JOB_COSTING_COOKIE } from '@/lib/job-costing-access';
import { loadAuthorizedJobCostReport } from '@/lib/job-costing-server';

export const dynamic = 'force-dynamic';

function tokenFrom(req: NextRequest): string {
  const header = req.headers.get('authorization') || '';
  const bearer = header.replace(/^Bearer\s+/i, '').trim();
  if (bearer) return bearer;
  return req.cookies.get(JOB_COSTING_COOKIE)?.value || '';
}

function clearAccessCookie(res: NextResponse) {
  res.cookies.set(JOB_COSTING_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/**
 * GET/POST /api/business/job-costing
 * Admin (admin / company_admin) or God only. Non-admins receive 403 and no figures.
 * Free plans receive 402 and no figures. Premium, Team, and Enterprise receive the report.
 * POST stores an httpOnly cookie so the page can render on the server afterward.
 */
async function handle(req: NextRequest, persistCookie: boolean) {
  const token = tokenFrom(req);
  if (!token) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const result = await loadAuthorizedJobCostReport(token);
  if (!result.ok) {
    const res = NextResponse.json({ error: result.error }, { status: result.status });
    if (persistCookie || result.status === 403) clearAccessCookie(res);
    return res;
  }

  const res = NextResponse.json(result.report);
  if (persistCookie) {
    res.cookies.set(JOB_COSTING_COOKIE, token, {
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
