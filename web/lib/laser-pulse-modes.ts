/**
 * Shared laser config for Service Report measurement rows, by equipment make/model:
 * pulse-mode options and wavelength options.
 * Add a laser family by adding one entry to PULSE_MODE_RULES. Matching is case-insensitive.
 * Saved values that are not in the current options still display (see pulseModeDisplay).
 */

export const PULSE_MODE_LABELS: Record<string, string> = {
  cw: 'CW',
  superpulse: 'SuperPulse',
  ultrapulse: 'UltraPulse',
  starpulse: 'StarPulse',
  pulsed: 'Pulsed',
  other: 'Other',
};

/** Shown when the make/model matches no rule: every mode plus Other (free text). */
export const ALL_PULSE_MODES = ['cw', 'superpulse', 'ultrapulse', 'starpulse', 'other'] as const;

export type PulseModeRule = {
  id: string;
  /** Any of these appearing in the make (lowercase substring). */
  makes: string[];
  /** Optional: one of these must appear in the model (lowercase substring). Empty = any model. */
  models?: string[];
  modes: string[];
  /** Wavelengths this laser emits. Exactly one = auto-selected. Omit = fall back (model table / free entry). */
  wavelengths?: string[];
};

/**
 * Wavelength sources (checked Nov 2026):
 * - Lumenis UltraPulse brochure PB-1124760 RevD: 10,600 nm. Coherent UltraPulse 5000C specs
 *   (drstoystore.com, laserlabs.com): 10,600 nm. No 11,000 nm variant found.
 * - AMS Aura XP brochure 23000157A (2007) and Fortec Aura XP sheet: KTP 532 nm only.
 *   1064 nm is the separate Laserscope Lyra, not the Aura.
 */
export const WL_CO2 = '10600 nm';
export const WL_KTP = '532 nm';

/** Suggestions for free entry when the laser is not in the config. */
export const COMMON_WAVELENGTHS = [
  '532 nm', '585 nm', '595 nm', '694 nm', '755 nm', '810 nm', '940 nm', '980 nm',
  '1064 nm', '1320 nm', '1450 nm', '1470 nm', '1550 nm', '1927 nm', '2100 nm', '2940 nm', '10600 nm',
] as const;

export const PULSE_MODE_RULES: PulseModeRule[] = [
  {
    id: 'lumenis-coherent-co2',
    makes: ['lumenis', 'coherent', 'sharplan'],
    models: ['co2', 'ultrapulse', 'encore', 'acupulse', 'surgitouch', 'novapulse', 'sharplan', '40c', '30c'],
    modes: ['cw', 'superpulse', 'ultrapulse', 'other'],
    wavelengths: [WL_CO2],
  },
  {
    id: 'laserscope-ams-ktp',
    makes: ['laserscope', 'ams', 'american medical systems'],
    modes: ['cw', 'starpulse', 'other'],
    wavelengths: [WL_KTP],
  },
  {
    // Candela long-pulse Alex/Nd:YAG (GentleMAX, GentleMAX PRO, GentleLASE, GentleYAG,
    // VPYAG) and pulsed-dye VBeam are pulsed-only: no CW and none of the CO2/KTP
    // SuperPulse/UltraPulse/StarPulse modes. Pulse width (ms) is its own setting.
    // Wavelengths are left to the model table. Pending Larry's confirmation of the list.
    id: 'candela-pulsed',
    makes: ['candela', 'syneron'],
    models: ['gentle', 'vpyag', 'vbeam', 'v-beam'],
    modes: ['pulsed', 'other'],
  },
  {
    // AMS/Laserscope Aura sold under other names: match by model alone.
    id: 'aura-ktp-by-model',
    makes: [''],
    models: ['aura', 'ktp'],
    modes: ['cw', 'starpulse', 'other'],
    wavelengths: [WL_KTP],
  },
];

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function makeMatches(make: string, needle: string): boolean {
  if (needle === '') return true;
  if (needle.length <= 3) return new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`).test(make);
  return make.includes(needle);
}

export function pulseModeRuleFor(make: unknown, model: unknown): PulseModeRule | null {
  const mk = norm(make);
  const md = norm(model);
  for (const rule of PULSE_MODE_RULES) {
    const makeOk = rule.makes.some((m) => makeMatches(mk, m));
    if (!makeOk || (rule.makes.every((m) => m === '') && !md)) continue;
    if (rule.models?.length && !rule.models.some((m) => md.includes(m))) continue;
    return rule;
  }
  return null;
}

/** Option keys for a make/model, in display order. */
export function pulseModeOptions(make: unknown, model: unknown): string[] {
  return pulseModeRuleFor(make, model)?.modes.slice() ?? [...ALL_PULSE_MODES];
}

/** Wavelength choices from the config, or null when the laser has none configured. */
export function configuredWavelengths(make: unknown, model: unknown): string[] | null {
  const list = pulseModeRuleFor(make, model)?.wavelengths;
  return list?.length ? list.slice() : null;
}

/**
 * Wavelength for a newly added row: the previous row's, else the only configured one,
 * else the first fallback (model table) wavelength, else blank.
 */
export function wavelengthForNewRow(
  previous: string | null | undefined,
  make: unknown,
  model: unknown,
  fallbackFirst?: string | null,
): string {
  if (previous && String(previous).trim()) return String(previous);
  const configured = configuredWavelengths(make, model);
  if (configured) return configured.length === 1 ? configured[0] : '';
  return fallbackFirst || '';
}

/** Display text for a saved row, even when the key is not in today's options. '' = none. */
export function pulseModeDisplay(row: any, tr: (text: string) => string = (t) => t): string {
  const mode = String(row?.pulseMode ?? row?.pulse_mode ?? '').trim();
  if (!mode) return '';
  if (mode === 'other') {
    const custom = String(row?.pulseModeOther ?? row?.pulse_mode_other ?? '').trim();
    return custom || tr('Other');
  }
  return PULSE_MODE_LABELS[mode.toLowerCase()] ?? mode;
}

/**
 * Wavelength text only. Model tables name some channels '1064 nm @ 3mm spot'; the spot
 * belongs in its own field, so strip a trailing '@ <n>mm [spot]' part. Old saved values
 * that carry it still display, just without the spot text.
 */
export function wavelengthLabel(value: unknown): string {
  return String(value ?? '')
    .replace(/\s*@\s*[\d.,]+\s*(mm|cm)\b(\s*spot)?\s*$/i, '')
    .trim();
}

/** Wavelength options with spot text stripped and duplicates removed (first wins). */
export function wavelengthOptionNames(names: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const label = wavelengthLabel(n);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}
