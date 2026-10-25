/**
 * Device-type Service Report templates (modular sections).
 *
 * Source of truth for the starter checklists that 000945 seeds. The same data
 * is the in-memory fallback before the migration is applied, so a bed / table
 * report never falls back to the laser checklist again.
 *
 * Resolution follows the equipment cascade (type -> manufacturer -> model):
 * the most specific published template wins, an org's own template beats the
 * platform one at the same specificity, and is_default breaks remaining ties.
 * Lasers keep the existing CL_* form unchanged (laser-pm-default).
 */

import { manufacturerNamesEqual, modelDedupeKey } from './equipment-dropdown.ts';
import {
  DEFAULT_EQUIPMENT_TYPE,
  equipmentTypeLabel,
  equipmentTypeOrDefault,
  normalizeEquipmentType,
} from './equipment-types.ts';

export const LEGACY_CHECKLIST_SECTIONS = ['electrical', 'mechanical', 'aesthetic'] as const;

/** Titles the laser form and print have always used. Unchanged. */
export const LEGACY_SECTION_TITLES: Record<string, string> = {
  electrical: 'Electrical Checklist',
  mechanical: 'Mechanical & Optical',
  aesthetic: 'Aesthetic Condition',
  safety: 'Electrical Safety',
};

/** Equipment type for the generic template used when a type has none. */
export const GENERAL_EQUIPMENT_TYPE = 'general';
export const GENERAL_TEMPLATE_SLUG = 'general-pm-default';

const SECTION_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

export function isValidSectionKey(value: unknown): value is string {
  return typeof value === 'string' && SECTION_KEY_RE.test(value);
}

export function isLegacyChecklistSection(value: unknown): boolean {
  return (LEGACY_CHECKLIST_SECTIONS as readonly string[]).includes(String(value));
}

export function slugify(label: string, max = 80): string {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
}

/** Key for a section the tech adds on one report: custom_<slug>. */
export function customSectionKey(label: string): string | null {
  const base = slugify(label, 32).replace(/-/g, '_').replace(/^_+|_+$/g, '');
  if (!base) return null;
  const key = `custom_${base}`.slice(0, 40).replace(/_+$/g, '');
  return isValidSectionKey(key) ? key : null;
}

