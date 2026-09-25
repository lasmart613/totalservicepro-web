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
  [
    'AMS / Laserscope',
    'AMS',
    'American Medical Systems',
    'A.M.S.',
    'A.M.S',
    'Laserscope',
    'LaserScope',
    'Laserscope/LaserScope',
    'LaserScope/Laserscope',
    'AMS / LaserScope',
    'AMS/Laserscope',
  ],
  [
    'Lumenis (Coherent)',
    'Lumenis',
    'Coherent',
    'Coherent / Lumenis',
    'Lumenis / Coherent',
    'Coherent/Lumenis',
    'Lumenis/Coherent',
  ],
];

/** Always show this label once any alias in the group is present. */
const FORCE_MANUFACTURER_LABEL = new Set(['AMS / Laserscope', 'Lumenis (Coherent)']);

/**
 * Display labels keyed by modelDedupeKey. Option values stay a stored spelling.
 * Unknown alphanumeric codes stay uppercase (see formatModelToken).
 */
const MODEL_DISPLAY: Record<string, string> = {
  co2re: 'CO2RE',
  gentlemax: 'GentleMax',
  vbeam2: 'Vbeam 2',
  coolglide: 'CoolGlide',
  vpyag: 'VP YAG',
  p100h: 'P100H',
  p30h: 'P30H',
  yc1600: 'YC-1600',
  pl003: 'PL003',
  alexlazr: 'AlexLAZR',
  cbeam: 'C-beam',
  sclero: 'ScleroPLUS',
  smoothbeam: 'SmoothBeam',
  bmbq810: 'BMBQ-810',
  fels25a: 'FELS-25A',
  visulasyagiii: 'Visulas YAG III',
  harmonyxl: 'Harmony XL',
  optimisii: 'Optimis II',
  sm079: 'SM079',
  '9900': '9900',
  auraxp15wktp: 'Aura XP (15W KTP)',
};

const MODEL_WORD_CASE: Record<string, string> = {
  gentlemax: 'GentleMax',
  coolglide: 'CoolGlide',
  lightsheer: 'LightSheer',
  greenlight: 'GreenLight',
  versapulse: 'VersaPulse',
  powersuite: 'PowerSuite',
  oculight: 'OcuLight',
  medlite: 'MedLite',
  smoothbeam: 'SmoothBeam',
  alexlazr: 'AlexLAZR',
};

const UPPER_MODEL_TOKENS = new Set([
  'ii',
  'iii',
  'iv',
  'vi',
  'vii',
  'viii',
  'ix',
  'xl',
  'xp',
  'yag',
  'ktp',
  'sl',
  'slx',
  'duet',
  'xps',
  'co2',
  'rf',
  'ipl',
  'nd',
  'er',
  'mpx',
]);

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
  return formatModelToken(token);
}

/**
 * Lowercase, strip punctuation, and drop trailing rev / slash-roman noise.
 * A trailing "+" stays in the key so Excel V+ and Elite+ do not collapse
 * into Excel V and Elite.
 */
export function modelDedupeKey(value: string): string {
  let s = String(value || '').toLowerCase();
  s = s.replace(/\b(?:rev(?:ision)?|ver(?:sion)?)\.?\s*[a-z0-9]+\b/g, ' ');
  s = s.replace(/\/\s*(?:[ivx]{1,4}|[a-z])\b/g, ' ');
  return s.replace(/[^a-z0-9+]+/g, '');
}

function isSpecSuffix(extra: string): boolean {
  return /^\d+w(?:ktp|yag|nd|nm|diode)?$/.test(extra);
}

