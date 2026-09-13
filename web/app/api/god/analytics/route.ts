import { NextRequest, NextResponse } from 'next/server';
import { requireGodCaller } from '@/lib/god-auth';
import { loadGodAnalytics } from '@/lib/ga4-data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/god/analytics
 * GA4 soft-beta KPIs for the God Analytics board. Larry only.
 * Secrets stay on the server; missing credentials return a setup payload.
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;

  const payload = await loadGodAnalytics();
  return NextResponse.json({ ...payload, god: true });
}
