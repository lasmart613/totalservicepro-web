/**
 * Client-side manuals library filters (search + make + room + extras).
 * Body/PDF matches come from /api/manuals/search and are OR'd with metadata.
 * Discovery always runs against the full catalog, not the owned library.
 */

import { catalogManualKind, catalogManualKindLabel, catalogManualTitle, isManualIncomplete } from './manual-catalog.ts';
import {
  DEFAULT_EQUIPMENT_TYPE,
  equipmentTypeMeta,
  inferEquipmentType,
  type EquipmentType,
} from './equipment-types.ts';
import { normalizeManualSearchText } from './manual-pdf-text.ts';

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
};

export type ManualLibraryRoom = EquipmentType | 'all';

export type ManualLibraryFilters = {
  query?: string;
  brand?: string;
  room?: ManualLibraryRoom;
  wavelength?: string;
  incompleteOnly?: boolean;
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

export function manualMatchesQuery(manual: ManualLibraryRow, query: string): boolean {
  const tokens = manualSearchTokens(query);
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

export function groupManualsByBrand(rows: ManualLibraryRow[]): Record<string, ManualLibraryRow[]> {
  const groups: Record<string, ManualLibraryRow[]> = {};
  for (const m of rows) {
    const brand = String(m.brand || '').trim() || 'Other';
    if (!groups[brand]) groups[brand] = [];
    groups[brand].push(m);
  }
  return groups;
}

export function manualLibraryFiltersActive(filters: ManualLibraryFilters): boolean {
  return Boolean(
    sanitizeManualSearchQuery(filters.query || '') ||
      String(filters.brand || '').trim() ||
      filters.incompleteOnly ||
      String(filters.wavelength || '').trim()
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
  const tokens = manualSearchTokens(query);
  const brand = String(filters.brand || '')
    .trim()
    .toLowerCase();
  const room = filters.room && filters.room !== ALL_MANUAL_ROOMS ? filters.room : null;
  const wavelength = String(filters.wavelength || '').trim();
  const incompleteOnly = !!filters.incompleteOnly;
  const applyWavelength = room === 'laser' || (!room && !!wavelength);

  return rows.filter((m) => {
    const inferred = inferEquipmentType({
      equipment_type: m.equipment_type,
      title: m.title,
      brand: m.brand,
      model: m.model,
      storage_path: m.storage_path,
    });
    if (room && inferred !== room) return false;
    if (brand && String(m.brand || '').trim().toLowerCase() !== brand) return false;
    if (incompleteOnly && !isManualIncomplete(m)) return false;
    if (applyWavelength && !matchesWavelength(m, wavelength)) return false;
    if (!tokens.length) return true;
    if (manualMatchesQuery(m, query)) return true;
    const id = manualRowId(m);
    return !!(id && bodyMatchIds && bodyMatchIds.has(id));
  });
}

export function parseManualLibrarySearchParams(search: string): ManualLibraryFilters {
  const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const roomRaw = String(qs.get('room') || '').trim();
  const room: ManualLibraryRoom | undefined =
    roomRaw === 'all' ? 'all' : roomRaw ? (roomRaw as EquipmentType) : DEFAULT_EQUIPMENT_TYPE;
  return {
    query: sanitizeManualSearchQuery(qs.get('q') || ''),
    brand: String(qs.get('make') || '').trim(),
    room,
    incompleteOnly: qs.get('incomplete') === '1',
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
  return qs.toString();
}

/** Columns safe to select in the library UI — never pull search_text. */
export const MANUAL_LIBRARY_SELECT =
  'id, brand, title, model, storage_path, doc_kind, is_folder, equipment_type, is_incomplete, wavelengths, description, completeness_note, chapter_metadata';

export const MANUAL_LIBRARY_SELECT_LEGACY = 'id, brand, title, model, storage_path, doc_kind, is_folder';
