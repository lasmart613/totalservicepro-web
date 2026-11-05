import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  catalogInsertFromOrg,
  enrichBlankOrgFields,
  filterInventoryRows,
  findExistingOrgPart,
  orgInsertPayload,
  publicEnrichmentStub,
  type OrgPartInput,
  type OrgPartRow,
} from '@/lib/parts-inventory/org-part';
import { normalizeMpn } from '@/lib/parts-inventory/mpn';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CATALOG_PUBLIC = 'id, part_number, mpn_normalized, name, description, brand, category, specs';

function userClient(req: NextRequest): { token: string; client: SupabaseClient } | null {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return null;
  return {
    token,
    client: createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

async function requireOrg(session: { token: string; client: SupabaseClient }) {
  const { data: userData, error: userError } = await session.client.auth.getUser(session.token);
  if (userError || !userData.user) return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  const { data: orgId, error: orgError } = await session.client.rpc('get_my_org_id');
  if (orgError || orgId == null) {
    return { error: NextResponse.json({ error: 'No organization for this login' }, { status: 403 }) };
  }
  return { userId: userData.user.id, orgId: orgId as number | string, client: session.client };
}

export async function GET(req: NextRequest) {
  const session = userClient(req);
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const auth = await requireOrg(session);
  if ('error' in auth) return auth.error;
  const hideZero = req.nextUrl.searchParams.get('hideZero') !== '0';
  const { data, error } = await auth.client
    .from('organization_parts')
    .select(
      `id, organization_id, catalog_part_id, mpn_normalized, internal_part_number, preferred_vendor_name, vendor_part_number, unit_cost, sell_price, avg_lead_time_days, expected_lead_time_days, quantity_on_hand, reorder_point, bin_location, notes, description_override, field_sources, parts_catalog (${CATALOG_PUBLIC})`,
    )
    .eq('organization_id', auth.orgId)
    .order('mpn_normalized', { ascending: true });
  if (error) {
    console.error('[inventory] list', error.message);
    return NextResponse.json({ error: 'Could not load inventory' }, { status: 502 });
  }
  const rows = filterInventoryRows((data || []) as Array<{ quantity_on_hand?: number | null }>, { hideZero });
  return NextResponse.json({ hideZero, rows });
}

export async function POST(req: NextRequest) {
  const session = userClient(req);
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const auth = await requireOrg(session);
  if ('error' in auth) return auth.error;
  const body = (await req.json().catch(() => null)) as (OrgPartInput & { action?: string; id?: number | string }) | null;
  if (!body) return NextResponse.json({ error: 'Missing part' }, { status: 400 });
  const action = String(body.action || 'link');

  if (action === 'update' && body.id != null) {
    const patch: Record<string, unknown> = {};
    for (const key of [
      'internal_part_number',
      'preferred_vendor_name',
      'vendor_part_number',
      'unit_cost',
      'sell_price',
      'avg_lead_time_days',
      'expected_lead_time_days',
      'quantity_on_hand',
      'reorder_point',
      'bin_location',
      'notes',
      'description_override',
    ] as const) {
      if (key in body) patch[key] = (body as Record<string, unknown>)[key];
    }
    patch.updated_at = new Date().toISOString();
    const { data, error } = await auth.client
      .from('organization_parts')
      .update(patch)
      .eq('id', body.id)
      .eq('organization_id', auth.orgId)
      .select('id')
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: 'Could not save this part' }, { status: 502 });
    return NextResponse.json({ ok: true, id: data.id });
  }

  const mpn = normalizeMpn(body.mpn);
  if (!mpn) return NextResponse.json({ error: 'Part number is required' }, { status: 400 });

  const { data: existingRows, error: existingError } = await auth.client
    .from('organization_parts')
    .select('id, catalog_part_id, mpn_normalized, internal_part_number, description_override, preferred_vendor_name, unit_cost, sell_price, field_sources')
    .eq('organization_id', auth.orgId);
  if (existingError) return NextResponse.json({ error: 'Could not check existing parts' }, { status: 502 });
  const existing = findExistingOrgPart((existingRows || []) as OrgPartRow[], {
    mpn,
    internalPartNumber: body.internal_part_number,
  });
  if (existing?.id != null) {
    return NextResponse.json({ ok: true, id: existing.id, reused: true });
  }

  let catalogId: number | string | null = null;
  const { data: catalogRows, error: catalogError } = await auth.client
    .from('parts_catalog')
    .select(CATALOG_PUBLIC)
    .eq('mpn_normalized', mpn)
    .limit(20);
  if (catalogError) return NextResponse.json({ error: 'Could not search the catalog' }, { status: 502 });
  const brand = String(body.brand || '').trim().toLowerCase();
  const match =
    (catalogRows || []).find((row) => brand && String((row as { brand?: string }).brand || '').trim().toLowerCase() === brand) ||
    (catalogRows || [])[0] ||
    null;
  if (match && (match as { id?: number }).id != null) {
    catalogId = (match as { id: number }).id;
  } else {
    const insert = catalogInsertFromOrg(body);
    if (!insert) return NextResponse.json({ error: 'Part number is required' }, { status: 400 });
    const { data: created, error: createError } = await auth.client
      .from('parts_catalog')
      .insert({ ...insert, created_by: auth.userId, is_active: true })
      .select('id')
      .maybeSingle();
    if (createError || !created) {
      console.error('[inventory] catalog insert', createError?.message);
      return NextResponse.json({ error: 'Could not add this part to the catalog' }, { status: 502 });
    }
    catalogId = created.id;
  }

  const row = orgInsertPayload(auth.orgId, { ...body, mpn: body.mpn || mpn }, catalogId);
  row.created_by = auth.userId;
  const catalog = (match || null) as { description?: string | null; name?: string | null; sale_price?: number | null } | null;
  const enriched = enrichBlankOrgFields(
    {
      description_override: row.description_override as string | null,
      preferred_vendor_name: row.preferred_vendor_name as string | null,
      field_sources: row.field_sources as Record<string, string>,
    },
    catalog,
    publicEnrichmentStub(mpn).fields,
  );
  Object.assign(row, enriched.patch);

  const { data: saved, error: saveError } = await auth.client
    .from('organization_parts')
    .insert(row)
    .select('id')
    .maybeSingle();
  if (saveError || !saved) {
    console.error('[inventory] org insert', saveError?.message);
    return NextResponse.json({ error: 'Could not save this part' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, id: saved.id, reused: false, catalog_part_id: catalogId });
}
