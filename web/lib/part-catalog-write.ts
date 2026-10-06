/** Whitelist for catalog and vendor writes. created_by is never taken from the client. */

/** Columns 000401 grants for UPDATE. created_by is excluded. manufacturer and image_urls are not live columns. */
const EDIT_KEYS = [
  'name',
  'part_number',
  'brand',
  'description',
  'category',
  'unit_of_measure',
  'compatible_models',
  'is_consumable',
  'is_active',
  'sale_price',
  'quantity_on_hand',
  'in_stock',
  'image_url',
] as const;

export function missingCatalogColumn(message?: string): string | null {
  return message?.match(/Could not find the '([^']+)' column/i)?.[1] || null;
}

export function catalogWritePatch(
  action: string,
  body: Record<string, unknown>
): Record<string, unknown> | null {
  if (action === 'archive') {
    return { is_active: false, updated_at: new Date().toISOString() };
  }
  if (action === 'stock') {
    const qty = Math.max(0, Math.floor(Number(body.quantity_on_hand) || 0));
    return {
      in_stock: Boolean(body.in_stock) || qty > 0,
      quantity_on_hand: qty,
      updated_at: new Date().toISOString(),
    };
  }
  if (action === 'edit') {
    const out: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of EDIT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key];
    }
    return out;
  }
  return null;
}

export function vendorInsertPatch(
  body: Record<string, unknown>,
  userId: string
): Record<string, unknown> | null {
  const vendor_name = String(body.vendor_name || '').trim();
  if (!vendor_name || !userId) return null;
  const cost = body.unit_cost;
  const lead = body.lead_time_days;
  return {
    vendor_name,
    vendor_part_number: String(body.vendor_part_number || '').trim() || null,
    unit_cost: cost == null || cost === '' || Number.isNaN(Number(cost)) ? null : Number(cost),
    lead_time_days: lead == null || lead === '' || Number.isNaN(Number(lead)) ? null : Math.floor(Number(lead)),
    url: String(body.url || '').trim() || null,
    notes: String(body.notes || '').trim() || null,
    is_preferred: Boolean(body.is_preferred),
    currency: 'USD',
    is_active: true,
    created_by: userId,
  };
}
