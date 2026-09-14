/**
 * Map parsed catalog rows onto marketplace_listings.
 * Idempotent-ish: same org + SKU / part number updates instead of inserting a duplicate.
 */

import { buildListingUpdatePayload } from './manage-listing.ts';
import type { CatalogKind, CatalogParsedRow } from './catalog-upload.ts';
import type { MarketplaceListingLike } from './parts.ts';
import { FREE_LISTING_PHOTO_LIMIT, PAID_LISTING_PHOTO_LIMIT } from './storefront.ts';

export type ImportAction = 'create' | 'update' | 'skip' | 'error';

export type CatalogImportPreviewRow = {
  rowNumber: number;
  action: ImportAction;
  sku: string | null;
  title: string;
  brand: string | null;
  model: string | null;
  condition: string | null;
  price: number | null;
  qty: number | null;
  description: string | null;
  catalogKind: CatalogKind;
  photoCount: number;
  existingListingId: string | null;
  errorMessage: string | null;
};

export type CatalogImportCommitRow = CatalogImportPreviewRow & {
  payload: Record<string, unknown>;
};

function skuKey(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return raw.toLowerCase();
}

export function listingSkuKey(row: MarketplaceListingLike | null | undefined): string | null {
  if (!row) return null;
  const details = row.details && typeof row.details === 'object' ? row.details : null;
  return (
    skuKey(row.part_number) ||
    skuKey(details?.sku) ||
    skuKey(details?.part_number) ||
    skuKey(details?.catalog_number)
  );
}

export function indexListingsBySku<T extends MarketplaceListingLike>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = listingSkuKey(row);
    if (!key || map.has(key)) continue;
    map.set(key, row);
  }
  return map;
}

export function capImportPhotos(urls: string[] | null | undefined, paid: boolean): string[] {
  const list = Array.isArray(urls) ? urls.filter((u) => String(u || '').trim()) : [];
  const limit = paid ? PAID_LISTING_PHOTO_LIMIT : FREE_LISTING_PHOTO_LIMIT;
  return list.slice(0, limit);
}

function listingTypeFor(kind: CatalogKind): { listing_type: string; category: string; detailsKind: string } {
  if (kind === 'consumable') {
    return { listing_type: 'consumable', category: 'consumables', detailsKind: 'consumable' };
  }
  if (kind === 'used') {
    return { listing_type: 'used', category: 'equipment', detailsKind: 'equipment' };
  }
  return { listing_type: 'part', category: 'parts', detailsKind: 'part' };
}

export function listingTitleFromRow(row: CatalogParsedRow): string {
  const title = String(row.title || '').trim();
  if (title) return title;
  const sku = String(row.sku || '').trim();
  if (sku) return sku;
  return 'Part for sale';
}

export function listingPayloadFromRow(opts: {
  row: CatalogParsedRow;
  organizationId: string | number;
  userId: string;
  sellerOrgName?: string | null;
  paidPhotos: boolean;
}): Record<string, unknown> {
  const { row, organizationId, userId, sellerOrgName, paidPhotos } = opts;
  const images = capImportPhotos(row.photoUrls, paidPhotos);
  const title = listingTitleFromRow(row);
  const sku = String(row.sku || '').trim() || null;
  const qty = row.qty != null ? row.qty : 1;
  const types = listingTypeFor(row.catalogKind);
  const details: Record<string, unknown> = {
    kind: types.detailsKind,
    sku,
    compatible_models: row.model || null,
    quantity_available: qty,
    seller_org_name: sellerOrgName || null,
  };
  if (images.length) {
    details.images = images;
    details.photos = images;
  }
  const payload: Record<string, unknown> = {
    listing_type: types.listing_type,
    category: types.category,
    title,
    manufacturer: row.brand || null,
    model: row.model || null,
    part_number: sku,
    condition: row.condition || null,
    price: row.price,
    price_type: row.price == null ? 'contact' : 'fixed',
    description: row.description || title,
    quantity: qty,
    qty,
    images,
    photos: images,
    details,
    seller_id: userId,
    created_by: userId,
    organization_id: organizationId,
    status: 'active',
  };
  return payload;
}

