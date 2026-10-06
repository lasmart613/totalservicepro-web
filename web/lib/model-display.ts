/**
 * Display names for stored equipment model codes.
 * Stored values stay as saved. Catalog labels win, then a known-model table,
 * then a title-case fallback for snake/kebab codes.
 */
import { EQUIPMENT_CATALOG } from './equipment-catalog.ts';
import { MODELS } from './models.ts';

/**
 * Slugs whose product name is not a title-case of the code.
 * soprano_titanium title-cases cleanly; alex_trivantage does not.
 */
const KNOWN_MODEL_DISPLAY: Record<string, string> = {
  alex_trivantage: 'Alexandrite TriVantage',
  alextrivantage: 'Alexandrite TriVantage',
  soprano_titanium: 'Soprano Titanium',
  soprano_ice: 'Soprano ICE',
  soprano_ice_platinum: 'Soprano ICE Platinum',
  gentlelase: 'GentleLASE',
  gentlelase_plus: 'GentleLASE Plus',
  gentleyag: 'GentleYAG',
  gentlemax: 'GentleMax',
  gentlemax_pro: 'GentleMax Pro',
  lightsheer: 'LightSheer',
  lightsheer_duet: 'LightSheer Duet',
  coolglide: 'CoolGlide',
  vbeam: 'Vbeam',
  vbeam_perfecta: 'Vbeam Perfecta',
};

let displayIndex: Map<string, string> | null = null;

function normKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function compactKey(value: string): string {
  return normKey(value).replace(/_/g, '');
}

function remember(index: Map<string, string>, key: string, label: string) {
  const shown = String(label || '').trim();
  const source = String(key || '').trim();
  if (!shown || !source) return;
  const norm = normKey(source);
  const compact = compactKey(source);
  if (norm && !index.has(norm)) index.set(norm, shown);
  if (compact && !index.has(`c:${compact}`)) index.set(`c:${compact}`, shown);
}

function buildDisplayIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const [key, label] of Object.entries(KNOWN_MODEL_DISPLAY)) {
    remember(index, key, label);
  }
  for (const manufacturer of EQUIPMENT_CATALOG) {
    for (const model of manufacturer.models) {
      const label = model.label || model.name;
      remember(index, model.name, label);
      remember(index, model.label, label);
      for (const alias of model.aliases || []) remember(index, alias, label);
    }
  }
  for (const [key, def] of Object.entries(MODELS)) {
    const label = def.label || key;
    remember(index, key, label);
    remember(index, def.label, label);
  }
  return index;
}

function index(): Map<string, string> {
  if (!displayIndex) displayIndex = buildDisplayIndex();
  return displayIndex;
}

/** Catalog or known-model name. Null when the value is not in those tables. */
export function lookupModelDisplayName(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const map = index();
  return map.get(normKey(raw)) || map.get(`c:${compactKey(raw)}`) || null;
}

function isModelCode(value: string): boolean {
  const raw = value.trim();
  if (!raw || /\s/.test(raw) || raw !== raw.toLowerCase()) return false;
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(raw);
}

function titleCaseSlug(raw: string): string {
  const parts = raw.split(/[_-]+/).filter(Boolean);
  if (!parts.length) return raw;
  return parts
    .map((part) => {
      if (/^[ivx]+$/i.test(part) && part.length <= 4) return part.toUpperCase();
      if (/\d/.test(part) && part.replace(/\d/g, '').length <= 3) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Human model name for a stored code. Already-human names are returned unchanged. */
export function displayModelName(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const known = lookupModelDisplayName(raw);
  if (known) return known;
  if (isModelCode(raw)) return titleCaseSlug(raw);
  return raw;
}

/**
 * Display text that may be a model code or a longer line containing one.
 * Only whole-value codes are title-cased. Embedded tokens change when they
 * are in the catalog or the known-model table.
 */
export function displayModelText(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!/\s/.test(raw)) return displayModelName(raw);
  return raw.replace(/[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+/g, (token) => lookupModelDisplayName(token) || token);
}
