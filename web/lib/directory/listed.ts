/**
 * Signed-in directory "All listed" (GET /api/directory/listed).
 *
 * Since 000932 the import/prospect/lead markers (notes, prospect_pool,
 * lead_source) are not readable by authenticated, so the old client query
 * that filtered on notes got 403 42501 and the page showed nothing. The
 * route reads with the service role and applies the same exclusions as
 * public.public_directory_page:
 *   list_in_directory IS TRUE, is_active IS DISTINCT FROM false,
 *   notes !~* '(^|[^a-z])(re)?import[[:space:]]*:',
 *   coalesce(prospect_pool::text, '') IN ('', 'false', 'f'),
 *   coalesce(lead_source, '') = ''.
 * Only the columns the page renders leave the server.
 */
import { fetchAllPages } from '../supabase/paginate.ts';

/** Readable columns the signed-in directory renders. Never a private column. */
export const SIGNED_IN_DIRECTORY_COLUMNS = [
  'id',
  'name',
  'type',
  'city',
  'state',
  'phone',
  'email',
  'website',
  'logo_url',
  'list_in_directory',
  'is_active',
] as const;

/** Server-only columns read for the exclusions, then dropped. */
const EXCLUSION_COLUMNS = ['notes', 'prospect_pool', 'lead_source'] as const;

const IMPORT_NOTE = /(^|[^a-z])(re)?import\s*:/i;

export type SignedInDirectoryRow = {
  id: number | string;
  name: string | null;
  type: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_url: string | null;
  list_in_directory: boolean | null;
  is_active: boolean | null;
};

type RawRow = Record<string, unknown>;

/** Same row rule as public_directory_page (000932). */
export function isListedDirectoryRow(row: RawRow | null | undefined): boolean {
  if (!row || row.id == null) return false;
  if (row.list_in_directory !== true) return false;
  if (row.is_active === false) return false;
  if (typeof row.notes === 'string' && IMPORT_NOTE.test(row.notes)) return false;
  const pp = row.prospect_pool == null ? '' : String(row.prospect_pool);
  if (pp !== '' && pp !== 'false' && pp !== 'f') return false;
  const lead = row.lead_source == null ? '' : String(row.lead_source);
  if (lead !== '') return false;
  return true;
}

export function toSignedInDirectoryRow(row: RawRow): SignedInDirectoryRow {
  const out: Record<string, unknown> = {};
  for (const c of SIGNED_IN_DIRECTORY_COLUMNS) out[c] = row[c] ?? null;
  return out as SignedInDirectoryRow;
}

type AdminLike = { from: (table: string) => any };

export async function loadSignedInDirectory(
  admin: AdminLike
): Promise<{ ok: true; listings: SignedInDirectoryRow[]; total: number } | { ok: false }> {
  const select = [...SIGNED_IN_DIRECTORY_COLUMNS, ...EXCLUSION_COLUMNS].join(', ');
  const res = await fetchAllPages<RawRow>((from, to) =>
    admin
      .from('organizations')
      .select(select)
      .eq('list_in_directory', true)
      .order('name')
      .order('id')
      .range(from, to)
  );
  if (res.error) return { ok: false };
  const listings = (res.data || []).filter(isListedDirectoryRow).map(toSignedInDirectoryRow);
  return { ok: true, listings, total: listings.length };
}
