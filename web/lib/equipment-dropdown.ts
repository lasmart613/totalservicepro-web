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
  ['Candela', 'candela', 'Syneron-Candela', 'Syneron Candela', 'Syneron'],
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
  ['DEKA', 'Deka', 'deka'],
  ['GE OEC', 'Ge Oec', 'GE/OEC', 'OEC'],
];

/** Always show this label once any alias in the group is present. */
const FORCE_MANUFACTURER_LABEL = new Set(['AMS / Laserscope', 'Lumenis (Coherent)', 'DEKA', 'GE OEC']);

/** Exact manufacturer option text, keyed by norm(). */
const MANUFACTURER_DISPLAY: Record<string, string> = {
  'ams / laserscope': 'AMS / Laserscope',
  'lumenis (coherent)': 'Lumenis (Coherent)',
  deka: 'DEKA',
  'ge oec': 'GE OEC',
  candela: 'Candela',
};

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
  p100h: 'Pulse 100H/50H',
  yc1600: 'YC-1600',
  pl003: 'PL003',
  alexlazr: 'AlexLAZR',
  cbeam: 'C-beam',
  sclero: 'ScleroPLUS',
  smoothbeam: 'SmoothBeam',
  bmbq810: 'BMBQ-810',
  fels25a: 'FELS-25A',
  fels25aog: 'FELS-25A',
  visulasyagiii: 'Visulas YAG III',
  harmonyxl: 'Harmony XL',
  optimisii: 'Optimis II',
  oec9900: 'OEC 9900',
  powersuiteholmium: 'PowerSuite 100W Holmium',
  powersuite100wholmium: 'PowerSuite 100W Holmium',
  acupulseduo: 'AcuPulse Duo CO₂',
  vbeamperfecta: 'VBeam Perfecta (Pulsed Dye)',
  vbeamperfectapulseddye: 'VBeam Perfecta (Pulsed Dye)',
  perfecta: 'VBeam Perfecta (Pulsed Dye)',
  h20: 'Medilas H20',
  h20medilasholmium: 'Medilas H20',
  medilash20: 'Medilas H20',
  h20h30: 'Medilas H20',
  h30: 'Medilas H30',
  h30medilasholmium: 'Medilas H30',
  medilash30: 'Medilas H30',
  ultrapulse5000: 'UltraPulse 5000',
  ultrapulseduo: 'UltraPulse Duo',
  auraxp15wktp: 'Aura XP (15W KTP)',
  gentlemaxpro7551064nm: 'GentleMax Pro (755/1064 nm)',
  'gentlemaxpro755+1064nm': 'GentleMax Pro (755/1064 nm)',
  picoway: 'PicoWay',
  picowaypicosecondlaser: 'PicoWay',
  'apogeeelite+eliteplus': 'Apogee Elite / Elite+',
  acupulseduoco: 'AcuPulse Duo CO₂',
  acupulseduoco2: 'AcuPulse Duo CO₂',
  inteliguideco25w: 'InteliGuide CO₂ 25W',
  inteliguideco225w: 'InteliGuide CO₂ 25W',
};

/** Opaque codes with no known product name. Hidden from pickers; stored values stay. */
const HIDDEN_PICKER_KEYS = new Set(['sm079', 'pl003', 'p30h', 'p120']);

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
  'et',
  'xc',
  'hps',
  'hr',
  'mgl',
  'si',
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
  s = s.replace(/\bpowersuite\s*revc\b/g, 'powersuite rev c');
  s = s.replace(/\b(?:rev(?:ision)?|ver(?:sion)?)\.?\s*[a-z0-9]+\b/g, ' ');
  s = s.replace(/\/\s*(?:[ivx]{1,4}|[a-z])\b/g, ' ');
  return s.replace(/[^a-z0-9+]+/g, '');
}

function polishModelLabel(label: string): string {
  return String(label || '').replace(/\bUltrapulse\b/g, 'UltraPulse');
}

