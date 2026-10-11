import { NextRequest, NextResponse } from 'next/server';
import { requireGodCaller } from '@/lib/god-auth';
import { isPublishedColumnMissing, parseManualPublishedToggle } from '@/lib/manual-published';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const PAGE = 1000;

type ShelfRow = {
  id: number;
  brand: string | null;
  model: string | null;
  title: string | null;
  doc_kind: string | null;
  published: boolean;
};

/**
 * GET /api/god/manuals/published
 * God-only shelf, including unpublished rows.
 *
 * PATCH /api/god/manuals/published
 * Body: { id, published }. Service role writes the column. Clients cannot.
 */
export async function GET(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = getSupabaseAdmin();
  const manuals: ShelfRow[] = [];
  let publishedColumn = true;
  for (let from = 0; from < 5000; from += PAGE) {
    const full = await admin
      .from('manuals')
      .select('id,brand,model,title,doc_kind,published')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    let batch = full.data as ShelfRow[] | null;
    let error = full.error;
    if (error && isPublishedColumnMissing(error)) {
      publishedColumn = false;
      const plain = await admin
        .from('manuals')
        .select('id,brand,model,title,doc_kind')
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      batch = ((plain.data || []) as Array<Omit<ShelfRow, 'published'>>).map((row) => ({
        ...row,
        published: true,
      }));
      error = plain.error;
    }
    if (error) {
      return NextResponse.json({ error: error.message || 'Could not list manuals' }, { status: 400 });
    }
    manuals.push(...(batch || []));
    if (!batch || batch.length < PAGE) break;
  }

  return NextResponse.json({ ok: true, publishedColumn, manuals });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireGodCaller(req);
  if (!gate.ok) return gate.response;
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const parsed = parseManualPublishedToggle(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('manuals')
    .update({ published: parsed.published })
    .eq('id', parsed.id)
    .select('id,published')
    .maybeSingle();
  if (error && isPublishedColumnMissing(error)) {
    return NextResponse.json(
      { error: 'published column is not on this database yet' },
      { status: 503 },
    );
  }
  if (error) {
    return NextResponse.json({ error: error.message || 'Could not update published' }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, manual: data });
}
