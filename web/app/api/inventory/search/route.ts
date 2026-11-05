import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  searchCrossReference,
  type CrossRefCatalog,
  type CrossRefOrg,
  type CrossRefVendor,
} from '@/lib/parts-inventory/cross-ref';
import { normalizeMpn } from '@/lib/parts-inventory/mpn';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function likeTerm(raw: string): string {
  return raw.replace(/[%_,]/g, '').trim();
}

/**
 * One box: manufacturer part number, any vendor's number, or this org's
 * internal / vendor number. Org prices are attached only for the caller's org.
 */
export async function GET(req: NextRequest) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const q = likeTerm(req.nextUrl.searchParams.get('q') || '');
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await client.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const normalized = normalizeMpn(q);
  const { data: orgId } = await client.rpc('get_my_org_id');

  const catalogSelect = 'id, part_number, mpn_normalized, name, description, brand';
  const [byMpn, byText, byVendor, orgRes] = await Promise.all([
    normalized
      ? client.from('parts_catalog').select(catalogSelect).eq('mpn_normalized', normalized).limit(20)
      : Promise.resolve({ data: [], error: null }),
    client.from('parts_catalog').select(catalogSelect).or(`part_number.ilike.%${q}%,name.ilike.%${q}%`).limit(30),
    client
      .from('part_catalog_availability')
      .select('part_id, vendor_name, vendor_part_number, vendor_pn_normalized')
      .or(
        [
          normalized ? `vendor_pn_normalized.eq.${normalized}` : '',
          `vendor_part_number.ilike.%${q}%`,
        ]
          .filter(Boolean)
          .join(','),
      )
      .limit(40),
    orgId == null
      ? Promise.resolve({ data: [], error: null })
      : client
          .from('organization_parts')
          .select(
            'id, catalog_part_id, mpn_normalized, internal_part_number, vendor_part_number, preferred_vendor_name, unit_cost, sell_price, quantity_on_hand, description_override',
          )
          .eq('organization_id', orgId)
          .or(
            [
              normalized ? `mpn_normalized.eq.${normalized}` : '',
              `internal_part_number.ilike.%${q}%`,
              `vendor_part_number.ilike.%${q}%`,
            ]
              .filter(Boolean)
              .join(','),
          )
          .limit(40),
  ]);

  if (byMpn.error || byText.error || byVendor.error || orgRes.error) {
    console.error(
      '[inventory] cross-ref',
      byMpn.error?.message || byText.error?.message || byVendor.error?.message || orgRes.error?.message,
    );
    return NextResponse.json({ error: 'Could not search parts' }, { status: 502 });
  }

  const catalog = new Map<string, CrossRefCatalog>();
  for (const row of [...(byMpn.data || []), ...(byText.data || [])]) {
    catalog.set(String((row as { id: number }).id), row as CrossRefCatalog);
  }
  const vendors = (byVendor.data || []) as CrossRefVendor[];
  const missing = [...new Set(vendors.map((row) => String(row.part_id)))].filter((id) => !catalog.has(id));
  if (missing.length) {
    const extra = await client.from('parts_catalog').select(catalogSelect).in('id', missing);
    for (const row of extra.data || []) catalog.set(String((row as { id: number }).id), row as CrossRefCatalog);
  }

  const hits = searchCrossReference(q, {
    catalog: [...catalog.values()],
    vendors,
    orgParts: (orgRes.data || []) as CrossRefOrg[],
  });
  return NextResponse.json({ hits });
}
