import { NextRequest, NextResponse } from 'next/server';
import { requireGodCaller } from '@/lib/god-auth';
import { catalogPayload } from '@/lib/god-crud';

export const dynamic = 'force-dynamic';

/**
 * GET /api/god/tables
 * Catalog of God-browsable tables. Larry only.
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  return NextResponse.json({ ok: true, god: true, ...catalogPayload() });
}
