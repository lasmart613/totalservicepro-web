import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { bomLineToPick, isMiniGentleYag, rankPartsForDevice, type PartPick } from '@/lib/parts-inventory/bom';
import { normalizeMpn } from '@/lib/parts-inventory/mpn';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Parts for the device on the ticket or report, priced from the org table.
 * Shared catalog prices are not returned.
 */
export async function GET(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await client.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const make = req.nextUrl.searchParams.get('manufacturer') || '';
  const model = req.nextUrl.searchParams.get('model') || '';
  const q = req.nextUrl.searchParams.get('q') || '';
  if (!make && !model) return NextResponse.json({ hits: [] as PartPick[] });

  const { data: orgId } = await client.rpc('get_my_org_id');
  const { data: models, error: modelError } = await client
    .from('laser_models')
    .select('id, name, label, manufacturers(name)')
    .limit(400);
  if (modelError) return NextResponse.json({ error: 'Could not load device models' }, { status: 502 });

  const wantMini = isMiniGentleYag(make, model);
  const needle = `${make} ${model}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const modelIds = (models || [])
    .filter((row) => {
      const joined = row as { name?: string | null; label?: string | null; manufacturers?: { name?: string | null } | { name?: string | null }[] | null };
      const mfrRow = Array.isArray(joined.manufacturers) ? joined.manufacturers[0] : joined.manufacturers;
      const blob = `${mfrRow?.name || ''} ${joined.name || ''} ${joined.label || ''}`.toLowerCase();
      const compact = blob.replace(/[^a-z0-9]+/g, '');
      if (wantMini) return compact.includes('vpyag') || compact.includes('minigentleyag');
      return Boolean(needle) && (compact.includes(needle) || needle.includes(compact));
    })
    .map((row) => row.id);

  if (!modelIds.length) return NextResponse.json({ hits: [] as PartPick[] });

  const { data: bom, error: bomError } = await client
    .from('device_bom')
    .select('manual_section, line_ref, qty_per_assembly, parts_catalog(id, part_number, name, description, brand)')
    .in('laser_model_id', modelIds)
    .limit(500);
  if (bomError) return NextResponse.json({ error: 'Could not load the device BOM' }, { status: 502 });

  const prices = new Map<string, number | null>();
  if (orgId != null) {
    const { data: orgParts } = await client
      .from('organization_parts')
      .select('mpn_normalized, sell_price')
      .eq('organization_id', orgId);
    for (const row of orgParts || []) {
      const sell = Number((row as { sell_price?: number | null }).sell_price);
      prices.set(String((row as { mpn_normalized?: string }).mpn_normalized || ''), Number.isFinite(sell) ? sell : null);
    }
  }

  const hits: PartPick[] = [];
  for (const row of bom || []) {
    const joined = row as {
      manual_section?: string | null;
      parts_catalog?:
        | { part_number?: string; name?: string; description?: string; brand?: string }
        | { part_number?: string; name?: string; description?: string; brand?: string }[]
        | null;
    };
    const part = joined.parts_catalog;
    const catalog = Array.isArray(part) ? part[0] : part;
    if (!catalog?.part_number) continue;
    const mpn = String(catalog.part_number);
    hits.push(
      bomLineToPick(
        {
          mpn,
          description: String(catalog.name || catalog.description || mpn),
          section: String((row as { manual_section?: string }).manual_section || ''),
          brand: catalog.brand,
        },
        prices.get(normalizeMpn(mpn)) ?? null,
      ),
    );
  }
  return NextResponse.json({ hits: rankPartsForDevice(hits, [], q) });
}