/** Glued "Revc" is the Rev C manual, not a separate model name. */
function forcedModelSpelling(raw: string, display?: string | null): string | null {
  const blob = `${raw || ''} ${display || ''}`;
  if (/versapulse\s*powersuite\s*revc\b/i.test(blob) || /versapulse\s*powersuite\s*rev\s+c\b/i.test(blob)) {
    return 'VersaPulse PowerSuite Rev C';
  }
  return null;
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

/** Plain lowercase snake/kebab/word codes. Anything with capitals or symbols is already a name. */
function isPlainLowercaseCode(value: string): boolean {
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(String(value || '').trim());
}

/** Display text for a model code. Does not change the saved option value. */
export function humanizeModelCode(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const mapped = MODEL_DISPLAY[modelDedupeKey(raw)];
  if (mapped) return polishModelLabel(mapped);
  const forced = forcedModelSpelling(raw);
  if (forced) return forced;
  if (!isPlainLowercaseCode(raw)) return polishModelLabel(raw);
  if (looksLikeInternalCode(raw) || /[_-]/.test(raw)) {
    return polishModelLabel(raw.split(/[_-]+/).filter(Boolean).map(formatModelToken).join(' '));
  }
  return polishModelLabel(humanizeCompactFallback(raw));
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
  const forced = forcedModelSpelling(raw, display);
  if (forced) return forced;
  const mapped =
    (raw && MODEL_DISPLAY[modelDedupeKey(raw)]) ||
    (display && MODEL_DISPLAY[modelDedupeKey(display)]) ||
    '';
  if (mapped) return polishModelLabel(mapped);
  if (display && !isPlainLowercaseCode(display)) return polishModelLabel(display);
  return humanizeModelCode(raw || display);
}

/** Manufacturer option text. Curated names are shown exactly; only a lowercase code is title-cased. */
export function manufacturerChoiceLabel(value: string, explicit?: string | null): string {
  const raw = String(value || '').trim();
  const display = String(explicit || '').trim();
  const mapped =
    (raw && MANUFACTURER_DISPLAY[norm(raw)]) ||
    (display && MANUFACTURER_DISPLAY[norm(display)]) ||
    '';
  if (mapped) return mapped;
  if (display && !isPlainLowercaseCode(display)) return display;
  const source = display || raw;
  if (!source) return '';
  if (!isPlainLowercaseCode(source)) return source;
  if (looksLikeInternalCode(source) || /[_-]/.test(source)) {
    return source
      .split(/[_-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  return source.charAt(0).toUpperCase() + source.slice(1);
}

/**
 * Alias and loose-brand keys, built once. Comparing names must not rescan
 * EQUIPMENT_CATALOG or the alias groups for every model.
 */
const MANUFACTURER_ALIAS_NORM = new Map<string, string>();
const MANUFACTURER_LOOSE_KEY = new Map<string, string>();
const manufacturerKeyCache = new Map<string, string>();
let manufacturerAliasMapReady = false;
let manufacturerNormalizeCalls = 0;

export function manufacturerNormalizeCount(): number {
  return manufacturerNormalizeCalls;
}

export function resetManufacturerNormalizeCount(): void {
  manufacturerNormalizeCalls = 0;
}

function ensureManufacturerAliasMap(): void {
  if (manufacturerAliasMapReady) return;
  manufacturerAliasMapReady = true;
  const add = (alias: string, key: string) => {
    const n = norm(alias);
    if (n && !MANUFACTURER_ALIAS_NORM.has(n)) MANUFACTURER_ALIAS_NORM.set(n, key);
  };
  for (const group of MANUFACTURER_ALIAS_GROUPS) {
    const key = norm(group[0]);
    for (const alias of group) add(alias, key);
    const loose = looseBrandKey(group[0]);
    if (loose && !MANUFACTURER_LOOSE_KEY.has(loose)) MANUFACTURER_LOOSE_KEY.set(loose, key);
  }
  for (const row of EQUIPMENT_CATALOG) {
    const names = [row.name, ...(row.aliases || [])];
    const key = MANUFACTURER_ALIAS_NORM.get(norm(row.name)) || norm(row.name);
    for (const alias of names) add(alias, key);
    const loose = looseBrandKey(row.name);
    if (loose && !MANUFACTURER_LOOSE_KEY.has(loose)) MANUFACTURER_LOOSE_KEY.set(loose, key);
  }
}

function computeManufacturerKey(name: string): string {
  ensureManufacturerAliasMap();
  const n = norm(name);
  const direct = MANUFACTURER_ALIAS_NORM.get(n);
  if (direct) return direct;
  const loose = looseBrandKey(name);
  if (loose) {
    const viaLoose = MANUFACTURER_LOOSE_KEY.get(loose);
    if (viaLoose) return viaLoose;
    return loose;
  }
  return n;
}

/** Group key for a manufacturer spelling. Counted so tests can see per-model scans. */
export function normalizeManufacturerKey(name: string): string {
  const raw = String(name || '').trim();
  if (!raw) return '';
  manufacturerNormalizeCalls += 1;
  const n = norm(raw);
  const hit = manufacturerKeyCache.get(n);
  if (hit) return hit;
  const key = computeManufacturerKey(raw);
  manufacturerKeyCache.set(n, key);
  return key;
}

function cachedManufacturerKey(name: string): string | undefined {
  const raw = String(name || '').trim();
  if (!raw) return undefined;
  return manufacturerKeyCache.get(norm(raw));
}

function rememberManufacturerKey(name: string): string {
  const cached = cachedManufacturerKey(name);
  if (cached) return cached;
  return normalizeManufacturerKey(name);
}

export function manufacturerNamesEqual(a: string, b: string): boolean {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return false;
  if (norm(left) === norm(right)) return true;
  if (normalizeManufacturerKey(left) === normalizeManufacturerKey(right)) return true;
  const compactLeft = compactManufacturerKey(left);
  const compactRight = compactManufacturerKey(right);
  if (compactLeft.length >= 4 && compactLeft === compactRight) return true;
  // "Coherent / Lumenis" still matches either side. A space-joined pair such as
  // "Syneron Candela" does not match Syneron or Candela unless they share an alias.
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

/**
 * Dropdown value may be manufacturers.id or a name. Return the stored name.
 */
export function manufacturerNameFromSelection(
  selected: string,
  manufacturers: CatalogManufacturer[] = []
): string {
  const sel = String(selected || '').trim();
  if (!sel) return '';
  const byId = manufacturers.find((m) => m.id != null && String(m.id) === sel);
  if (byId?.name) return byId.name;
  const byName = manufacturers.find((m) => m.name && manufacturerNamesEqual(m.name, sel));
  return byName?.name || sel;
}

function keyForSelection(selected: string, manufacturers: CatalogManufacturer[]): string {
  const sel = String(selected || '').trim();
  if (!sel) return '';
  const byId = manufacturers.find((m) => m.id != null && String(m.id) === sel);
  if (byId?.name) return rememberManufacturerKey(byId.name);
  return rememberManufacturerKey(sel);
}

export function modelBelongsToManufacturer(
  model: CatalogModel,
  selected: string,
  manufacturers: CatalogManufacturer[] = []
): boolean {
  const sel = String(selected || '').trim();
  if (!sel || !model) return false;
  const selKey = keyForSelection(sel, manufacturers);
  if (!selKey) return false;

  const text = String(model.manufacturer || '').trim();
  if (text) {
    // A Candela label stays Candela even when manufacturer_id is stale.
    return rememberManufacturerKey(text) === selKey;
  }

  if (model.manufacturer_id != null && String(model.manufacturer_id) === sel) return true;
  const owner = manufacturers.find(
    (m) => m.id != null && model.manufacturer_id != null && String(m.id) === String(model.manufacturer_id)
  );
  return Boolean(owner?.name && rememberManufacturerKey(owner.name) === selKey);
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

let cachedStaticManufacturers: CatalogManufacturer[] | null = null;
let cachedStaticModels: CatalogModel[] | null = null;

export function staticManufacturerRows(): CatalogManufacturer[] {
  if (cachedStaticManufacturers) return cachedStaticManufacturers;
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
  cachedStaticManufacturers = Array.from(names)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ id: null, name }));
  return cachedStaticManufacturers;
}

export function staticModelRows(): CatalogModel[] {
  if (cachedStaticModels) return cachedStaticModels;
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
  cachedStaticModels = out;
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
  const forced =
    forcedModelSpelling(prev.value, prev.label) || forcedModelSpelling(next.value, next.label);
  const label = preferDisplayLabel(prev.label || prev.value, next.label || next.value);
  const mapped =
    MODEL_DISPLAY[modelDedupeKey(next.value)] ||
    MODEL_DISPLAY[modelDedupeKey(prev.value)] ||
    MODEL_DISPLAY[modelDedupeKey(label)];
  return { value, label: polishModelLabel(forced || mapped || label) };
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
    if (HIDDEN_PICKER_KEYS.has(key)) continue;
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
  const curatedOwner = new Map<string, string>();
  for (const key of Array.from(byKey.keys())) {
    const curated = MODEL_DISPLAY[key];
    if (!curated) continue;
    const prevKey = curatedOwner.get(curated);
    if (!prevKey || !byKey.has(prevKey)) {
      curatedOwner.set(curated, key);
      continue;
    }
    byKey.set(prevKey, mergeModelChoice(byKey.get(prevKey)!, byKey.get(key)!));
    byKey.delete(key);
  }
  const waveKeys = ['gentlemaxpro7551064nm', 'gentlemaxpro755+1064nm'].filter((key) => byKey.has(key));
  if (waveKeys.length && byKey.has('gentlemaxpro')) {
    let owner = waveKeys[0];
    for (const key of waveKeys.slice(1)) {
      byKey.set(owner, mergeModelChoice(byKey.get(owner)!, byKey.get(key)!));
      byKey.delete(key);
    }
    const merged = mergeModelChoice(byKey.get('gentlemaxpro')!, byKey.get(owner)!);
    byKey.set(owner, { ...merged, label: 'GentleMax Pro (755/1064 nm)' });
    byKey.delete('gentlemaxpro');
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

/**
 * Keep a ticket's saved model on the picker only while its own manufacturer
 * is selected. Other brands must not inherit that model.
 */
export function withSavedModelChoice(
  choices: CatalogChoice[],
  savedModel: string,
  selectedMake: string,
  savedMake: string
): CatalogChoice[] {
  const selected = String(selectedMake || '').trim();
  const saved = String(savedMake || '').trim();
  if (!savedModel || !saved || !selected || !manufacturerNamesEqual(selected, saved)) return choices;
  const value = mergedModelOption(savedModel, choices);
  if (!value || choices.some((option) => option.value === value)) return choices;
  const label =
    manufacturerNamesEqual(selected, 'GE OEC') && modelDedupeKey(value) === '9900'
      ? 'OEC 9900'
      : catalogChoiceLabel(value);
  return [...choices, { value, label }];
}

/**
 * Keep a ticket's saved manufacturer on the picker when every model under
 * that name is hidden. Other empty brands stay off the list.
 */
export function withSavedManufacturerChoice(choices: CatalogChoice[], savedMake: string): CatalogChoice[] {
  const saved = String(savedMake || '').trim();
  if (!saved) return choices;
  if (choices.some((option) => option.value === saved || manufacturerNamesEqual(option.value, saved))) {
    return choices;
  }
  return [...choices, { value: saved, label: manufacturerChoiceLabel(saved) }];
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

const NO_MANUFACTURERS: CatalogManufacturer[] = [];
const NO_MODELS: CatalogModel[] = [];

type ManufacturerModelIndex = {
  modelsByKey: Map<string, CatalogModel[]>;
  idToKey: Map<string, string>;
  canonicalByKey: Map<string, string>;
  staticKeys: Set<string>;
  selectionKey(selected: string): string;
};

const manufacturerIndexCache = new WeakMap<
  readonly CatalogManufacturer[],
  WeakMap<readonly CatalogModel[], ManufacturerModelIndex>
>();

/** Letters and digits only, so "In Mode" and "InMode" share a key. */
function compactManufacturerKey(value: string): string {
  return norm(value).replace(/[^a-z0-9]+/g, '');
}

/**
 * Stored manufacturers-table spelling for one alias group.
 * A forced dropdown label ("Lumenis (Coherent)", "AMS / Laserscope") is not a
 * stored name. "Alma Lasers" still wins over the short row "Alma".
 */
function storedAliasSpelling(group: string[], stored: string[]): string {
  const forced = FORCE_MANUFACTURER_LABEL.has(group[0]) ? norm(group[0]) : '';
  const withoutDisplay = forced ? stored.filter((n) => norm(n) !== forced) : stored;
  const pool = withoutDisplay.length ? withoutDisplay : stored;
  let preferred = pool[0];
  for (const entry of group) {
    const hit = pool.find((n) => norm(n) === norm(entry));
    if (hit) {
      preferred = hit;
      break;
    }
  }
  const longer = pool.filter(
    (n) => n.length > preferred.length && norm(n).startsWith(norm(preferred))
  );
  if (!longer.length) return preferred;
  longer.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return longer[0];
}

/**
 * Among live catalog spellings, keep the stored name. "Alma Lasers" wins over
 * the short static label "Alma" when that longer catalog name is present.
 * Dropdown labels that are not manufacturers rows are never returned.
 */
function catalogSaveSpelling(names: string[]): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const n = norm(name);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    unique.push(name);
  }
  if (!unique.length) return '';
  if (unique.length === 1) return unique[0];
  for (const group of MANUFACTURER_ALIAS_GROUPS) {
    const inGroup = unique.filter((n) => group.some((entry) => norm(entry) === norm(n)));
    if (!inGroup.length) continue;
    return storedAliasSpelling(group, inGroup);
  }
  return preferCanonicalManufacturer(unique);
}

/**
 * One manufacturers row whose spelling matches aside from spaces and punctuation.
 * Ambiguous hits stay unresolved so a display name is not guessed.
 */
function compactStoredManufacturer(
  selected: string,
  manufacturers: readonly CatalogManufacturer[]
): string {
  const compact = compactManufacturerKey(selected);
  if (compact.length < 4) return '';
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const row of manufacturers) {
    const name = String(row?.name || '').trim();
    const key = norm(name);
    if (!name || seen.has(key) || compactManufacturerKey(name) !== compact) continue;
    seen.add(key);
    hits.push(name);
  }
  if (hits.length !== 1) return '';
  return hits[0];
}

function liveCatalogRefs(live?: LiveCatalog): {
  manufacturers: readonly CatalogManufacturer[];
  models: readonly CatalogModel[];
} {
  return {
    manufacturers: live?.manufacturers?.length ? live.manufacturers : NO_MANUFACTURERS,
    models: live?.models?.length ? live.models : NO_MODELS,
  };
}

function buildManufacturerModelIndex(
  manufacturers: readonly CatalogManufacturer[],
  models: readonly CatalogModel[]
): ManufacturerModelIndex {
  const idToKey = new Map<string, string>();
  const namesByKey = new Map<string, string[]>();
  const staticKeys = new Set<string>();
  const remember = (name: string) => rememberManufacturerKey(name);

  for (const row of manufacturers) {
    if (!row?.name) continue;
    const key = remember(row.name);
    const list = namesByKey.get(key);
    if (list) list.push(row.name);
    else namesByKey.set(key, [row.name]);
    if (row.id != null) idToKey.set(String(row.id), key);
  }
  for (const row of staticManufacturerRows()) {
    if (!row.name) continue;
    staticKeys.add(remember(row.name));
  }

  const texts = new Set<string>();
  const allModels = [...staticModelRows(), ...models];
  for (const model of allModels) {
    const text = String(model.manufacturer || '').trim();
    if (text) texts.add(text);
  }
  for (const text of texts) remember(text);

  const modelsByKey = new Map<string, CatalogModel[]>();
  const push = (key: string | undefined, model: CatalogModel) => {
    if (!key) return;
    const list = modelsByKey.get(key);
    if (list) list.push(model);
    else modelsByKey.set(key, [model]);
  };
  for (const model of allModels) {
    const text = String(model.manufacturer || '').trim();
    if (text) {
      push(cachedManufacturerKey(text), model);
      continue;
    }
    if (model.manufacturer_id != null) push(idToKey.get(String(model.manufacturer_id)), model);
  }

  const canonicalByKey = new Map<string, string>();
  for (const [key, groupNames] of namesByKey) {
    const spelling = catalogSaveSpelling(groupNames);
    if (spelling) canonicalByKey.set(key, spelling);
  }

  return {
    modelsByKey,
    idToKey,
    canonicalByKey,
    staticKeys,
    selectionKey(selected: string) {
      const sel = String(selected || '').trim();
      if (!sel) return '';
      const byId = idToKey.get(sel);
      if (byId) return byId;
      const cached = cachedManufacturerKey(sel);
      if (cached) return cached;
      return rememberManufacturerKey(sel);
    },
  };
}

function manufacturerModelIndex(
  manufacturers: readonly CatalogManufacturer[],
  models: readonly CatalogModel[]
): ManufacturerModelIndex {
  let inner = manufacturerIndexCache.get(manufacturers);
  if (!inner) {
    inner = new WeakMap();
    manufacturerIndexCache.set(manufacturers, inner);
  }
  const hit = inner.get(models);
  if (hit) return hit;
  const built = buildManufacturerModelIndex(manufacturers, models);
  inner.set(models, built);
  return built;
}

function bucketHasVisibleModel(models: CatalogModel[] | undefined): boolean {
  if (!models?.length) return false;
  return models.some((model) => {
    const value = String(model.label || model.name || '').trim();
    if (!value) return false;
    return !HIDDEN_PICKER_KEYS.has(modelDedupeKey(value));
  });
}

function choicesForModels(models: CatalogModel[]): CatalogChoice[] {
  const choices: CatalogChoice[] = [];
  for (const model of models) {
    const value = model.label || model.name;
    if (!value) continue;
    choices.push({ value, label: model.display || catalogChoiceLabel(value) });
  }
  return dedupeModelChoices(choices);
}

export function listCatalogManufacturers(live?: LiveCatalog): string[] {
  const names: string[] = [];
  staticManufacturerRows().forEach((m) => {
    if (m.name) names.push(m.name);
  });
  (live?.manufacturers || []).forEach((m) => {
    if (m?.name) names.push(m.name);
  });
  const collapsed = collapseManufacturerNames(names);
  const { manufacturers, models } = liveCatalogRefs(live);
  const index = manufacturerModelIndex(manufacturers, models);
  return collapsed.filter((name) => {
    const key = index.selectionKey(name);
    if (bucketHasVisibleModel(index.modelsByKey.get(key))) return true;
    if (FORCE_MANUFACTURER_LABEL.has(name) || MANUFACTURER_DISPLAY[norm(name)]) return true;
    return index.staticKeys.has(key);
  });
}

function collapseOec9900(choices: CatalogChoice[]): CatalogChoice[] {
  const rest: CatalogChoice[] = [];
  let oec: CatalogChoice | null = null;
  for (const choice of choices) {
    const key = modelDedupeKey(choice.value);
    const labelKey = modelDedupeKey(choice.label);
    if (key === '9900' || key === 'oec9900' || labelKey === '9900' || labelKey === 'oec9900') {
      const next = { ...choice, label: 'OEC 9900' };
      oec = oec ? { ...mergeModelChoice(oec, next), label: 'OEC 9900' } : next;
    } else {
      rest.push(choice);
    }
  }
  const merged = oec ? [...rest, oec] : rest;
  return merged.sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

export function listCatalogManufacturerChoices(live?: LiveCatalog): CatalogChoice[] {
  const rows = live?.manufacturers || [];
  const { manufacturers, models } = liveCatalogRefs(live);
  const index = manufacturerModelIndex(manufacturers, models);
  return listCatalogManufacturers(live).map((value) => {
    const key = index.selectionKey(value);
    const row = rows.find((r) => r.name && index.selectionKey(r.name) === key);
    return { value, label: manufacturerChoiceLabel(value, row?.label) };
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
  const { manufacturers, models } = liveCatalogRefs(live);
  const index = manufacturerModelIndex(manufacturers, models);
  const key = index.selectionKey(manufacturer);
  const bucket = index.modelsByKey.get(key) || [];
  const filtered = live?.equipmentType
    ? bucket.filter((model) => modelMatchesEquipmentType(model.equipment_type, live.equipmentType))
    : bucket;
  const deduped = choicesForModels(filtered);
  const geKey = cachedManufacturerKey('GE OEC');
  if (geKey && key === geKey) return collapseOec9900(deduped);
  return deduped;
}

/**
 * Saved manufacturer spelling from the loaded catalog.
 * Dropdown labels map to a manufacturers-table row: "Alma" stores "Alma Lasers",
 * "Lumenis (Coherent)" stores "Lumenis", "AMS / Laserscope" stores whichever
 * alias row exists. A name with no stored equivalent, including "Other", is kept.
 */
export function canonicalManufacturerSpelling(
  selected: string,
  manufacturers: CatalogManufacturer[] = [],
  models: CatalogModel[] = []
): string {
  const sel = String(selected || '').trim();
  if (!sel) return '';
  const { manufacturers: mfrs, models: mods } = liveCatalogRefs({ manufacturers, models });
  const index = manufacturerModelIndex(mfrs, mods);
  const key = index.selectionKey(sel);
  return index.canonicalByKey.get(key) || compactStoredManufacturer(sel, mfrs) || sel;
}

/**
 * Report-form model list for the selected manufacturer (id or name).
 * Uses the memoized manufacturer→model map. Alias rows share a list.
 */
export function modelsForReportManufacturer(
  selected: string,
  manufacturers: CatalogManufacturer[] = [],
  models: CatalogModel[] = [],
  equipmentType?: string | null
): CatalogChoice[] {
  if (!String(selected || '').trim()) return [];
  return listCatalogModelChoices(selected, { manufacturers, models, equipmentType });
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