export function previewCatalogImport(opts: {
  rows: CatalogParsedRow[];
  existing: MarketplaceListingLike[];
  organizationId: string | number;
  userId: string;
  sellerOrgName?: string | null;
  paidPhotos: boolean;
}): {
  preview: CatalogImportPreviewRow[];
  commits: CatalogImportCommitRow[];
  counts: { create: number; update: number; skip: number; error: number };
} {
  const bySku = indexListingsBySku(opts.existing);
  const usedInFile = new Set<string>();
  const preview: CatalogImportPreviewRow[] = [];
  const commits: CatalogImportCommitRow[] = [];
  const counts = { create: 0, update: 0, skip: 0, error: 0 };

  for (const row of opts.rows) {
    const sku = skuKey(row.sku);
    if (row.status === 'error' || (!row.title && !row.sku)) {
      counts.error += 1;
      preview.push({
        rowNumber: row.rowNumber,
        action: 'error',
        sku: row.sku,
        title: listingTitleFromRow(row),
        brand: row.brand,
        model: row.model,
        condition: row.condition,
        price: row.price,
        qty: row.qty,
        description: row.description,
        catalogKind: row.catalogKind,
        photoCount: capImportPhotos(row.photoUrls, opts.paidPhotos).length,
        existingListingId: null,
        errorMessage: row.errorMessage || 'Each row needs a title or SKU.',
      });
      continue;
    }

    if (sku && usedInFile.has(sku)) {
      counts.skip += 1;
      preview.push({
        rowNumber: row.rowNumber,
        action: 'skip',
        sku: row.sku,
        title: listingTitleFromRow(row),
        brand: row.brand,
        model: row.model,
        condition: row.condition,
        price: row.price,
        qty: row.qty,
        description: row.description,
        catalogKind: row.catalogKind,
        photoCount: capImportPhotos(row.photoUrls, opts.paidPhotos).length,
        existingListingId: bySku.get(sku)?.id ? String(bySku.get(sku)?.id) : null,
        errorMessage: 'Duplicate SKU later in this file — earlier row wins.',
      });
      continue;
    }
    if (sku) usedInFile.add(sku);

    const existing = sku ? bySku.get(sku) : undefined;
    const payload = listingPayloadFromRow({
      row,
      organizationId: opts.organizationId,
      userId: opts.userId,
      sellerOrgName: opts.sellerOrgName,
      paidPhotos: opts.paidPhotos,
    });

    if (existing?.id) {
      const updateBody = { ...payload };
      delete updateBody.seller_id;
      delete updateBody.created_by;
      delete updateBody.organization_id;
      delete updateBody.status;
      if (!row.photoUrls.length) {
        delete updateBody.images;
        delete updateBody.photos;
        if (updateBody.details && typeof updateBody.details === 'object') {
          const d = { ...(updateBody.details as Record<string, unknown>) };
          delete d.images;
          delete d.photos;
          updateBody.details = d;
        }
      }
      const merged = buildListingUpdatePayload(updateBody, existing);
      counts.update += 1;
      const item: CatalogImportCommitRow = {
        rowNumber: row.rowNumber,
        action: 'update',
        sku: row.sku,
        title: listingTitleFromRow(row),
        brand: row.brand,
        model: row.model,
        condition: row.condition,
        price: row.price,
        qty: row.qty,
        description: row.description,
        catalogKind: row.catalogKind,
        photoCount: capImportPhotos(row.photoUrls, opts.paidPhotos).length,
        existingListingId: String(existing.id),
        errorMessage: null,
        payload: merged,
      };
      preview.push(item);
      commits.push(item);
      continue;
    }

    counts.create += 1;
    const item: CatalogImportCommitRow = {
      rowNumber: row.rowNumber,
      action: 'create',
      sku: row.sku,
      title: listingTitleFromRow(row),
      brand: row.brand,
      model: row.model,
      condition: row.condition,
      price: row.price,
      qty: row.qty,
      description: row.description,
      catalogKind: row.catalogKind,
      photoCount: capImportPhotos(row.photoUrls, opts.paidPhotos).length,
      existingListingId: null,
      errorMessage: null,
      payload,
    };
    preview.push(item);
    commits.push(item);
  }

  return { preview, commits, counts };
}
