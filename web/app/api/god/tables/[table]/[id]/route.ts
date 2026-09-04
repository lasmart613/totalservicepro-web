import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { requireGodCaller } from '@/lib/god-auth';
import { deleteGodRow, getGodRow, requireGodTable, updateGodRow } from '@/lib/god-crud';
import { deleteConfirmHint, getGodTable } from '@/lib/god-tables';

export const dynamic = 'force-dynamic';

async function ids(ctx: {
  params: Promise<{ table: string; id: string }> | { table: string; id: string };
}) {
  const raw = await Promise.resolve(ctx.params);
  return { table: String(raw?.table || '').trim(), id: String(raw?.id || '').trim() };
}

/**
 * GET /api/god/tables/:table/:id
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ table: string; id: string }> | { table: string; id: string } }
) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  }
  try {
    const { table, id } = await ids(ctx);
    const def = requireGodTable(table);
    const row = await getGodRow(getSupabaseAdmin(), def, id);
    return NextResponse.json({ ok: true, god: true, row, writeNote: def.writeNote || null });
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status || 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Load failed' }, { status });
  }
}

/**
 * PATCH /api/god/tables/:table/:id
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ table: string; id: string }> | { table: string; id: string } }
) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  }
  try {
    const { table, id } = await ids(ctx);
    const def = requireGodTable(table);
    const body = await req.json().catch(() => ({}));
    const row = await updateGodRow(getSupabaseAdmin(), def, id, body?.row ?? body);
    return NextResponse.json({ ok: true, god: true, row });
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status || 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Update failed' }, { status });
  }
}

/**
 * DELETE /api/god/tables/:table/:id
 * Body: { confirm: true, confirmText: "DELETE" | email | id }
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ table: string; id: string }> | { table: string; id: string } }
) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  }
  try {
    const { table, id } = await ids(ctx);
    const def = requireGodTable(table);
    const body = await req.json().catch(() => ({}));
    const result = await deleteGodRow(getSupabaseAdmin(), def, id, body, gate.caller.userId);
    return NextResponse.json({ ok: true, god: true, ...result });
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status || 500;
    let hint: string | undefined;
    try {
      const { table } = await ids(ctx);
      const def = getGodTable(table);
      if (def) hint = deleteConfirmHint(def);
    } catch {
      /* ignore */
    }
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Delete failed',
        hint,
      },
      { status }
    );
  }
}
