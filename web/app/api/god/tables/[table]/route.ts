import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { createGodRow, listGodRows, requireGodTable } from '@/lib/god-crud';

export const dynamic = 'force-dynamic';

async function tableParam(ctx: { params: Promise<{ table: string }> | { table: string } }) {
  const raw = await Promise.resolve(ctx.params);
  return String(raw?.table || '').trim();
}

/**
 * GET /api/god/tables/:table
 * List rows. God only.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ table: string }> | { table: string } }
) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  }

  try {
    const def = requireGodTable(await tableParam(ctx));
    const url = req.nextUrl;
    const result = await listGodRows(getSupabaseAdmin(), def, {
      q: url.searchParams.get('q') || '',
      page: Number(url.searchParams.get('page') || 1),
      pageSize: Number(url.searchParams.get('pageSize') || 50),
    });
    return NextResponse.json({
      ok: true,
      god: true,
      ...result,
      writeNote: def.writeNote || null,
      readOnlyNote: def.readOnlyNote || null,
    });
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status || 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'List failed' }, { status });
  }
}

/**
 * POST /api/god/tables/:table
 * Create a row. God only.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ table: string }> | { table: string } }
) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  }

  try {
    const def = requireGodTable(await tableParam(ctx));
    const body = await req.json().catch(() => ({}));
    const row = await createGodRow(getSupabaseAdmin(), def, body?.row ?? body);
    return NextResponse.json({ ok: true, god: true, row });
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status || 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Create failed' }, { status });
  }
}
