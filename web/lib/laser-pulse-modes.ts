/**
 * Pulse-mode options for Service Report measurement rows, by equipment make/model.
 * Add a laser family by adding one entry to PULSE_MODE_RULES. Matching is case-insensitive.
 * Saved values that are not in the current options still display (see pulseModeDisplay).
 */

export const PULSE_MODE_LABELS: Record<string, string> = {
  cw: 'CW',
  superpulse: 'SuperPulse',
  ultrapulse: 'UltraPulse',
  starpulse: 'StarPulse',
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
};

export const PULSE_MODE_RULES: PulseModeRule[] = [
  {
    id: 'lumenis-coherent-co2',
    makes: ['lumenis', 'coherent', 'sharplan'],
    models: ['co2', 'ultrapulse', 'encore', 'acupulse', 'surgitouch', 'novapulse', 'sharplan', '40c', '30c'],
    modes: ['cw', 'superpulse', 'ultrapulse'],
  },
  {
    id: 'laserscope-ams-ktp',
    makes: ['laserscope', 'ams', 'american medical systems'],
    modes: ['cw', 'starpulse'],
  },
  {
    // AMS/Laserscope Aura sold under other names: match by model alone.
    id: 'aura-ktp-by-model',
    makes: [''],
    models: ['aura', 'ktp'],
    modes: ['cw', 'starpulse'],
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