/** Readable title for a section key with no stored label. */
export function titleForSectionKey(key: string, labels?: Record<string, string> | null): string {
  if (labels && labels[key]) return labels[key];
  if (LEGACY_SECTION_TITLES[key]) return LEGACY_SECTION_TITLES[key];
  const words = String(key || '')
    .replace(/^custom_/, '')
    .split('_')
    .filter(Boolean);
  if (!words.length) return 'Checklist';
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export type StarterItem = {
  slug: string;
  label: string;
  input_kind?: 'pass_fail_na' | 'numeric';
  unit?: string | null;
  spec_hint?: string | null;
};

export type StarterSection = { key: string; label: string; items: StarterItem[] };

export type StarterTemplate = {
  slug: string;
  name: string;
  equipment_type: string;
  manufacturer?: string | null;
  model?: string | null;
  editable_default: boolean;
  notes: string;
  sections: StarterSection[];
};

// Shared elements already in the 000002 library (same slugs and labels).
const POWER_CORD: StarterItem = { slug: 'power-cord-plug', label: 'Power Cord & Plug integrity' };
const DISPLAY: StarterItem = { slug: 'display', label: 'Display functioning properly' };
const FAULTS: StarterItem = { slug: 'faults-errors', label: 'Faults/Errors documented & cleared' };
const WHEELS: StarterItem = { slug: 'wheels-castors', label: 'Wheels & Castors integrity' };
const CONTROL_PANEL: StarterItem = { slug: 'control-panel', label: 'Control Panel condition' };
const LABELS: StarterItem = { slug: 'warning-labels', label: 'Warning labels present & legible' };
// New shared element.
const BATTERY: StarterItem = { slug: 'battery-backup', label: 'Battery charged & holds capacity' };

export const SAFETY_SECTION: StarterSection = {
  key: 'safety',
  label: 'Electrical Safety',
  items: [
    { slug: 'ground-resistance', label: 'Ground Resistance', input_kind: 'numeric', unit: 'Ω', spec_hint: 'spec ≤ 0.2Ω' },
    { slug: 'leakage-current', label: 'Leakage Current', input_kind: 'numeric', unit: 'µA', spec_hint: 'spec ≤ 300µA' },
  ],
};

/** Slugs that exist since 000002 and are reused, not re-seeded with new text. */
export const EXISTING_ELEMENT_SLUGS = new Set([
  'power-cord-plug',
  'display',
  'faults-errors',
  'wheels-castors',
  'control-panel',
  'warning-labels',
  'ground-resistance',
  'leakage-current',
]);

/** Elements used by more than one type: stored with equipment_type NULL. */
export const SHARED_ELEMENT_SLUGS = new Set([...EXISTING_ELEMENT_SLUGS, 'battery-backup']);

const STARTER_NOTE = 'Starter checklist (editable default). Techs can remove lines and add sections or items per report.';

function starter(
  type: string,
  name: string,
  sections: StarterSection[],
  slug = `${type.replace(/_/g, '-')}-pm-default`
): StarterTemplate {
  return { slug, name, equipment_type: type, editable_default: true, notes: STARTER_NOTE, sections: [...sections, SAFETY_SECTION] };
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  starter('beds', 'Bed / Exam Table PM', [
    {
      key: 'electrical',
      label: 'Electrical & Controls',
      items: [
        POWER_CORD,
        { slug: 'beds-hand-pendant', label: 'Hand control / pendant & cord' },
        { slug: 'beds-foot-control', label: 'Foot control function' },
        { slug: 'beds-limit-switches', label: 'Limit switches stop travel at end points' },
        { slug: 'beds-battery', label: 'Battery backup charged & functional (if equipped)' },
      ],
    },
    {
      key: 'motion',
      label: 'Motion & Function',
      items: [
        { slug: 'beds-height-travel', label: 'Height (base up/down) travel smooth, full range' },
        { slug: 'beds-back-tilt', label: 'Back / tilt articulation full range' },
        { slug: 'beds-foot-section', label: 'Foot / leg section function' },
        { slug: 'beds-trendelenburg', label: 'Trendelenburg / reverse (if equipped)' },
        { slug: 'beds-no-drift', label: 'Holds position under load (no drift)' },
        { slug: 'beds-cpr-release', label: 'CPR / emergency release (if equipped)' },
        { slug: 'beds-brakes', label: 'Brakes / caster locks hold' },
      ],
    },
    {
      key: 'mechanical',
      label: 'Frame & Mechanical',
      items: [
        { slug: 'beds-hydraulics', label: 'Hydraulic fluid level, no leaks' },
        { slug: 'beds-actuators', label: 'Motors / actuators, no abnormal noise' },
        { slug: 'beds-frame-fasteners', label: 'Frame, welds & fasteners secure' },
        { slug: 'beds-lubrication', label: 'Pivot points lubricated' },
        { slug: 'beds-side-rails', label: 'Side rails / armrests latch securely' },
        WHEELS,
      ],
    },
    {
      key: 'aesthetic',
      label: 'Upholstery & Condition',
      items: [
        { slug: 'beds-upholstery', label: 'Upholstery free of tears / cracks' },
        { slug: 'beds-accessories', label: 'Paper roll holder, drawers & stirrups' },
        { slug: 'beds-covers-finish', label: 'Covers & finish condition' },
        LABELS,
      ],
    },
  ]),
  starter('sterile_processing', 'Autoclave / Sterilizer PM', [
    {
      key: 'electrical',
      label: 'Electrical',
      items: [POWER_CORD, DISPLAY, FAULTS, { slug: 'autoclave-heater', label: 'Heating element / heater current to spec' }],
    },
    {
      key: 'sterilization',
      label: 'Cycle & Sterilization',
      items: [
        { slug: 'autoclave-test-cycle', label: 'Test cycle completed (temp / pressure / time logged)' },
        { slug: 'autoclave-temp-cal', label: 'Temperature calibration verified' },
        { slug: 'autoclave-pressure-cal', label: 'Pressure gauge / transducer verified' },
        { slug: 'autoclave-bi-test', label: 'Bowie-Dick / BI test result (if applicable)' },
        { slug: 'autoclave-drying', label: 'Drying cycle performs' },
      ],
    },
    {
      key: 'mechanical',
      label: 'Chamber & Mechanical',
      items: [
        { slug: 'autoclave-door-gasket', label: 'Door gasket inspected / replaced' },
        { slug: 'autoclave-door-interlock', label: 'Door interlock / safety lock' },
        { slug: 'autoclave-relief-valve', label: 'Pressure relief valve tested' },
        { slug: 'autoclave-reservoir', label: 'Reservoir drained, cleaned & refilled (distilled)' },
        { slug: 'autoclave-filters', label: 'Chamber & water filters cleaned' },
        { slug: 'autoclave-plumbing', label: 'Plumbing / solenoids, no leaks' },
        { slug: 'autoclave-trays', label: 'Trays & rack condition' },
      ],
    },
    {
      key: 'aesthetic',
      label: 'Condition',
      items: [CONTROL_PANEL, { slug: 'autoclave-cabinet', label: 'Cabinet & finish condition' }, LABELS],
    },
  ]),
  starter('defibrillator', 'Defibrillator / AED PM', [
    {
      key: 'electrical',
      label: 'Electrical',
      items: [POWER_CORD, BATTERY, DISPLAY, FAULTS, { slug: 'defib-self-test', label: 'Self-test passes' }],
    },
    {
      key: 'energy',
      label: 'Energy & Function',
      items: [
        { slug: 'defib-energy', label: 'Delivered energy within spec at each setting' },
        { slug: 'defib-charge-time', label: 'Charge time to max energy within spec' },
        { slug: 'defib-sync', label: 'Synchronized cardioversion' },
        { slug: 'defib-ecg', label: 'ECG monitoring / leads' },
        { slug: 'defib-pacer', label: 'Pacer output (if equipped)' },
        { slug: 'defib-recorder', label: 'Recorder / printer' },
        { slug: 'defib-alarms', label: 'Alarms audible & visual' },
      ],
    },
    {
      key: 'aesthetic',
      label: 'Accessories & Condition',
      items: [
        { slug: 'defib-paddles-cables', label: 'Paddles / pads cable condition' },
        { slug: 'defib-pads-in-date', label: 'Pads & supplies in date' },
        CONTROL_PANEL,
        LABELS,
      ],
    },
  ]),
  starter('infusion_pump', 'Infusion Pump PM', [
    { key: 'electrical', label: 'Electrical', items: [POWER_CORD, BATTERY, DISPLAY, FAULTS] },
    {
      key: 'flow',
      label: 'Flow & Alarms',
      items: [
        { slug: 'infusion-flow-accuracy', label: 'Flow rate accuracy within spec' },
        { slug: 'infusion-occlusion', label: 'Occlusion pressure alarm' },
        { slug: 'infusion-air-in-line', label: 'Air-in-line detection' },
        { slug: 'infusion-free-flow', label: 'Door open / free-flow protection' },
        { slug: 'infusion-alarms', label: 'Alarms audible & visual' },
        { slug: 'infusion-keypad', label: 'Keypad / buttons' },
      ],
    },
    {
      key: 'aesthetic',
      label: 'Condition',
      items: [{ slug: 'infusion-housing', label: 'Housing & pole clamp condition' }, LABELS],
    },
  ]),
  starter('patient_monitor', 'Patient Monitor PM', [
    { key: 'electrical', label: 'Electrical', items: [POWER_CORD, BATTERY, DISPLAY, FAULTS] },
    {
      key: 'parameters',
      label: 'Parameters',
      items: [
        { slug: 'monitor-ecg', label: 'ECG / heart rate accuracy (simulator)' },
        { slug: 'monitor-spo2', label: 'SpO2 accuracy' },
        { slug: 'monitor-nibp', label: 'NIBP accuracy & leak test' },
        { slug: 'monitor-temp', label: 'Temperature' },
        { slug: 'monitor-ibp-co2', label: 'IBP / CO2 (if equipped)' },
        { slug: 'monitor-alarms', label: 'Alarms audible & visual' },
        { slug: 'monitor-network', label: 'Network / central station connection' },
      ],
    },
    {
      key: 'aesthetic',
      label: 'Accessories & Condition',
      items: [
        { slug: 'monitor-cables', label: 'Patient cables & sensors condition' },
        { slug: 'monitor-mount', label: 'Mount / housing condition' },
        LABELS,
      ],
    },
  ]),
  starter('ventilator', 'Ventilator PM', [
    { key: 'electrical', label: 'Electrical', items: [POWER_CORD, BATTERY, DISPLAY, FAULTS] },
    {
      key: 'ventilation',
      label: 'Ventilation & Alarms',
      items: [
        { slug: 'vent-self-test', label: 'Self-test / pre-use check passes' },
        { slug: 'vent-volume', label: 'Tidal volume accuracy' },
        { slug: 'vent-pressure', label: 'Pressure / PEEP accuracy' },
        { slug: 'vent-o2', label: 'O2 concentration / sensor calibration' },
        { slug: 'vent-rate', label: 'Rate & I:E ratio' },
        { slug: 'vent-alarms', label: 'Alarms (high/low pressure, disconnect, power)' },
      ],
    },
    {
      key: 'mechanical',
      label: 'Pneumatics',
      items: [
        { slug: 'vent-filters', label: 'Filters replaced per PM kit' },
        { slug: 'vent-leak', label: 'Circuit leak test' },
        { slug: 'vent-gas-inlets', label: 'Gas inlet pressures & hoses' },
      ],
    },
    { key: 'aesthetic', label: 'Condition', items: [CONTROL_PANEL, LABELS] },
  ]),
  starter('anesthesia', 'Anesthesia Machine PM', [
    { key: 'electrical', label: 'Electrical', items: [POWER_CORD, BATTERY, DISPLAY, FAULTS] },
    {
      key: 'gas_delivery',
      label: 'Gas Delivery & Ventilation',
      items: [
        { slug: 'anes-leak-test', label: 'High / low pressure leak test' },
        { slug: 'anes-flowmeters', label: 'Flowmeter accuracy' },
        { slug: 'anes-o2-failsafe', label: 'O2 fail-safe / hypoxic guard' },
        { slug: 'anes-vaporizers', label: 'Vaporizer interlock & output' },
        { slug: 'anes-ventilator', label: 'Ventilator volume / pressure accuracy' },
        { slug: 'anes-apl', label: 'APL valve' },
        { slug: 'anes-alarms', label: 'Alarms audible & visual' },
      ],
    },
    {
      key: 'mechanical',
      label: 'Pneumatics & Scavenging',
      items: [
        { slug: 'anes-pipeline', label: 'Pipeline & cylinder pressures / yokes' },
        { slug: 'anes-absorber', label: 'CO2 absorber canister' },
        { slug: 'anes-scavenging', label: 'Scavenging system' },
        { slug: 'anes-o2-sensor', label: 'O2 sensor calibrated' },
        WHEELS,
      ],
    },
    { key: 'aesthetic', label: 'Condition', items: [CONTROL_PANEL, LABELS] },
  ]),
  starter('c_arm', 'C-arm PM', [
    {
      key: 'electrical',
      label: 'Electrical',
      items: [POWER_CORD, DISPLAY, FAULTS, { slug: 'carm-interlocks', label: 'Interlocks & exposure switches' }],
    },
    {
      key: 'imaging',
      label: 'Imaging & Radiation',
      items: [
        { slug: 'carm-kvp', label: 'kVp accuracy' },
        { slug: 'carm-ma', label: 'mA / exposure time accuracy' },
        { slug: 'carm-dose', label: 'Dose / air kerma rate within limits' },
        { slug: 'carm-image-quality', label: 'Image quality (resolution / contrast phantom)' },
        { slug: 'carm-collimator', label: 'Collimator / beam alignment' },
        { slug: 'carm-laser-aimer', label: 'Laser aimer' },
      ],
    },
    {
      key: 'mechanical',
      label: 'Mechanical',
      items: [
        { slug: 'carm-locks', label: 'Brakes & movement locks' },
        { slug: 'carm-cables', label: 'Cable track / HV cables' },
        WHEELS,
      ],
    },
    {
      key: 'aesthetic',
      label: 'Condition',
      items: [{ slug: 'carm-monitor-cart', label: 'Monitor cart condition' }, LABELS],
    },
  ]),
  starter('ultrasound', 'Ultrasound PM', [
    { key: 'electrical', label: 'Electrical', items: [POWER_CORD, DISPLAY, FAULTS] },
    {
      key: 'imaging',
      label: 'Imaging',
      items: [
        { slug: 'us-transducers', label: 'Transducer element / dropout test' },
        { slug: 'us-image-quality', label: 'Image quality / phantom check' },
        { slug: 'us-doppler', label: 'Doppler / color' },
        { slug: 'us-calipers', label: 'Measurement caliper accuracy' },
        { slug: 'us-peripherals', label: 'Printer / storage / network' },
      ],
    },
    {
      key: 'mechanical',
      label: 'Mechanical',
      items: [{ slug: 'us-fans-filters', label: 'Fans & air filters cleaned' }, WHEELS],
    },
    {
      key: 'aesthetic',
      label: 'Condition',
      items: [{ slug: 'us-transducer-lens', label: 'Transducer lens & cable condition' }, CONTROL_PANEL, LABELS],
    },
  ]),
  starter('endoscope', 'Endoscope / Tower PM', [
    { key: 'electrical', label: 'Electrical', items: [POWER_CORD, DISPLAY, FAULTS] },
    {
      key: 'scope',
      label: 'Scope & Tower',
      items: [
        { slug: 'endo-leak-test', label: 'Leak test passes' },
        { slug: 'endo-angulation', label: 'Angulation / deflection range' },
        { slug: 'endo-image', label: 'Image quality (CCD / fiber bundle)' },
        { slug: 'endo-light-source', label: 'Light source output / lamp hours' },
        { slug: 'endo-channels', label: 'Air / water / suction channels' },
        { slug: 'endo-buttons', label: 'Control buttons' },
      ],
    },
    {
      key: 'aesthetic',
      label: 'Condition',
      items: [
        { slug: 'endo-insertion-tube', label: 'Insertion tube & bending rubber condition' },
        { slug: 'endo-distal-lens', label: 'Distal lens condition' },
        LABELS,
      ],
    },
  ]),
  starter('lithotriptor', 'Lithotriptor PM', [
    {
      key: 'electrical',
      label: 'Electrical',
      items: [POWER_CORD, DISPLAY, FAULTS, { slug: 'litho-hv-generator', label: 'High voltage / generator to spec' }],
    },
    {
      key: 'shockwave',
      label: 'Shockwave & Imaging',
      items: [
        { slug: 'litho-shockwave', label: 'Shockwave generation / energy levels' },
        { slug: 'litho-ecg-trigger', label: 'ECG trigger / sync' },
        { slug: 'litho-targeting', label: 'Targeting / localization alignment' },
        { slug: 'litho-water', label: 'Water conditioning / degassing' },
        { slug: 'litho-coupling', label: 'Coupling cushion / membrane' },
        { slug: 'litho-table', label: 'Patient table motion' },
      ],
    },
    {
      key: 'mechanical',
      label: 'Mechanical',
      items: [
        { slug: 'litho-cooling', label: 'Cooling system & filters' },
        { slug: 'litho-electrode', label: 'Electrode / emitter shot count' },
      ],
    },
    { key: 'aesthetic', label: 'Condition', items: [CONTROL_PANEL, LABELS] },
  ]),
  starter(
    GENERAL_EQUIPMENT_TYPE,
    'General Equipment PM',
    [
      {
        key: 'electrical',
        label: 'Electrical',
        items: [POWER_CORD, DISPLAY, FAULTS, { slug: 'general-controls', label: 'Controls & indicators' }],
      },
      {
        key: 'functional',
        label: 'Function',
        items: [
          { slug: 'general-performance', label: 'Performs to manufacturer specification' },
          { slug: 'general-alarms', label: 'Alarms / safety features (if equipped)' },
        ],
      },
      {
        key: 'mechanical',
        label: 'Mechanical',
        items: [{ slug: 'general-hardware', label: 'Housing, mounts & hardware secure' }, WHEELS],
      },
      { key: 'aesthetic', label: 'Condition', items: [CONTROL_PANEL, LABELS] },
    ],
    GENERAL_TEMPLATE_SLUG
  ),
];

export function starterTemplateFor(equipmentType: unknown): StarterTemplate {
  const type = normalizeEquipmentType(equipmentType);
  return (
    STARTER_TEMPLATES.find((t) => t.equipment_type === type) ||
    (STARTER_TEMPLATES.find((t) => t.equipment_type === GENERAL_EQUIPMENT_TYPE) as StarterTemplate)
  );
}

/** Element's library type: NULL when shared, else the one type that uses it. */
export function starterElementType(slug: string, template: StarterTemplate): string | null {
  return SHARED_ELEMENT_SLUGS.has(slug) ? null : template.equipment_type;
}

// ---------------------------------------------------------------------------
// Resolution: type -> manufacturer -> model, most specific wins
// ---------------------------------------------------------------------------

export type ResolvableTemplate = {
  equipment_type?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  organization_id?: number | string | null;
  is_default?: boolean | null;
  status?: string | null;
  slug?: string | null;
};

export type EquipmentSelection = {
  equipmentType?: string | null;
  manufacturer?: string | null;
  model?: string | null;
};

function blank(v: unknown): boolean {
  return v == null || String(v).trim() === '';
}

/**
 * Score a template for a selection, or -1 when it cannot apply. A template
 * that names a manufacturer applies only to that manufacturer; one that names
 * a model applies only to that model (and its manufacturer, when named).
 */
export function templateMatchScore(t: ResolvableTemplate, sel: EquipmentSelection): number {
  if (t.status && t.status !== 'published') return -1;
  const type = String(sel.equipmentType || '');
  if (String(t.equipment_type || '') !== type) return -1;
  let score = 0;
  if (!blank(t.manufacturer)) {
    if (blank(sel.manufacturer) || !manufacturerNamesEqual(String(t.manufacturer), String(sel.manufacturer))) return -1;
    score += 2;
  }
  if (!blank(t.model)) {
    if (blank(sel.model) || modelDedupeKey(String(t.model)) !== modelDedupeKey(String(sel.model))) return -1;
    score += 4;
  }
  return score;
}

function rank(t: ResolvableTemplate, sel: EquipmentSelection): number {
  const s = templateMatchScore(t, sel);
  if (s < 0) return -1;
  return s * 4 + (t.organization_id != null && t.organization_id !== '' ? 2 : 0) + (t.is_default ? 1 : 0);
}

function best<T extends ResolvableTemplate>(templates: T[], sel: EquipmentSelection): T | null {
  let winner: T | null = null;
  let top = -1;
  for (const t of templates) {
    const r = rank(t, sel);
    if (r > top) {
      top = r;
      winner = t;
    }
  }
  return winner;
}

/**
 * Pick the template for the selected equipment. Order: the requested type
 * (most specific match), then the General template. Lasers fall back to the
 * laser default as before; other types never get the laser form.
 */
export function resolveTemplate<T extends ResolvableTemplate>(templates: T[], sel: EquipmentSelection): T | null {
  const type = equipmentTypeOrDefault(sel.equipmentType);
  const list = (templates || []).filter((t) => !t.status || t.status === 'published');
  const hit = best(list, { ...sel, equipmentType: type });
  if (hit) return hit;
  if (type === DEFAULT_EQUIPMENT_TYPE) return null;
  return best(list, { equipmentType: GENERAL_EQUIPMENT_TYPE });
}

// ---------------------------------------------------------------------------
// Report JSON: checklist_sections (modular sections for print / view / email)
// ---------------------------------------------------------------------------

export type ChecklistSectionJson = {
  key: string;
  label: string;
  items: Array<{ label: string; result: string }>;
};

type ItemLike = { section: string; label: string; result?: string | null; section_label?: string | null; sort_order?: number };

/**
 * Ordered section list for a report: the template's sections first, then any
 * other section present on the items (custom sections, legacy leftovers).
 */
export function orderedSections(
  items: ItemLike[],
  templateSections?: Array<{ key: string; label: string }> | null
): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  for (const s of templateSections || []) {
    if (!isValidSectionKey(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push({ key: s.key, label: s.label || titleForSectionKey(s.key) });
  }
  for (const item of items || []) {
    if (!isValidSectionKey(item.section) || seen.has(item.section)) continue;
    seen.add(item.section);
    out.push({ key: item.section, label: item.section_label || titleForSectionKey(item.section) });
  }
  return out;
}

/**
 * The checklist_sections value to save. NULL when the report only uses the
 * three legacy sections under their legacy titles (every laser report), so
 * laser reports print, email and render exactly as before.
 */
export function checklistSectionsJson(
  items: ItemLike[],
  sections: Array<{ key: string; label: string }>
): ChecklistSectionJson[] | null {
  const checklistSections = sections.filter((s) => s.key !== 'safety');
  const legacyOnly =
    items.every((i) => i.section === 'safety' || isLegacyChecklistSection(i.section)) &&
    checklistSections.every((s) => isLegacyChecklistSection(s.key) && s.label === LEGACY_SECTION_TITLES[s.key]);
  if (legacyOnly) return null;
  const out: ChecklistSectionJson[] = [];
  for (const s of checklistSections) {
    const rows = items
      .filter((i) => i.section === s.key)
      .map((i) => ({ label: i.label, result: i.result || '' }));
    if (rows.length) out.push({ key: s.key, label: s.label, items: rows });
  }
  return out.length ? out : null;
}

export type DisplaySection = { title: string; rows: Record<string, string> };

/**
 * Sections to show on the report page, print and email. Uses
 * checklist_sections when the report has it, else the three legacy JSON maps
 * under the caller's legacy titles (unchanged output for old reports).
 */
export function displaySectionsForReport(
  report: {
    checklist_sections?: unknown;
    checklist_electrical?: Record<string, string> | null;
    checklist_mechanical?: Record<string, string> | null;
    checklist_aesthetic?: Record<string, string> | null;
  },
  legacyTitles: [string, string, string]
): DisplaySection[] {
  let parsed: unknown = report?.checklist_sections;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  if (Array.isArray(parsed) && parsed.length) {
    const out: DisplaySection[] = [];
    for (const s of parsed as any[]) {
      if (!s || !Array.isArray(s.items)) continue;
      const rows: Record<string, string> = {};
      for (const it of s.items) {
        if (it && typeof it.label === 'string' && it.label) rows[it.label] = it.result == null ? '' : String(it.result);
      }
      if (Object.keys(rows).length) out.push({ title: String(s.label || titleForSectionKey(String(s.key || ''))), rows });
    }
    if (out.length) return out;
  }
  const legacy: Array<[string, Record<string, string> | null | undefined]> = [
    [legacyTitles[0], report?.checklist_electrical],
    [legacyTitles[1], report?.checklist_mechanical],
    [legacyTitles[2], report?.checklist_aesthetic],
  ];
  return legacy
    .filter(([, rows]) => rows && typeof rows === 'object' && Object.keys(rows).length)
    .map(([title, rows]) => ({ title, rows: rows as Record<string, string> }));
}

// ---------------------------------------------------------------------------
// Seed rows for 000945 (the test asserts the migration carries exactly these)
// ---------------------------------------------------------------------------

function sqlText(v: string | null | undefined): string {
  return v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * One VALUES row per (template, section, item):
 * (template_slug, template_name, equipment_type, section_key, section_label,
 *  section_order, element_slug, element_label, element_order, input_kind,
 *  unit, spec_hint, element_equipment_type)
 */
export function starterSeedValues(): string[] {
  const rows: string[] = [];
  for (const t of STARTER_TEMPLATES) {
    t.sections.forEach((section, si) => {
      section.items.forEach((item, ii) => {
        rows.push(
          `(${[
            sqlText(t.slug),
            sqlText(t.name),
            sqlText(t.equipment_type),
            sqlText(section.key),
            sqlText(section.label),
            String((si + 1) * 10),
            sqlText(item.slug),
            sqlText(item.label),
            String((ii + 1) * 10),
            sqlText(item.input_kind || 'pass_fail_na'),
            sqlText(item.unit ?? null),
            sqlText(item.spec_hint ?? null),
            sqlText(starterElementType(item.slug, t)),
          ].join(', ')})`
        );
      });
    });
  }
  return rows;
}

/**
 * Header line under "Total Service Pro" on a service report. undefined keeps
 * the default "Laser Equipment Service" (laser and legacy NULL-type reports).
 */
export function reportHeaderTagline(equipmentType: unknown): string | undefined {
  const type = equipmentTypeOrDefault(equipmentType);
  if (type === DEFAULT_EQUIPMENT_TYPE) return undefined;
  return `${equipmentTypeLabel(type)} Service`;
}
