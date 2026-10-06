/**
 * Client-side manuals library filters (search + make + room + extras).
 * Body/PDF matches come from /api/manuals/search and are OR'd with metadata.
 * Discovery always runs against the full catalog, not the owned library.
 */

import {
  catalogManualKind,
  catalogManualKindLabel,
  catalogManualTitle,
  isManualIncomplete,
  manualLibraryShelf,
  type ManualLibraryShelf,
} from './manual-catalog.ts';
import {
  DEFAULT_EQUIPMENT_TYPE,
  EQUIPMENT_TYPES,
  equipmentTypeMeta,
  inferEquipmentType,
  type EquipmentType,
  type EquipmentTypeMeta,
} from './equipment-types.ts';
import {
  ALL_MANUAL_LANGUAGES,
  manualLanguageFilterOptions,
  manualQueryLanguageMatch,
  resolveManualLanguage,
  type ManualLanguageOption,
} from './manual-language.ts';
import { normalizeManualSearchText } from './manual-search-text.ts';

export type ManualLibraryRow = {
  id?: string | number | null;
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  description?: string | null;
  storage_path?: string | null;
  equipment_type?: string | null;
  wavelengths?: unknown;
  is_incomplete?: unknown;
  isIncomplete?: unknown;
  completeness_note?: string | null;
  doc_kind?: string | null;
  /** ISO 639-1. Missing means English once the column exists; title suffixes still resolve. */
  language?: string | null;
};

export type ManualLibraryRoom = EquipmentType | 'all';

export type { ManualLibraryShelf };

export const DEFAULT_MANUAL_LIBRARY: ManualLibraryShelf = 'service';

export type ManualLibraryFilters = {
  query?: string;
  brand?: string;
  room?: ManualLibraryRoom;
  wavelength?: string;
  incompleteOnly?: boolean;
  /** Which public library shelf. Default is Service Manuals. */
  library?: ManualLibraryShelf;
  /** ISO 639-1, or All. Empty and "all" do not restrict the catalog. */
  language?: string;
};

export const ALL_MANUAL_ROOMS: ManualLibraryRoom = 'all';

