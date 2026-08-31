import { NextRequest, NextResponse } from 'next/server';
import { requireGodCaller } from '@/lib/god-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/god/me
 * Larry-only. 404 for everyone else so the client can hide God chrome.
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  return NextResponse.json({ ok: true, god: true, email: gate.caller.email });
}
