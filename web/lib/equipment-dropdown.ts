/**
 * Shared manufacturer / model dropdown catalog.
 *
 * Live dropdowns join public.manufacturers ↔ public.laser_models by
 * manufacturer_id OR name (case-insensitive, aliases). Static MODELS +
 * EQUIPMENT_CATALOG are always merged so offline / empty-DB still works.
 *
 * Do not filter manufacturers by the manufacturers.category text
 * ("Medical Laser") — that is not equipment_type and blanks laser brands.
 */
import { EQUIPMENT_CATALOG, extraManufacturerNames } from './equipment-catalog.ts';
import {
  DEFAULT_EQUIPMENT_TYPE,
  inferEquipmentType,
  normalizeEquipmentType,
  type EquipmentType,
} from './equipment-types.ts';
import { MODELS } from './models.ts';
import { fetchAllPages } from './supabase/paginate.ts';

export type CatalogManufacturer = {
  id: string | number | null;
  name: string;
};

export type CatalogModel = {
  id?: string | number | null;
  name: string;
  label: string;
  manufacturer_id?: string | number | null;
  manufacturer?: string | null;
  equipment_type?: string | null;
};

export type LiveCatalog = {
  manufacturers?: CatalogManufacturer[];
  models?: CatalogModel[];
};

const FALLBACK_MFRS = [
  'Alma',
  'Candela',
  'Coherent',
  'Cutera',
  'Cynosure',
  'Fotona',
  'HOYA ConBio',
  'InMode',
  'Iridex',
  'Lumenis',
  'Lutronic',
  'Quanta',
  'Sciton',
  'Syneron',
  ...extraManufacturerNames(),
];

function norm(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function tokens(value: string): string[] {
  return norm(value)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function catalogAliasSet(name: string): Set<string> {
  const keys = new Set<string>();
  const n = String(name || '').trim();
  if (!n) return keys;
  keys.add(norm(n));
  n.split('/').forEach((part) => {
    const p = part.trim();
    if (p) keys.add(norm(p));
  });
  const sorted = tokens(n).sort().join(' ');
  if (sorted) keys.add(sorted);
  for (const row of EQUIPMENT_CATALOG) {
    const names = [row.name, ...(row.aliases || [])];
    if (names.some((alias) => norm(alias) === norm(n))) {
      names.forEach((alias) => {
        keys.add(norm(alias));
        const aliasSorted = tokens(alias).sort().join(' ');
        if (aliasSorted) keys.add(aliasSorted);
      });
    }
  }
  return keys;
}

export function manufacturerNamesEqual(a: string, b: string): boolean {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return false;
  if (norm(left) === norm(right)) return true;
  const ka = catalogAliasSet(left);
  const kb = catalogAliasSet(right);
  for (const key of ka) {
    if (key && kb.has(key)) return true;
  }
  const ta = tokens(left);
  const tb = tokens(right);
  if (ta.length && tb.length) {
    const [smaller, larger] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    if (smaller.every((t) => larger.includes(t))) return true;
  }
  return false;
}

export function manufacturerMatches(selected: string, mfr: CatalogManufacturer): boolean {
  const sel = String(selected || '').trim();
  if (!sel || !mfr) return false;
  if (mfr.id != null && String(mfr.id) === sel) return true;
  return manufacturerNamesEqual(sel, mfr.name || '');
}

export function modelBelongsToManufacturer(
  model: CatalogModel,
  selected: string,
  manufacturers: CatalogManufacturer[] = []
): boolean {
  const sel = String(selected || '').trim();
  if (!sel || !model) return false;

  if (model.manufacturer_id != null && String(model.manufacturer_id) === sel) return true;

  const matched = manufacturers.filter((m) => manufacturerMatches(sel, m));
  if (
    matched.some(
      (m) =>
        m.id != null &&
        model.manufacturer_id != null &&
        String(m.id) === String(model.manufacturer_id)
    )
  ) {
    return true;
  }

  if (model.manufacturer && manufacturerNamesEqual(sel, model.manufacturer)) return true;

  return matched.some((m) => m.name && model.manufacturer && manufacturerNamesEqual(m.name, model.manufacturer));
}

/**
 * Laser (default) keeps null / blank / unknown types so legacy laser_models
 * rows are not blanked. Other types require a real match.
 */
export function modelMatchesEquipmentType(
  modelType: string | null | undefined,
  selected?: string | null
): boolean {
  if (selected == null || String(selected).trim() === '') return true;
  const want = normalizeEquipmentType(selected);
  if (!want) return true;
  const have = normalizeEquipmentType(modelType);
  if (want === DEFAULT_EQUIPMENT_TYPE) {
    return !have || have === DEFAULT_EQUIPMENT_TYPE;
  }
  return have === want;
}

export function normalizeManufacturerRow(row: any): CatalogManufacturer {
  return {
    id: row?.id ?? row?.manufacturer_id ?? null,
    name: String(row?.name || row?.manufacturer_name || row?.manufacturer || '').trim(),
  };
}

export function normalizeModelRow(row: any): CatalogModel {
  return {
    id: row?.id ?? null,
    name: String(row?.name || row?.model_name || row?.model || '').trim(),
    label: String(row?.label || row?.name || row?.model_name || row?.model || '').trim(),
    manufacturer_id: row?.manufacturer_id ?? null,
    manufacturer: row?.manufacturer || row?.manufacturer_name || null,
    equipment_type: row?.equipment_type ?? null,
  };
}

export function staticManufacturerRows(): CatalogManufacturer[] {
  const names = new Set<string>(FALLBACK_MFRS);
  Object.values(MODELS).forEach((m) => {
    if (m?.mfg) {
      m.mfg.split('/').forEach((part) => {
        const n = part.trim();
        if (n) names.add(n);
      });
      names.add(m.mfg.trim());
    }
  });
  EQUIPMENT_CATALOG.forEach((m) => names.add(m.name));
  return Array.from(names)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ id: null, name }));
}

