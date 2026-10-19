/**
 * Logged-out directory page loader (GET /api/directory).
 * Reads through public.public_directory_page (000931) with the ANON key: no
 * service role. The RPC returns only listed, active, non-import,
 * non-prospect, non-lead orgs (id/type/state) and a listed-only total.
 * The row filter is repeated here as defense in depth.
 */
import {
  clampGuestDirectoryPageSize,
  guestDirectoryTypeFilter,
  redactDirectoryOrg,
  type GuestDirectoryCard,
} from './guest.ts';

export const PUBLIC_DIRECTORY_RPC = 'public_directory_page';
export const GUEST_DIRECTORY_MAX_PAGE = 200;

/** Import tag written into organizations.notes by the clinic imports (e.g. "Import: intl-clinics-1018"). */
const IMPORT_NOTE = /(^|[^a-z])import:/i;

/** PostgREST .or() filter for the signed-in directory: drop rows tagged as clinic imports (keeps NULL notes). */
export const DIRECTORY_NOT_IMPORTED_OR = 'notes.is.null,notes.not.ilike.*Import:*';

export type PublicDirectoryRow = {
  id?: number | string | null;
  type?: string | null;
  state?: string | null;
  list_in_directory?: boolean | null;
  is_active?: boolean | null;
  notes?: string | null;
  prospect_pool?: boolean | null;
  lead_source?: string | null;
};

export type DirectoryRpc = (
  fn: string,
  args: { p_types: string[] | null; p_offset: number; p_limit: number }
) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;

export type GuestDirectoryResult =
  | { ok: true; listings: GuestDirectoryCard[]; page: number; pageSize: number; hasMore: boolean; total: number }
  | { ok: false; status: number };

/** Rows a logged-out visitor may ever see. Unknown flags are treated as listed only when the RPC said so. */
export function isPublicDirectoryRow(row: PublicDirectoryRow | null | undefined): boolean {
  if (!row || row.id == null) return false;
  if (row.list_in_directory === false) return false;
  if (row.is_active === false) return false;
  if (row.notes && IMPORT_NOTE.test(row.notes)) return false;
  if (row.prospect_pool === true) return false;
  if (row.lead_source != null && String(row.lead_source).trim() !== '') return false;
  return true;
}

export async function loadGuestDirectoryPage(
  rpc: DirectoryRpc,
  params: { page?: string | null; limit?: string | null; filter?: string | null }
): Promise<GuestDirectoryResult> {
  const page = Math.min(
    GUEST_DIRECTORY_MAX_PAGE,
    Math.max(1, Number.parseInt(params.page || '1', 10) || 1)
  );
  const pageSize = clampGuestDirectoryPageSize(params.limit);
  const types = guestDirectoryTypeFilter(params.filter);
  const offset = (page - 1) * pageSize;

  const { data, error } = await rpc(PUBLIC_DIRECTORY_RPC, {
    p_types: types,
    p_offset: offset,
    p_limit: pageSize,
  });
  if (error || !data || typeof data !== 'object') return { ok: false, status: 503 };

  const payload = data as { rows?: unknown; total?: unknown };
  const rows = (Array.isArray(payload.rows) ? payload.rows : []) as PublicDirectoryRow[];
  const safe = rows.filter(isPublicDirectoryRow).slice(0, pageSize);
  const total = typeof payload.total === 'number' && Number.isFinite(payload.total) ? payload.total : 0;
  // Only id/type/state go into the card builder.
  const listings = safe.map((r) => redactDirectoryOrg({ id: r.id, type: r.type, state: r.state }));
  return {
    ok: true,
    listings,
    page,
    pageSize,
    hasMore: offset + rows.length < total,
    total,
  };
}
