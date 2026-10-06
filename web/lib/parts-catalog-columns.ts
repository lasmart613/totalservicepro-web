/**
 * Live public.parts_catalog (Oct 2026): brand, not manufacturer.
 * image_url is the only photo column. Do not send manufacturer or image_urls.
 */

export const PARTS_CATALOG_COLUMNS = [
  'id',
  'part_number',
  'name',
  'description',
  'category',
  'brand',
  'compatible_models',
  'unit_of_measure',
  'is_active',
  'created_by',
  'created_at',
  'updated_at',
  'image_url',
  'is_consumable',
  'sale_price',
  'in_stock',
  'quantity_on_hand',
] as const;

/** Live parts_catalog_category_check. Stored option values must match these strings. */
export const PARTS_CATALOG_CATEGORIES = [
  'Handpiece Components',
  'Power Supplies',
  'Optical Components',
  'Cooling System',
  'Electronics/Boards',
  'Mechanical/Frame',
  'Other',
] as const;

export const PART_SAVE_ERROR = "Couldn't save this part. Check the category and try again.";

/** Database and PostgREST failures stay out of the toast. Sign-in text is ours. */
export function partCatalogSaveMessage(raw: string | null | undefined): string {
  const message = String(raw || '');
  if (/sign in/i.test(message)) return message;
  return PART_SAVE_ERROR;
}

export type PartsCatalogColumn = (typeof PARTS_CATALOG_COLUMNS)[number];

const COLUMN_SET = new Set<string>(PARTS_CATALOG_COLUMNS);

export type PartsCatalogWriteInput = {
  part_number?: string | null;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  /** Live column. */
  brand?: string | null;
  /**
   * UI alias only. Copied into brand when brand is empty.
   * Never written to PostgREST.
   */
  manufacturer?: string | null;
  compatible_models?: string[] | null;
  unit_of_measure?: string | null;
  is_active?: boolean | null;
  created_by?: string | null;
  image_url?: string | null;
  /** Not a column. The first entry is kept as image_url when image_url is empty. */
  image_urls?: string[] | null;
  is_consumable?: boolean | null;
  sale_price?: number | null;
  in_stock?: boolean | null;
  quantity_on_hand?: number | null;
  updated_at?: string | null;
};

/** Display label. The database column is brand. */
export function partsCatalogManufacturerLabel(row: { brand?: string | null } | null | undefined): string {
  return String(row?.brand || '').trim();
}

/**
 * Map a form payload onto live parts_catalog columns.
 * manufacturer is accepted as a brand alias and then dropped.
 */
export function partsCatalogWritePayload(input: PartsCatalogWriteInput): Record<string, unknown> {
  const brandFromAlias = String(input.brand ?? '').trim() || String(input.manufacturer ?? '').trim();
  const imageFromList = Array.isArray(input.image_urls)
    ? input.image_urls.map((url) => String(url || '').trim()).find(Boolean) || null
    : null;
  let imageUrl: string | null | undefined;
  if (input.image_url !== undefined) {
    const trimmed = input.image_url == null ? '' : String(input.image_url).trim();
    imageUrl = trimmed || imageFromList;
  } else if (imageFromList) {
    imageUrl = imageFromList;
  }

  const row: Record<string, unknown> = {};
  if (input.part_number !== undefined) row.part_number = input.part_number;
  if (input.name !== undefined) row.name = input.name;
  if (input.description !== undefined) row.description = input.description;
  if (input.category !== undefined) row.category = input.category;
  if (input.brand !== undefined || input.manufacturer !== undefined) {
    row.brand = brandFromAlias || null;
  }
  if (input.compatible_models !== undefined) row.compatible_models = input.compatible_models;
  if (input.unit_of_measure !== undefined) row.unit_of_measure = input.unit_of_measure;
  if (input.is_active !== undefined) row.is_active = input.is_active;
  if (input.created_by !== undefined) row.created_by = input.created_by;
  if (imageUrl !== undefined) row.image_url = imageUrl;
  if (input.is_consumable !== undefined) row.is_consumable = input.is_consumable;
  if (input.sale_price !== undefined) row.sale_price = input.sale_price;
  if (input.in_stock !== undefined) row.in_stock = input.in_stock;
  if (input.quantity_on_hand !== undefined) row.quantity_on_hand = input.quantity_on_hand;
  if (input.updated_at !== undefined) row.updated_at = input.updated_at;

  delete row.manufacturer;
  delete row.image_urls;
  for (const key of Object.keys(row)) {
    if (!COLUMN_SET.has(key)) delete row[key];
  }
  return row;
}
