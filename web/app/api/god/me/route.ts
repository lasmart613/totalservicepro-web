import { NextRequest, NextResponse } from 'next/server';
import { requireGodCaller } from '@/lib/god-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/god/me
 * Signed-in non-admins get { god: false } with no admin payload, so the header
 * check does not 404 in the console. Other /api/god routes still 404.
 * Missing or invalid sessions stay 401.
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) {
    if (gate.response.status === 404) {
      return NextResponse.json({ ok: true, god: false });
    }
    return gate.response;
  }
  return NextResponse.json({ ok: true, god: true, email: gate.caller.email });
}
