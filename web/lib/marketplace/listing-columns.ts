/**
 * Client-side (anon / signed-in) column lists for public.marketplace_listings.
 *
 * Since migration 000935, anon and authenticated have SELECT only on named
 * columns: serial_number, notes and details are private, so `select('*')` is
 * refused (42501). Public reads use details_public, a generated copy of details
 * without stripe* keys and seller contact keys, aliased back to `details` so
 * existing rendering code keeps working.
 *
 * Seller-only fields (serial_number, notes, raw details) come from the
 * SECURITY DEFINER RPC marketplace_listing_private(p_id) or from server routes
 * that use the service role.
 *
 * Deploy order: this code works before 000935 too. When details_public does not
 * exist yet, withListingColumns() retries with LISTING_PUBLIC_SELECT_LEGACY.
 */

const BASE_COLUMNS = [
  'id',
  'seller_id',
  'title',
  'description',
  'category',
  'condition',
  'manufacturer',
  'model',
  'part_number',
  'wavelength',
  'price',
  'price_type',
  'currency',
  'photos',
  'city',
  'state',
  'zip',
  'status',
  'views',
  'created_at',
  'updated_at',
  'created_by',
  'organization_id',
  'listing_type',
  'images',
  'year_manufactured',
  'qty',
  'quantity',
] as const;

/** Columns that anon / authenticated may never select directly (000935). */
export const LISTING_PRIVATE_COLUMNS = ['serial_number', 'notes', 'details'] as const;

/** Public select for marketplace_listings (000935+). */
export const LISTING_PUBLIC_SELECT = [...BASE_COLUMNS, 'details:details_public'].join(', ');

/** Same list before 000935 is applied (details_public does not exist yet). */
export const LISTING_PUBLIC_SELECT_LEGACY = [...BASE_COLUMNS, 'details'].join(', ');

type PgError = { message?: string; code?: string } | null | undefined;

/** True when the error is "details_public does not exist" (000935 not applied yet). */
export function isMissingDetailsPublic(error: PgError): boolean {
  if (!error) return false;
  const msg = String(error.message || '');
  return /details_public/i.test(msg) && /does not exist|schema cache|could not find/i.test(msg);
}

/**
 * Run a marketplace_listings query with the public column list, retrying once
 * with the legacy list when 000935 is not applied yet.
 */
export async function withListingColumns<T extends { error: PgError }>(
  run: (columns: string) => PromiseLike<T>,
): Promise<T> {
  const first = await run(LISTING_PUBLIC_SELECT);
  if (!isMissingDetailsPublic(first.error)) return first;
  return run(LISTING_PUBLIC_SELECT_LEGACY);
}

export type ListingPrivateFields = {
  serial_number: string | null;
  notes: string | null;
  details: Record<string, unknown> | null;
};

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PgError }>;
};

/**
 * Seller-only fields for one listing (seller, creator or a member of its org),
 * or null for anyone else, when signed out, or before 000935.
 */
export async function loadListingPrivateFields(
  supabase: RpcClient,
  listingId: string,
): Promise<ListingPrivateFields | null> {
  if (!listingId) return null;
  try {
    const { data, error } = await supabase.rpc('marketplace_listing_private', { p_id: listingId });
    if (error || !data || typeof data !== 'object') return null;
    const j = data as Record<string, unknown>;
    return {
      serial_number: typeof j.serial_number === 'string' ? j.serial_number : null,
      notes: typeof j.notes === 'string' ? j.notes : null,
      details: j.details && typeof j.details === 'object' ? (j.details as Record<string, unknown>) : null,
    };
  } catch {
    return null;
  }
}
