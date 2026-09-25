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
  /** Stored manufacturer value (may be an internal code). */
  name: string;
  /** display_name / label from the row, when the table has one. */
  label?: string;
};

export type CatalogModel = {
  id?: string | number | null;
  /** Raw model name from the row. */
  name: string;
  /** Value saved by the dropdown today: explicit label, otherwise name. */
  label: string;
  /** Human option text. Codes stay in `label` / `name` for the saved value. */
  display?: string;
  manufacturer_id?: string | number | null;
  manufacturer?: string | null;
  equipment_type?: string | null;
};

export type CatalogChoice = {
  value: string;
  label: string;
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

/** Suffixes that do not make a second brand. "Alma Lasers" is still Alma. */
const GENERIC_BRAND_TOKENS = new Set([
  'laser',
  'lasers',
  'system',
  'systems',
  'medical',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'llc',
  'co',
  'company',
  'aesthetics',
  'aesthetic',
]);

/**
 * One displayed manufacturer for obvious spelling variants.
 * First entry is the preferred label when that exact string is in the list.
 */
const MANUFACTURER_ALIAS_GROUPS: string[][] = [
  ['Alma', 'Alma Lasers', 'Alma Laser'],
  [
    'HOYA ConBio',
    'Hoya ConBio',
    'ConBio / Hoya',
    'Hoya / ConBio',
    'ConBio',
    'Hoya',
    'Conbio',
    'Con-Bio',
    'Con Bio',
    'CON-BIO',
    'HOYA Con-Bio',
    'Hoya Con-Bio',
    'HOYA Con Bio',
    'Hoya Con Bio',
    'HOYA-ConBio',
    'Hoya-ConBio',
    'ConBio / HOYA',
    'HOYA / ConBio',
  ],
  ['Quanta System', 'Quanta', 'QuantaSystem'],
  ['American Medical Systems', 'AMS', 'A.M.S.', 'A.M.S'],
];

/** Compact model codes with no underscore or hyphen. Display only — values stay raw. */
const COMPACT_MODEL_LABELS: Record<string, string> = {
  co2re: 'CO2RE',
  gentlemax: 'GentleMax',
  vbeam2: 'Vbeam 2',
  coolglide: 'CoolGlide',
  vpyag: 'VP YAG',
  p100h: 'P100H',
  p30h: 'P30H',
  yc1600: 'YC-1600',
  pl003: 'PL003',
};

function looseBrandKey(value: string): string {
  return tokens(value)
    .filter((t) => !GENERIC_BRAND_TOKENS.has(t))
    .sort()
    .join(' ');
}

/** Snake/kebab internal codes such as alex_trivantage. Ordinary names are left alone. */
export function looksLikeInternalCode(value: string): boolean {
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(String(value || '').trim());
}

function compactModelKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/** All-lowercase code with no spaces, such as coolglide or alex_trivantage. */
export function isCompactModelCode(value: string): boolean {
  const raw = String(value || '').trim();
  if (!raw || /\s/.test(raw)) return false;
  if (looksLikeInternalCode(raw)) return true;
  if (raw !== raw.toLowerCase()) return false;
  return /^[a-z0-9]+$/.test(raw);
}

function humanizeModelToken(token: string): string {
  const key = token.toLowerCase();
  if (COMPACT_MODEL_LABELS[key]) return COMPACT_MODEL_LABELS[key];
  if (/\d/.test(token)) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function humanizeCompactFallback(raw: string): string {
  const parts = raw.match(/[a-z]+|\d+/gi);
  if (!parts || parts.length <= 1) {
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  const alpha = parts.filter((part) => /[a-z]/i.test(part));
  if (/\d/.test(raw) && alpha.every((part) => part.length <= 3)) return raw.toUpperCase();
  return parts
    .map((part) => (/\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join(' ');
}

/** Display text for a model code. Does not change the saved option value. */
export function humanizeModelCode(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const mapped = COMPACT_MODEL_LABELS[compactModelKey(raw)];
  if (mapped && !/\s/.test(raw)) return mapped;
  if (looksLikeInternalCode(raw) || /[_-]/.test(raw)) {
    return raw.split(/[_-]+/).filter(Boolean).map(humanizeModelToken).join(' ');
  }
  if (raw === raw.toLowerCase() && /^[a-z0-9]+$/.test(raw)) return humanizeCompactFallback(raw);
  return raw;
}

export function titleCaseInternalCode(value: string): string {
  return humanizeModelCode(value);
}

/**
 * Visible option text. Prefers a human display/name field, otherwise humanizes
 * an internal or compact model code. The saved option value is separate.
 */
export function catalogChoiceLabel(value: string, explicit?: string | null): string {
  const display = String(explicit || '').trim();
  if (display && !isCompactModelCode(display)) return display;
  const raw = String(value || '').trim();
  const source = (display && isCompactModelCode(display) ? display : raw) || display;
  if (!source) return '';
  if (isCompactModelCode(source) || looksLikeInternalCode(source)) return humanizeModelCode(source);
  return source;
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
  for (const group of MANUFACTURER_ALIAS_GROUPS) {
    if (group.some((alias) => norm(alias) === norm(n))) {
      group.forEach((alias) => keys.add(norm(alias)));
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
  const looseLeft = looseBrandKey(left);
  const looseRight = looseBrandKey(right);
  // "Alma" / "Alma Lasers" and "Quanta" / "Quanta System".
  if (looseLeft && looseLeft === looseRight) return true;
  // "Coherent / Lumenis" still matches either side. A space-joined pair such as
  // "Syneron Candela" does not match Syneron or Candela.
  if (left.includes('/') || right.includes('/')) {
    const ta = tokens(left);
    const tb = tokens(right);
    if (ta.length && tb.length) {
      const [smaller, larger] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
      if (smaller.every((t) => larger.includes(t))) return true;
    }
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

  const text = String(model.manufacturer || '').trim();
  if (text && !manufacturerNamesEqual(sel, text)) {
    const selectedNames = manufacturers.filter((m) => manufacturerMatches(sel, m));
    const textMatchesSelection = selectedNames.some(
      (m) => m.name && manufacturerNamesEqual(m.name, text)
    );
    if (!textMatchesSelection) return false;
  }

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

  if (text && manufacturerNamesEqual(sel, text)) return true;

  return matched.some((m) => m.name && text && manufacturerNamesEqual(m.name, text));
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
  const name = String(row?.name || row?.manufacturer_name || row?.manufacturer || '').trim();
  const explicit = String(row?.display_name || row?.display || row?.label || row?.title || '').trim();
  return {
    id: row?.id ?? row?.manufacturer_id ?? null,
    name,
    label: explicit,
  };
}

export function normalizeModelRow(row: any): CatalogModel {
  const name = String(row?.name || row?.model_name || row?.model || '').trim();
  const columnLabel = String(row?.label || '').trim();
  const displayField = String(row?.display_name || row?.display || row?.title || '').trim();
  const saved = columnLabel || name;
  return {
    id: row?.id ?? null,
    name,
    label: saved,
    display: catalogChoiceLabel(saved, displayField || columnLabel),
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

function preferCanonicalManufacturer(names: string[]): string {
  for (const group of MANUFACTURER_ALIAS_GROUPS) {
    for (const canonical of group) {
      const hit = names.find((n) => norm(n) === norm(canonical));
      if (hit) return hit;
    }
  }
  const human = names.filter((n) => !looksLikeInternalCode(n));
  const pool = human.length ? human : names;
  return pool.slice().sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

function spellingVariant(a: string, b: string): boolean {
  if (norm(a) === norm(b)) return true;
  const group = MANUFACTURER_ALIAS_GROUPS.find((g) => g.some((entry) => norm(entry) === norm(a)));
  if (group && group.some((entry) => norm(entry) === norm(b))) return true;
  const left = looseBrandKey(a);
  const right = looseBrandKey(b);
  // "Quanta" / "Quanta System", "Alma" / "Alma Lasers".
  return Boolean(left && left === right);
}

function modelChoiceKey(value: string): string {
  return norm(value).replace(/\s+/g, ' ');
}

/** GentleMax beats Gentlemax: count capitals that are not the start of a word. */
function humanCasingScore(value: string): number {
  const raw = value.trim();
  let n = raw !== raw.toLowerCase() ? 1 : 0;
  for (let i = 1; i < raw.length; i++) {
    if (/[A-Z]/.test(raw[i]) && /[a-z0-9]/.test(raw[i - 1])) n += 2;
  }
  return n;
}

function preferModelValue(current: string, next: string): string {
  const currentCode = isCompactModelCode(current);
  const nextCode = isCompactModelCode(next);
  if (currentCode !== nextCode) return currentCode ? current : next;
  return humanCasingScore(next) > humanCasingScore(current) ? next : current;
}

function preferDisplayLabel(current: string, next: string): string {
  const currentCode = isCompactModelCode(current) || looksLikeInternalCode(current);
  const nextCode = isCompactModelCode(next) || looksLikeInternalCode(next);
  if (currentCode !== nextCode) return currentCode ? next : current;
  return humanCasingScore(next) > humanCasingScore(current) ? next : current;
}

/** Case-insensitive model collapse. Option values stay a saved code or name. */
export function dedupeModelChoices(choices: CatalogChoice[]): CatalogChoice[] {
  const byKey = new Map<string, CatalogChoice>();
  for (const choice of choices) {
    const value = String(choice.value || '').trim();
    if (!value) continue;
    const key = modelChoiceKey(value);
    const label = String(choice.label || '').trim() || catalogChoiceLabel(value);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { value, label });
      continue;
    }
    byKey.set(key, {
      value: preferModelValue(prev.value, value),
      label: preferDisplayLabel(prev.label, label),
    });
  }
  return Array.from(byKey.values()).sort(
    (a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value)
  );
}

/** Case- and alias-insensitive manufacturer collapse. Display names only. */
export function dedupeManufacturerNames(names: string[]): string[] {
  return collapseManufacturerNames(names);
}

/**
 * Select value for a stored manufacturer spelling.
 * Exact option wins. Otherwise the merged alias (Alma Lasers → Alma) so the
 * dropdown shows that option as selected.
 */
export function mergedManufacturerOption(stored: string, options: string[]): string {
  const raw = String(stored || '').trim();
  if (!raw) return '';
  if (options.some((name) => name === raw)) return raw;
  return options.find((name) => spellingVariant(name, raw)) || raw;
}

function collapseManufacturerNames(names: string[]): string[] {
  const groups: string[][] = [];
  for (const name of names) {
    if (!name) continue;
    const found = groups.find((group) => group.some((existing) => spellingVariant(existing, name)));
    if (found) {
      if (!found.some((existing) => norm(existing) === norm(name))) found.push(name);
    } else {
      groups.push([name]);
    }
  }
  return groups
    .map((group) => preferCanonicalManufacturer(group))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function listCatalogManufacturers(live?: LiveCatalog): string[] {
  const names: string[] = [];
  staticManufacturerRows().forEach((m) => {
    if (m.name) names.push(m.name);
  });
  (live?.manufacturers || []).forEach((m) => {
    if (m?.name) names.push(m.name);
  });
  return collapseManufacturerNames(names);
}

export function listCatalogManufacturerChoices(live?: LiveCatalog): CatalogChoice[] {
  const rows = live?.manufacturers || [];
  return listCatalogManufacturers(live).map((value) => {
    const row = rows.find((r) => r.name && manufacturerNamesEqual(r.name, value));
    return { value, label: catalogChoiceLabel(value, row?.label) };
  });
}

export function listCatalogModels(
  manufacturer: string,
  live?: LiveCatalog & { equipmentType?: string | null | EquipmentType }
): string[] {
  if (!manufacturer || manufacturer === '__other__') return [];
  const manufacturers = [...staticManufacturerRows(), ...(live?.manufacturers || [])];
  const models = [...staticModelRows(), ...(live?.models || [])];
  const byKey = new Map<string, string>();
  for (const model of models) {
    if (!modelBelongsToManufacturer(model, manufacturer, manufacturers)) continue;
    if (!modelMatchesEquipmentType(model.equipment_type, live?.equipmentType)) continue;
    const label = model.label || model.name;
    if (!label) continue;
    const key = modelChoiceKey(label);
    const prev = byKey.get(key);
    byKey.set(key, prev ? preferModelValue(prev, label) : label);
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
}

export function listCatalogModelChoices(
  manufacturer: string,
  live?: LiveCatalog & { equipmentType?: string | null | EquipmentType }
): CatalogChoice[] {
  if (!manufacturer || manufacturer === '__other__') return [];
  const manufacturers = [...staticManufacturerRows(), ...(live?.manufacturers || [])];
  const models = [...staticModelRows(), ...(live?.models || [])];
  const choices: CatalogChoice[] = [];
  for (const model of models) {
    if (!modelBelongsToManufacturer(model, manufacturer, manufacturers)) continue;
    if (!modelMatchesEquipmentType(model.equipment_type, live?.equipmentType)) continue;
    const value = model.label || model.name;
    if (!value) continue;
    const label = model.display || catalogChoiceLabel(value);
    choices.push({ value, label });
  }
  return dedupeModelChoices(choices);
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