function formatModelToken(token: string): string {
  const key = token.toLowerCase();
  if (MODEL_WORD_CASE[key]) return MODEL_WORD_CASE[key];
  if (UPPER_MODEL_TOKENS.has(key)) return key.toUpperCase();
  if (/^[ivx]+$/i.test(token) && token.length <= 4) return token.toUpperCase();
  if (/\d/.test(token) && /[a-z]/i.test(token) && token.replace(/\d/g, '').length <= 6) {
    return token.toUpperCase();
  }
  if (/\d/.test(token) && !/[a-z]/i.test(token)) return token;
  if (/[a-z]/.test(token) && /[A-Z]/.test(token.slice(1))) return token;
  if (!token) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function formatModelLabel(raw: string): string {
  const parts = String(raw || '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!parts.length) return String(raw || '').trim();
  return parts.map(formatModelToken).join(' ');
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
  const mapped = MODEL_DISPLAY[modelDedupeKey(raw)];
  if (mapped) return mapped;
  if (looksLikeInternalCode(raw) || /[_-]/.test(raw)) {
    return raw.split(/[_-]+/).filter(Boolean).map(formatModelToken).join(' ');
  }
  if (/[A-Z]/.test(raw) && !/[_-]/.test(raw) && humanCasingScore(raw) > 1 && !/\s/.test(raw)) return raw;
  if (raw === raw.toLowerCase() && /^[a-z0-9]+$/.test(raw)) return humanizeCompactFallback(raw);
  return formatModelLabel(raw);
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
  const raw = String(value || '').trim();
  const mapped = MODEL_DISPLAY[modelDedupeKey(raw)] || (display ? MODEL_DISPLAY[modelDedupeKey(display)] : undefined);
  if (mapped) return mapped;
  if (display && !isCompactModelCode(display) && !looksLikeInternalCode(display)) {
    if (/[()/]/.test(display)) return display;
    return humanizeModelCode(display);
  }
  return humanizeModelCode(raw || display);
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
    const present = names.filter((n) => group.some((entry) => norm(entry) === norm(n)));
    if (!present.length) continue;
    if (FORCE_MANUFACTURER_LABEL.has(group[0])) return group[0];
    for (const canonical of group) {
      const hit = present.find((n) => norm(n) === norm(canonical));
      if (hit) return hit;
    }
    return present[0];
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
  return modelDedupeKey(value);
}

function hasRevisionNoise(value: string): boolean {
  return /\brev(?:ision)?\b|\s\/\s*[ivx]+\b/i.test(value);
}

function hasWattageSpec(value: string): boolean {
  return /\d+\s*w\b/i.test(value);
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
  if (hasWattageSpec(current) !== hasWattageSpec(next)) return hasWattageSpec(next) ? next : current;
  return humanCasingScore(next) > humanCasingScore(current) ? next : current;
}

function prettyModelLabel(value: string): string {
  if (/[()/]/.test(value)) return value;
  return humanizeModelCode(value);
}

function preferDisplayLabel(current: string, next: string): string {
  if (hasRevisionNoise(current) !== hasRevisionNoise(next)) return hasRevisionNoise(current) ? next : current;
  const currentPretty = prettyModelLabel(current);
  const nextPretty = prettyModelLabel(next);
  const currentCode = isCompactModelCode(currentPretty) || looksLikeInternalCode(currentPretty);
  const nextCode = isCompactModelCode(nextPretty) || looksLikeInternalCode(nextPretty);
  if (currentCode !== nextCode) return currentCode ? nextPretty : currentPretty;
  return humanCasingScore(nextPretty) > humanCasingScore(currentPretty) ? nextPretty : currentPretty;
}

function mergeModelChoice(prev: CatalogChoice, next: CatalogChoice): CatalogChoice {
  const value = preferModelValue(prev.value, next.value);
  const label = preferDisplayLabel(prev.label || prev.value, next.label || next.value);
  const mapped =
    MODEL_DISPLAY[modelDedupeKey(next.value)] ||
    MODEL_DISPLAY[modelDedupeKey(prev.value)] ||
    MODEL_DISPLAY[modelDedupeKey(label)];
  return { value, label: mapped || label };
}

/**
 * Shared model option builder. Values stay a stored spelling; labels are display-only.
 * Used by New Service Call and ticket edit.
 */
export function dedupeModelChoices(choices: CatalogChoice[]): CatalogChoice[] {
  const byKey = new Map<string, CatalogChoice>();
  for (const choice of choices) {
    const value = String(choice.value || '').trim();
    if (!value) continue;
    const key = modelChoiceKey(value);
    const label = catalogChoiceLabel(value, choice.label);
    const prev = byKey.get(key);
    byKey.set(key, prev ? mergeModelChoice(prev, { value, label }) : { value, label });
  }
  const keys = Array.from(byKey.keys()).sort((a, b) => a.length - b.length);
  for (const key of keys) {
    if (!byKey.has(key)) continue;
    for (const other of Array.from(byKey.keys())) {
      if (other === key || other.length <= key.length || !byKey.has(other)) continue;
      if (!other.startsWith(key) || !isSpecSuffix(other.slice(key.length))) continue;
      const base = byKey.get(key)!;
      const extra = byKey.get(other)!;
      byKey.set(key, mergeModelChoice(base, extra));
      byKey.delete(other);
    }
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

/** Select value for a stored model spelling that dedupe collapsed into another option. */
export function mergedModelOption(stored: string, options: CatalogChoice[]): string {
  const raw = String(stored || '').trim();
  if (!raw) return '';
  if (options.some((option) => option.value === raw)) return raw;
  const key = modelDedupeKey(raw);
  const hit = options.find((option) => {
    const optionKey = modelDedupeKey(option.value);
    if (optionKey === key) return true;
    const [short, long] = key.length <= optionKey.length ? [key, optionKey] : [optionKey, key];
    return long.startsWith(short) && isSpecSuffix(long.slice(short.length));
  });
  return hit?.value || raw;
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
  return listCatalogModelChoices(manufacturer, live).map((choice) => choice.value);
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