export function staticModelRows(): CatalogModel[] {
  const out: CatalogModel[] = [];
  Object.entries(MODELS).forEach(([key, def]) => {
    out.push({
      name: key,
      label: def.label || key,
      manufacturer: def.mfg,
      equipment_type: inferEquipmentType({
        brand: def.mfg,
        model: def.label || key,
        title: def.label,
      }),
    });
  });
  for (const mfr of EQUIPMENT_CATALOG) {
    for (const model of mfr.models) {
      out.push({
        name: model.name,
        label: model.label || model.name,
        manufacturer: mfr.name,
        equipment_type: model.equipmentType,
      });
    }
  }
  return out;
}

export function listCatalogManufacturers(live?: LiveCatalog): string[] {
  const set = new Set<string>();
  staticManufacturerRows().forEach((m) => {
    if (m.name) set.add(m.name);
  });
  (live?.manufacturers || []).forEach((m) => {
    if (m?.name) set.add(m.name);
  });
  return Array.from(set)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function listCatalogModels(
  manufacturer: string,
  live?: LiveCatalog & { equipmentType?: string | null | EquipmentType }
): string[] {
  if (!manufacturer || manufacturer === '__other__') return [];
  const manufacturers = [...staticManufacturerRows(), ...(live?.manufacturers || [])];
  const models = [...staticModelRows(), ...(live?.models || [])];
  const names = new Set<string>();
  for (const model of models) {
    if (!modelBelongsToManufacturer(model, manufacturer, manufacturers)) continue;
    if (!modelMatchesEquipmentType(model.equipment_type, live?.equipmentType)) continue;
    const label = model.label || model.name;
    if (label) names.add(label);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

type QueryBuilder = {
  select: (cols: string) => QueryBuilder;
  order: (col: string) => QueryBuilder;
  range: (from: number, to: number) => Promise<{ data: any[] | null; error: { message?: string } | null }>;
};

export async function fetchEquipmentCatalog(supabase: {
  from: (table: string) => QueryBuilder;
}): Promise<{ manufacturers: CatalogManufacturer[]; models: CatalogModel[] }> {
  try {
    const mfrRes = await fetchAllPages<any>((from, to) =>
      supabase.from('manufacturers').select('*').order('name').range(from, to)
    );
    const modelRes = await fetchAllPages<any>((from, to) =>
      supabase.from('laser_models').select('*').order('name').range(from, to)
    );
    if (mfrRes.error) console.warn('manufacturers catalog', mfrRes.error);
    if (modelRes.error) console.warn('laser_models catalog', modelRes.error);
    return {
      manufacturers: (mfrRes.data || [])
        .map(normalizeManufacturerRow)
        .filter((m) => m.name),
      models: (modelRes.data || [])
        .map(normalizeModelRow)
        .filter((m) => m.name || m.label),
    };
  } catch (e) {
    console.warn('equipment catalog load failed; using static fallback', e);
    return { manufacturers: [], models: [] };
  }
}