export function sanitizeManualSearchQuery(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[^\p{L}\p{N}\s._/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function manualSearchTokens(query: string): string[] {
  return normalizeManualSearchText(sanitizeManualSearchQuery(query))
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function manualSearchHaystack(manual: ManualLibraryRow): string {
  const room = inferEquipmentType({
    equipment_type: manual.equipment_type,
    title: manual.title,
    brand: manual.brand,
    model: manual.model,
    storage_path: manual.storage_path,
  });
  const meta = equipmentTypeMeta(room);
  const wls = Array.isArray(manual.wavelengths) ? manual.wavelengths.join(' ') : '';
  return normalizeManualSearchText(
    [
      catalogManualTitle(manual),
      manual.title,
      manual.brand,
      manual.model,
      manual.description,
      manual.storage_path,
      catalogManualKindLabel(catalogManualKind(manual)),
      meta.label,
      meta.roomLabel,
      wls,
    ].join(' ')
  );
}

function hayIncludes(hay: string, token: string): boolean {
  if (!token) return true;
  if (hay.includes(token)) return true;
  return hay.replace(/\s+/g, '').includes(token.replace(/\s+/g, ''));
}

/** Text left after language names are taken out. Empty means the query is only a language tag. */
export function manualSearchBodyQuery(query: string): string {
  return manualQueryLanguageMatch(query).textQuery;
}

export function manualMatchesQuery(manual: ManualLibraryRow, query: string): boolean {
  const tokens = manualSearchTokens(manualSearchBodyQuery(query));
  if (!tokens.length) return true;
  const hay = manualSearchHaystack(manual);
  return tokens.every((t) => hayIncludes(hay, t));
}

/** Prefer DB wavelengths[] tags; fall back to title heuristics for older rows. */
export function matchesWavelength(manual: ManualLibraryRow, wavelength: string): boolean {
  if (!wavelength) return true;

  const tags: string[] = Array.isArray(manual?.wavelengths)
    ? manual.wavelengths.map((w) => String(w).toLowerCase())
    : [];

  if (tags.length) {
    if (wavelength === 'multi') {
      if (tags.includes('multi')) return true;
      const primary = ['532', '755', '1064', '10600', '595'];
      return primary.filter((p) => tags.includes(p)).length >= 2;
    }
    return tags.includes(String(wavelength).toLowerCase());
  }

  const title = (manual.title || '').toLowerCase();
  if (wavelength === 'multi') return title.includes('multi') || title.includes('combination');
  if (wavelength === '532') return title.includes('532') || title.includes('ktp') || title.includes('greenlight');
  if (wavelength === '755') return title.includes('755') || title.includes('alex') || title.includes('gentlelase');
  if (wavelength === '1064') return title.includes('1064') || title.includes('nd:yag') || title.includes('gentleyag');
  if (wavelength === '10600') {
    return title.includes('co2') || title.includes('10600') || title.includes('ultrapulse') || title.includes('acupulse');
  }
  if (wavelength === '595') {
    return (
      title.includes('595') ||
      title.includes('dye') ||
      title.includes('pdl') ||
      title.includes('vbeam') ||
      title.includes('sclero')
    );
  }
  return false;
}

export function manualRowId(manual: ManualLibraryRow | null | undefined): string | null {
  if (manual?.id == null) return null;
  const id = String(manual.id).trim();
  return id || null;
}

export function uniqueManualBrands(rows: ManualLibraryRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const label = String(row.brand || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export type ManualBrandShelf = {
  brand: string;
  manuals: ManualLibraryRow[];
};

/** Case-insensitive A–Z. Case-only differences compare equal; the shelf list breaks those ties in first-seen order. */
export function compareManufacturerShelves(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'accent' });
}

/**
 * Manufacturer shelves for My Library / Browse. Headers sort A–Z
 * (case-insensitive). Manuals inside a shelf stay in input order.
 * Returned as an array so numeric-looking names keep this order
 * (plain object keys would re-sort integer indexes).
 */
export function manufacturerShelves(rows: ManualLibraryRow[]): ManualBrandShelf[] {
  const groups = new Map<string, ManualLibraryRow[]>();
  for (const m of rows) {
    const brand = String(m.brand || '').trim() || 'Other';
    const list = groups.get(brand);
    if (list) list.push(m);
    else groups.set(brand, [m]);
  }
  const brands = [...groups.keys()];
  const seen = new Map(brands.map((brand, index) => [brand, index]));
  brands.sort((a, b) => {
    const cmp = compareManufacturerShelves(a, b);
    if (cmp !== 0) return cmp;
    return (seen.get(a) ?? 0) - (seen.get(b) ?? 0);
  });
  return brands.map((brand) => ({ brand, manuals: groups.get(brand) || [] }));
}

export function groupManualsByBrand(rows: ManualLibraryRow[]): Record<string, ManualLibraryRow[]> {
  const groups: Record<string, ManualLibraryRow[]> = {};
  for (const shelf of manufacturerShelves(rows)) groups[shelf.brand] = shelf.manuals;
  return groups;
}

/**
 * Languages that actually appear on this room + shelf.
 * Room "all" keeps every language on the shelf. Counts use the same
 * effective language as the spine badge, including a trailing bracket's last word.
 * "All languages" is always present.
 */
export function manualLanguageOptionsForView(
  rows: ManualLibraryRow[],
  scope: { room?: ManualLibraryRoom | null; library?: ManualLibraryShelf | null } = {}
): ManualLanguageOption[] {
  const library: ManualLibraryShelf = scope.library === 'operators' ? 'operators' : 'service';
  const room = scope.room && scope.room !== ALL_MANUAL_ROOMS ? scope.room : null;
  const visible = rows.filter((row) => {
    if (manualLibraryShelf(row) !== library) return false;
    if (!room) return true;
    return (
      inferEquipmentType({
        equipment_type: row.equipment_type,
        title: row.title,
        brand: row.brand,
        model: row.model,
        storage_path: row.storage_path,
      }) === room
    );
  });
  return manualLanguageFilterOptions(visible);
}

/**
 * Rooms that have at least one manual on this shelf under the current
 * discovery filters (search, make, language, incomplete, PDF body hits).
 * Order follows EQUIPMENT_TYPES. Rooms with no manuals are omitted.
 */
export function manualRoomsForView(
  rows: ManualLibraryRow[],
  scope: {
    library?: ManualLibraryShelf | null;
    query?: string;
    brand?: string;
    language?: string;
    incompleteOnly?: boolean;
  } = {},
  bodyMatchIds?: Set<string> | null
): EquipmentTypeMeta[] {
  const library: ManualLibraryShelf = scope.library === 'operators' ? 'operators' : 'service';
  const visible = filterManualLibrary(
    rows,
    {
      query: scope.query,
      brand: scope.brand,
      language: scope.language,
      incompleteOnly: scope.incompleteOnly,
      room: ALL_MANUAL_ROOMS,
      library,
    },
    bodyMatchIds
  );
  const present = new Set<EquipmentType>();
  for (const row of visible) {
    present.add(
      inferEquipmentType({
        equipment_type: row.equipment_type,
        title: row.title,
        brand: row.brand,
        model: row.model,
        storage_path: row.storage_path,
      })
    );
  }
  return EQUIPMENT_TYPES.filter((meta) => present.has(meta.value));
}

export function manualLibraryFiltersActive(filters: ManualLibraryFilters): boolean {
  const language = String(filters.language || '')
    .trim()
    .toLowerCase();
  return Boolean(
    sanitizeManualSearchQuery(filters.query || '') ||
      String(filters.brand || '').trim() ||
      filters.incompleteOnly ||
      String(filters.wavelength || '').trim() ||
      (language && language !== ALL_MANUAL_LANGUAGES)
  );
}

/**
 * Search/make/incomplete are catalog discovery filters — they do not
 * restrict the list to company-owned manuals. Room + wavelength still AND.
 */
export function filterManualLibrary(
  rows: ManualLibraryRow[],
  filters: ManualLibraryFilters,
  bodyMatchIds?: Set<string> | null
): ManualLibraryRow[] {
  const query = sanitizeManualSearchQuery(filters.query || '');
  const languageQuery = manualQueryLanguageMatch(query);
  const textQuery = languageQuery.textQuery;
  const tokens = manualSearchTokens(textQuery);
  const brand = String(filters.brand || '')
    .trim()
    .toLowerCase();
  const room = filters.room && filters.room !== ALL_MANUAL_ROOMS ? filters.room : null;
  const wavelength = String(filters.wavelength || '').trim();
  const incompleteOnly = !!filters.incompleteOnly;
  const library: ManualLibraryShelf = filters.library === 'operators' ? 'operators' : 'service';
  const language = String(filters.language || '')
    .trim()
    .toLowerCase();
  const applyLanguage = !!language && language !== ALL_MANUAL_LANGUAGES;
  const applyWavelength = room === 'laser' || (!room && !!wavelength);

  return rows.filter((m) => {
    if (manualLibraryShelf(m) !== library) return false;
    const inferred = inferEquipmentType({
      equipment_type: m.equipment_type,
      title: m.title,
      brand: m.brand,
      model: m.model,
      storage_path: m.storage_path,
    });
    if (room && inferred !== room) return false;
    if (brand && String(m.brand || '').trim().toLowerCase() !== brand) return false;
    if (applyLanguage && resolveManualLanguage(m) !== language) return false;
    if (languageQuery.codes.some((code) => resolveManualLanguage(m) !== code)) return false;
    if (incompleteOnly && !isManualIncomplete(m)) return false;
    if (applyWavelength && !matchesWavelength(m, wavelength)) return false;
    // A language name is a tag filter. PDF body text that merely contains the word does not count.
    if (!tokens.length) return true;
    if (manualMatchesQuery(m, textQuery)) return true;
    const id = manualRowId(m);
    return !!(id && bodyMatchIds && bodyMatchIds.has(id));
  });
}

export function parseManualLibrarySearchParams(search: string): ManualLibraryFilters {
  const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const roomRaw = String(qs.get('room') || '').trim();
  const room: ManualLibraryRoom | undefined =
    roomRaw === 'all' ? 'all' : roomRaw ? (roomRaw as EquipmentType) : DEFAULT_EQUIPMENT_TYPE;
  const libRaw = String(qs.get('lib') || '').trim().toLowerCase();
  const langRaw = String(qs.get('lang') || '')
    .trim()
    .toLowerCase();
  return {
    query: sanitizeManualSearchQuery(qs.get('q') || ''),
    brand: String(qs.get('make') || '').trim(),
    room,
    incompleteOnly: qs.get('incomplete') === '1',
    library: libRaw === 'operators' || libRaw === 'operator' ? 'operators' : DEFAULT_MANUAL_LIBRARY,
    language: langRaw && langRaw !== ALL_MANUAL_LANGUAGES ? langRaw : '',
  };
}

export function manualLibrarySearchParams(filters: ManualLibraryFilters): string {
  const qs = new URLSearchParams();
  const q = sanitizeManualSearchQuery(filters.query || '');
  const brand = String(filters.brand || '').trim();
  if (q) qs.set('q', q);
  if (brand) qs.set('make', brand);
  if (filters.room === 'all') qs.set('room', 'all');
  else if (filters.room && filters.room !== DEFAULT_EQUIPMENT_TYPE) qs.set('room', filters.room);
  if (filters.incompleteOnly) qs.set('incomplete', '1');
  if (filters.library === 'operators') qs.set('lib', 'operators');
  const language = String(filters.language || '')
    .trim()
    .toLowerCase();
  if (language && language !== ALL_MANUAL_LANGUAGES) qs.set('lang', language);
  return qs.toString();
}

/**
 * Catalog columns that exist on live public.manuals (Total Service Pro).
 * Prefer doc_kind when present so Operators vs Service shelving can use the
 * stored type. Fall back if the column is missing — PostgREST 400s the whole
 * query otherwise, which emptied Browse All while manuals(*) embeds still worked.
 * Never request description, completeness_note, or search_text (search_text
 * lives on manual_search_index).
 */
export const MANUAL_LIBRARY_SELECT =
  'id, brand, title, model, storage_path, is_folder, equipment_type, is_incomplete, wavelengths, chapter_metadata';

/** Prefer doc_kind when the live column exists; fall back if PostgREST 400s. */
export const MANUAL_LIBRARY_SELECT_WITH_KIND = `${MANUAL_LIBRARY_SELECT}, doc_kind`;

/** Prefer language when the live column exists; fall back to doc_kind if it is missing. */
export const MANUAL_LIBRARY_SELECT_WITH_LANGUAGE = `${MANUAL_LIBRARY_SELECT_WITH_KIND}, language`;

/** Folder-era catalogs before equipment rooms / wavelengths. */
export const MANUAL_LIBRARY_SELECT_LEGACY = 'id, brand, title, model, storage_path, is_folder';

/** Original core columns if even is_folder is missing. */
export const MANUAL_LIBRARY_SELECT_MINIMAL = 'id, brand, title, model, storage_path';

export const MANUAL_LIBRARY_SELECT_CANDIDATES = [
  MANUAL_LIBRARY_SELECT_WITH_LANGUAGE,
  MANUAL_LIBRARY_SELECT_WITH_KIND,
  MANUAL_LIBRARY_SELECT,
  MANUAL_LIBRARY_SELECT_LEGACY,
  MANUAL_LIBRARY_SELECT_MINIMAL,
] as const;

export function isManualsSelectSchemaError(message?: string | null): boolean {
  return /schema cache|column|does not exist|PGRST204|language|doc_kind|description|completeness|equipment_type|wavelengths|chapter_metadata|is_folder|is_incomplete/i.test(
    String(message || '')
  );
}

export async function fetchManualLibraryRows<T>(
  fetchSelect: (select: string) => Promise<{ data: T[]; error: { message?: string } | null }>
): Promise<{ data: T[]; error: { message?: string } | null }> {
  let last: { data: T[]; error: { message?: string } | null } = {
    data: [],
    error: { message: 'No catalog select attempted' },
  };
  for (const select of MANUAL_LIBRARY_SELECT_CANDIDATES) {
    last = await fetchSelect(select);
    if (!last.error) return last;
    if (!isManualsSelectSchemaError(last.error.message)) return last;
  }
  return last;
}
