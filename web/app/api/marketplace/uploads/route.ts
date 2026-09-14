import { NextRequest, NextResponse } from 'next/server';
import { previewCatalogImport } from '@/lib/marketplace/catalog-import';
import { defaultCatalogKind, parseCatalogSpreadsheet } from '@/lib/marketplace/catalog-upload';
import { getMarketplaceCaller } from '@/lib/marketplace/caller';
import type { MarketplaceListingLike } from '@/lib/marketplace/parts';
import { canBulkUploadSupplierInventory } from '@/lib/marketplace/storefront';
import { requireStorefrontSeller } from '@/lib/marketplace/storefront-server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LISTING_SELECTS = [
  'id, title, description, status, condition, price, price_type, manufacturer, model, part_number, quantity, qty, listing_type, category, images, photos, details, seller_id, created_by, organization_id',
  'id, title, description, status, price, manufacturer, model, part_number, quantity, listing_type, images, details, organization_id',
];

async function loadOrgListings(orgId: string | number): Promise<MarketplaceListingLike[]> {
  const admin = getSupabaseAdmin();
  for (const cols of LISTING_SELECTS) {
    const res = await admin.from('marketplace_listings').select(cols).eq('organization_id', orgId).limit(2000);
    if (!res.error && res.data) return res.data as MarketplaceListingLike[];
    if (res.error && !/column|does not exist|schema cache/i.test(res.error.message || '')) break;
  }
  return [];
}

async function readUpload(req: NextRequest): Promise<
  | { ok: true; buffer: Buffer; filename: string; contentType: string | null }
  | { ok: false; error: string }
> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return { ok: false, error: 'Choose a .csv or .xlsx file.' };
    const buffer = Buffer.from(await file.arrayBuffer());
    return { ok: true, buffer, filename: file.name || 'catalog.csv', contentType: file.type || null };
  }
  const body = (await req.json().catch(() => ({}))) as {
    filename?: string;
    csv?: string;
    content?: string;
  };
  const text = body.csv || body.content;
  if (!text) return { ok: false, error: 'Choose a .csv or .xlsx file.' };
  const filename = body.filename || 'catalog.csv';
  return { ok: true, buffer: Buffer.from(text, 'utf8'), filename, contentType: 'text/csv' };
}

async function insertListing(payload: Record<string, unknown>): Promise<{ id: string | null; error: string | null }> {
  const admin = getSupabaseAdmin();
  const full = await admin.from('marketplace_listings').insert([payload]).select('id').maybeSingle();
  if (!full.error && full.data?.id) return { id: String(full.data.id), error: null };
  const core = { ...payload };
  delete core.details;
  delete core.photos;
  delete core.qty;
  delete core.price_type;
  const slim = await admin.from('marketplace_listings').insert([core]).select('id').maybeSingle();
  if (!slim.error && slim.data?.id) return { id: String(slim.data.id), error: null };
  return { id: null, error: full.error?.message || slim.error?.message || 'Could not create listing' };
}

export async function GET(req: NextRequest) {
  const caller = await getMarketplaceCaller(req);
  if (!caller) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  return NextResponse.json({
    ok: true,
    eligible: canBulkUploadSupplierInventory(caller.role, caller.orgType, null),
  });
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requireStorefrontSeller(req, { bulk: true });
    if (!gate.ok) return gate.response;
    if (!hasServiceRole()) {
      return NextResponse.json({ error: 'Upload unavailable' }, { status: 503 });
    }

    const dryRun = req.nextUrl.searchParams.get('commit') !== '1';
    const file = await readUpload(req);
    if (!file.ok) return NextResponse.json({ error: file.error }, { status: 400 });

    const parsed = parseCatalogSpreadsheet(file.buffer, {
      filename: file.filename,
      byteSize: file.buffer.length,
      contentType: file.contentType,
      defaultKind: defaultCatalogKind(gate.org.type),
    });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const existing = await loadOrgListings(gate.orgId);
    const planned = previewCatalogImport({
      rows: parsed.rows,
      existing,
      organizationId: gate.orgId,
      userId: gate.caller.userId,
      sellerOrgName: gate.org.name,
      paidPhotos: true,
    });

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        filename: file.filename,
        unknownHeaders: parsed.unknownHeaders,
        counts: planned.counts,
        rows: planned.preview,
      });
    }

    const results: Array<{
      rowNumber: number;
      action: string;
      listingId: string | null;
      error: string | null;
    }> = [];
    let created = 0;
    let updated = 0;
    let failed = 0;
    const admin = getSupabaseAdmin();

    for (const row of planned.commits) {
      if (row.action === 'update' && row.existingListingId) {
        const { error } = await admin
          .from('marketplace_listings')
          .update(row.payload)
          .eq('id', row.existingListingId)
          .eq('organization_id', gate.orgId);
        if (error) {
          failed += 1;
          results.push({ rowNumber: row.rowNumber, action: 'error', listingId: row.existingListingId, error: error.message });
        } else {
          updated += 1;
          results.push({ rowNumber: row.rowNumber, action: 'update', listingId: row.existingListingId, error: null });
        }
        continue;
      }
      const inserted = await insertListing(row.payload);
      if (!inserted.id) {
        failed += 1;
        results.push({ rowNumber: row.rowNumber, action: 'error', listingId: null, error: inserted.error });
      } else {
        created += 1;
        results.push({ rowNumber: row.rowNumber, action: 'create', listingId: inserted.id, error: null });
      }
    }

    return NextResponse.json({
      dryRun: false,
      filename: file.filename,
      counts: { ...planned.counts, created, updated, failed },
      rows: planned.preview,
      results,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[marketplace/uploads]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
