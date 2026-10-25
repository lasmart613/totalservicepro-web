/**
 * Service Report element library + device-type templates (MVP).
 *
 * Prefer PM form from manuals later. For now the laser default is the
 * existing CL_ELECTRICAL / MECHANICAL / AESTHETIC (+ safety as today).
 * Extra items (library or one-off custom) are is_extra and dual-written
 * into legacy checklist_* JSON so print/email keep working.
 */

import { CL_AESTHETIC, CL_ELECTRICAL, CL_MECHANICAL } from './models.ts';
import {
  DEFAULT_EQUIPMENT_TYPE,
  equipmentTypeOrDefault,
  type EquipmentType,
} from './equipment-types.ts';
import {
  GENERAL_EQUIPMENT_TYPE,
  isValidSectionKey,
  LEGACY_SECTION_TITLES,
  resolveTemplate,
  starterTemplateFor,
  titleForSectionKey,
  type StarterTemplate,
} from './service-report-templates.ts';

export const SR_SECTIONS = ['electrical', 'mechanical', 'aesthetic', 'safety'] as const;
/**
 * Section key. The four legacy keys above, any template section key
 * (e.g. 'motion', 'sterilization') or a per-report custom_<slug> key.
 * 000945 relaxes the DB CHECK to ^[a-z][a-z0-9_]{1,39}$.
 */
export type SrSection = string;

export const SR_CHECKLIST_SECTIONS = ['electrical', 'mechanical', 'aesthetic'] as const;
export type SrChecklistSection = (typeof SR_CHECKLIST_SECTIONS)[number];

export const SR_INPUT_KINDS = ['pass_fail_na', 'numeric'] as const;
export type SrInputKind = (typeof SR_INPUT_KINDS)[number];

export const LASER_PM_TEMPLATE_SLUG = 'laser-pm-default';

export const SAFETY_GROUND_SLUG = 'ground-resistance';
export const SAFETY_LEAKAGE_SLUG = 'leakage-current';

export type SrElement = {
  id: string;
  slug: string;
  label: string;
  section: SrSection;
  input_kind: SrInputKind;
  unit?: string | null;
  spec_hint?: string | null;
  is_active?: boolean;
  sort_hint?: number;
  /** NULL = shared across types; else the type whose starter uses it (000945). */
  equipment_type?: string | null;
};

export type SrTemplate = {
  id: string;
  slug: string;
  name: string;
  equipment_type: string;
  status: string;
  is_default: boolean;
  notes?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  organization_id?: number | string | null;
  editable_default?: boolean | null;
};

export type SrSectionDef = { key: string; label: string };

export type SrDraftItem = {
  /** Local key; persisted id when loaded from service_report_items. */
  key: string;
  id?: string | null;
  element_id: string | null;
  slug?: string | null;
  section: SrSection;
  label: string;
  result: string;
  value_numeric: number | null;
  unit: string | null;
  spec_hint?: string | null;
  input_kind: SrInputKind;
  is_extra: boolean;
  sort_order: number;
  /** Title of a section outside the template (custom sections). */
  section_label?: string | null;
};

export type LegacyChecklists = {
  electrical: Record<string, string>;
  mechanical: Record<string, string>;
  aesthetic: Record<string, string>;
};

export type SafetyValues = {
  ground_resistance: number | '' | null;
  leakage_current: number | '' | null;
  ground_resistance_pass: boolean | null;
  leakage_current_pass: boolean | null;
};

export type LoadedSrForm = {
  template: SrTemplate | null;
  usedFallback: boolean;
  requestedType: EquipmentType;
  resolvedType: EquipmentType;
  elements: SrElement[];
  items: SrDraftItem[];
  /** Ordered sections incl. safety; laser = the legacy titles. */
  sections: SrSectionDef[];
  /** Starter checklist: techs may remove any line, not only extras. */
  editable: boolean;
};

export const LASER_SECTIONS: SrSectionDef[] = [
  { key: 'electrical', label: LEGACY_SECTION_TITLES.electrical },
  { key: 'mechanical', label: LEGACY_SECTION_TITLES.mechanical },
  { key: 'aesthetic', label: LEGACY_SECTION_TITLES.aesthetic },
  { key: 'safety', label: LEGACY_SECTION_TITLES.safety },
];

export const LASER_FALLBACK_TEMPLATE: SrTemplate = {
  id: 'fallback-laser-pm',
  slug: LASER_PM_TEMPLATE_SLUG,
  name: 'Laser PM',
  equipment_type: DEFAULT_EQUIPMENT_TYPE,
  status: 'published',
  is_default: true,
  notes: 'In-memory fallback matching CL_* until the migration is applied.',
};

function slugFromLabel(label: string): string {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function fallbackElement(
  section: SrSection,
  label: string,
  sortHint: number,
  extra?: Partial<SrElement>
): SrElement {
  return {
    id: `fallback:${section}:${slugFromLabel(label) || sortHint}`,
    slug: extra?.slug || slugFromLabel(label) || `${section}-${sortHint}`,
    label,
    section,
    input_kind: extra?.input_kind || 'pass_fail_na',
    unit: extra?.unit ?? null,
    spec_hint: extra?.spec_hint ?? null,
    is_active: true,
    sort_hint: sortHint,
  };
}

/** Extra library items seeded but not assembled onto the laser default form. */
export const LASER_LIBRARY_EXTRAS: SrElement[] = [
  fallbackElement('electrical', 'Door / room interlock function', 200, { slug: 'door-interlock' }),
  fallbackElement('mechanical', 'Delivery fiber / handpiece inspection', 200, { slug: 'fiber-handpiece' }),
  fallbackElement('aesthetic', 'Warning labels present & legible', 200, { slug: 'warning-labels' }),
];

export function laserDefaultElements(): SrElement[] {
  const electrical = CL_ELECTRICAL.map((label, i) => fallbackElement('electrical', label, (i + 1) * 10));
  const mechanical = CL_MECHANICAL.map((label, i) => fallbackElement('mechanical', label, (i + 1) * 10));
  const aesthetic = CL_AESTHETIC.map((label, i) => fallbackElement('aesthetic', label, (i + 1) * 10));
  const safety: SrElement[] = [
    {
      id: `fallback:safety:${SAFETY_GROUND_SLUG}`,
      slug: SAFETY_GROUND_SLUG,
      label: 'Ground Resistance',
      section: 'safety',
      input_kind: 'numeric',
      unit: 'Ω',
      spec_hint: 'spec ≤ 0.2Ω',
      is_active: true,
      sort_hint: 10,
    },
    {
      id: `fallback:safety:${SAFETY_LEAKAGE_SLUG}`,
      slug: SAFETY_LEAKAGE_SLUG,
      label: 'Leakage Current',
      section: 'safety',
      input_kind: 'numeric',
      unit: 'µA',
      spec_hint: 'spec ≤ 300µA',
      is_active: true,
      sort_hint: 20,
    },
  ];
  return [...electrical, ...mechanical, ...aesthetic, ...safety];
}

/** Full fallback library: default laser form + extras not on that form. */
export function laserFallbackElements(): SrElement[] {
  return [...laserDefaultElements(), ...LASER_LIBRARY_EXTRAS];
}

export function isSrSection(value: unknown): value is SrSection {
  return isValidSectionKey(value);
}

export function isChecklistSection(value: unknown): value is SrChecklistSection {
  return SR_CHECKLIST_SECTIONS.includes(String(value) as SrChecklistSection);
}

export function normalizeSrSection(value: unknown, fallback: SrSection = 'mechanical'): SrSection {
  return isSrSection(value) ? value : fallback;
}

export function isMissingSrSchema(error: { message?: string } | null | undefined): boolean {
  const m = String(error?.message || '');
  return /sr_elements|sr_templates|sr_template_elements|service_report_items|schema cache|does not exist|PGRST205|PGRST204/i.test(
    m
  );
}

/**
 * Template for the selected equipment (type -> manufacturer -> model, most
 * specific wins; see resolveTemplate). Never returns the laser template for a
 * non-laser type: that was the bed/table-shows-laser-items bug.
 */
export function pickTemplateForEquipmentType<
  T extends {
    equipment_type?: string | null;
    is_default?: boolean | null;
    status?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    organization_id?: number | string | null;
  },
>(
  templates: T[],
  equipmentType: string | null | undefined,
  selection?: { manufacturer?: string | null; model?: string | null }
): T | null {
  return resolveTemplate(templates || [], {
    equipmentType: equipmentTypeOrDefault(equipmentType),
    manufacturer: selection?.manufacturer ?? null,
    model: selection?.model ?? null,
  });
}

function sortKey(item: { section: SrSection; sort_order?: number; label?: string }): string {
  const legacyRank = SR_SECTIONS.indexOf(item.section as (typeof SR_SECTIONS)[number]);
  const sectionRank = legacyRank >= 0 ? legacyRank : 50;
  const order = item.sort_order ?? 0;
  return `${String(sectionRank).padStart(2, '0')}:${item.section}:${String(order).padStart(5, '0')}:${item.label || ''}`;
}

export function assembleDraftItems(
  elements: SrElement[],
  opts?: { isExtra?: boolean; startOrder?: number }
): SrDraftItem[] {
  const start = opts?.startOrder ?? 0;
  return elements
    .filter((el) => el && el.label)
    .map((el, i) => ({
      key: el.id || `el:${el.slug || el.label}`,
      element_id: el.id && !String(el.id).startsWith('fallback:') ? el.id : el.id || null,
      slug: el.slug || null,
      section: normalizeSrSection(el.section),
      label: el.label,
      result: '',
      value_numeric: null,
      unit: el.unit ?? null,
      spec_hint: el.spec_hint ?? null,
      input_kind: (el.input_kind === 'numeric' ? 'numeric' : 'pass_fail_na') as SrInputKind,
      is_extra: !!opts?.isExtra,
      sort_order: start + (el.sort_hint ?? (i + 1) * 10),
    }))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

export function mergeResultsIntoItems(
  items: SrDraftItem[],
  previous: SrDraftItem[]
): SrDraftItem[] {
  const byElement = new Map<string, SrDraftItem>();
  const byLabelSection = new Map<string, SrDraftItem>();
  for (const prev of previous) {
    if (prev.element_id) byElement.set(prev.element_id, prev);
    byLabelSection.set(`${prev.section}::${prev.label}`, prev);
  }
  return items.map((item) => {
    const prev =
      (item.element_id && byElement.get(item.element_id)) ||
      byLabelSection.get(`${item.section}::${item.label}`);
    if (!prev) return item;
    return {
      ...item,
      id: item.id || prev.id,
      result: prev.result || item.result,
      value_numeric: prev.value_numeric ?? item.value_numeric,
      key: prev.key || item.key,
    };
  });
}

export function keepExtras(items: SrDraftItem[]): SrDraftItem[] {
  return items.filter((i) => i.is_extra);
}

export function itemsToLegacyChecklists(items: SrDraftItem[]): LegacyChecklists {
  const out: LegacyChecklists = { electrical: {}, mechanical: {}, aesthetic: {} };
  for (const item of items) {
    if (!isChecklistSection(item.section)) continue;
    out[item.section][item.label] = item.result || '';
  }
  return out;
}

export function checklistMapFromItems(items: SrDraftItem[], section: SrChecklistSection): Record<string, string> {
  return itemsToLegacyChecklists(items)[section];
}

export function labelsForSection(items: SrDraftItem[], section: SrSection): string[] {
  return items
    .filter((i) => i.section === section)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    .map((i) => i.label);
}

export function applyChecklistMap(
  items: SrDraftItem[],
  section: SrChecklistSection,
  map: Record<string, string>
): SrDraftItem[] {
  return items.map((item) => {
    if (item.section !== section) return item;
    if (!(item.label in map)) return item;
    return { ...item, result: map[item.label] ?? item.result };
  });
}

export function safetyFromItems(items: SrDraftItem[]): SafetyValues {
  const ground = items.find((i) => i.slug === SAFETY_GROUND_SLUG || /ground resistance/i.test(i.label));
  const leak = items.find((i) => i.slug === SAFETY_LEAKAGE_SLUG || /leakage current/i.test(i.label));
  const groundVal = ground?.value_numeric ?? null;
  const leakVal = leak?.value_numeric ?? null;
  return {
    ground_resistance: groundVal,
    leakage_current: leakVal,
    ground_resistance_pass: ground ? passFromResult(ground.result, groundVal != null ? groundVal <= 0.2 : null) : null,
    leakage_current_pass: leak ? passFromResult(leak.result, leakVal != null ? leakVal <= 300 : null) : null,
  };
}

function passFromResult(result: string, fallback: boolean | null): boolean | null {
  const u = String(result || '').trim().toUpperCase();
  if (u === 'PASS') return true;
  if (u === 'FAIL') return false;
  return fallback;
}

export function applySafetyToItems(items: SrDraftItem[], safety: SafetyValues): SrDraftItem[] {
  return items.map((item) => {
    if (item.section !== 'safety') return item;
    if (item.slug === SAFETY_GROUND_SLUG || /ground resistance/i.test(item.label)) {
      const n = safety.ground_resistance === '' ? null : safety.ground_resistance ?? null;
      return {
        ...item,
        value_numeric: n,
        result: boolToResult(safety.ground_resistance_pass),
        unit: item.unit || 'Ω',
      };
    }
    if (item.slug === SAFETY_LEAKAGE_SLUG || /leakage current/i.test(item.label)) {
      const n = safety.leakage_current === '' ? null : safety.leakage_current ?? null;
      return {
        ...item,
        value_numeric: n,
        result: boolToResult(safety.leakage_current_pass),
        unit: item.unit || 'µA',
      };
    }
    return item;
  });
}

function boolToResult(pass: boolean | null | undefined): string {
  if (pass === true) return 'PASS';
  if (pass === false) return 'FAIL';
  return '';
}

export function hydrateItemsFromLegacy(
  templateItems: SrDraftItem[],
  checklists: Partial<LegacyChecklists> | null | undefined,
  extras?: SrDraftItem[]
): SrDraftItem[] {
  const maps = {
    electrical: checklists?.electrical || {},
    mechanical: checklists?.mechanical || {},
    aesthetic: checklists?.aesthetic || {},
  };
  const used = new Set<string>();
  const hydrated = templateItems.map((item) => {
    if (!isChecklistSection(item.section)) return item;
    const map = maps[item.section];
    if (item.label in map) {
      used.add(`${item.section}::${item.label}`);
      return { ...item, result: map[item.label] || '' };
    }
    return item;
  });

  const leftover: SrDraftItem[] = [];
  let extraOrder = 9000;
  for (const section of SR_CHECKLIST_SECTIONS) {
    for (const [label, result] of Object.entries(maps[section])) {
      if (used.has(`${section}::${label}`)) continue;
      leftover.push({
        key: `legacy-extra:${section}:${slugFromLabel(label)}`,
        element_id: null,
        slug: null,
        section,
        label,
        result: result || '',
        value_numeric: null,
        unit: null,
        input_kind: 'pass_fail_na',
        is_extra: true,
        sort_order: extraOrder++,
      });
    }
  }

  return [...hydrated, ...leftover, ...(extras || [])];
}

export function itemsFromPersistedRows(
  rows: Array<Record<string, any>>,
  libraryById?: Map<string, SrElement>
): SrDraftItem[] {
  return (rows || []).map((row, i) => {
    const el = row.element_id && libraryById ? libraryById.get(row.element_id) : undefined;
    const section = normalizeSrSection(row.section, el?.section || 'mechanical');
    const sectionLabel = row.section_label ? String(row.section_label) : null;
    return {
      key: row.id || `row:${i}:${row.label}`,
      id: row.id || null,
      element_id: row.element_id || null,
      slug: el?.slug || null,
      section,
      label: row.label || el?.label || 'Item',
      result: row.result || '',
      value_numeric: row.value_numeric == null || row.value_numeric === '' ? null : Number(row.value_numeric),
      unit: row.unit ?? el?.unit ?? null,
      spec_hint: el?.spec_hint ?? null,
      input_kind: el?.input_kind === 'numeric' || section === 'safety' ? 'numeric' : 'pass_fail_na',
      is_extra: !!row.is_extra,
      sort_order: row.sort_order ?? (i + 1) * 10,
      ...(sectionLabel ? { section_label: sectionLabel } : {}),
    };
  });
}

export function unusedLibraryElements(
  library: SrElement[],
  items: SrDraftItem[],
  equipmentType?: string | null
): SrElement[] {
  const usedIds = new Set(items.map((i) => i.element_id).filter(Boolean) as string[]);
  const usedLabels = new Set(items.map((i) => `${i.section}::${i.label}`));
  return library.filter((el) => {
    if (el.section === 'safety') return false;
    if (el.is_active === false) return false;
    // Type-specific starter elements only show for their own type.
    if (equipmentType && el.equipment_type && el.equipment_type !== equipmentType) return false;
    if (el.id && usedIds.has(el.id)) return false;
    if (usedLabels.has(`${el.section}::${el.label}`)) return false;
    return true;
  });
}

export function addLibraryElement(
  items: SrDraftItem[],
  element: SrElement
): SrDraftItem[] {
  const [added] = assembleDraftItems([element], {
    isExtra: true,
    startOrder: nextSortOrder(items, normalizeSrSection(element.section)),
  });
  if (!added) return items;
  added.is_extra = true;
  return [...items, added];
}

export function addCustomElement(
  items: SrDraftItem[],
  label: string,
  section: SrSection,
  sectionLabel?: string | null
): SrDraftItem[] {
  const trimmed = String(label || '').trim();
  if (!trimmed) return items;
  const sec = isValidSectionKey(section) && section !== 'safety' ? section : 'mechanical';
  if (items.some((i) => i.section === sec && i.label === trimmed)) return items;
  const item: SrDraftItem = {
    key: `custom:${sec}:${slugFromLabel(trimmed)}:${items.length}`,
    element_id: null,
    slug: null,
    section: sec,
    label: trimmed,
    result: '',
    value_numeric: null,
    unit: null,
    input_kind: 'pass_fail_na',
    is_extra: true,
    sort_order: nextSortOrder(items, sec),
    ...(sectionLabel && !isChecklistSection(sec) ? { section_label: String(sectionLabel).trim() } : {}),
  };
  return [...items, item];
}

export function removeExtraItem(items: SrDraftItem[], key: string): SrDraftItem[] {
  return items.filter((i) => !(i.is_extra && i.key === key));
}

/**
 * Remove a line. Extras can always go; template lines only when the template
 * is an editable default (starter checklists). Safety rows never.
 */
export function removeItem(items: SrDraftItem[], key: string, opts: { editable: boolean }): SrDraftItem[] {
  return items.filter((i) => {
    if (i.key !== key) return true;
    if (i.section === 'safety') return true;
    return !(i.is_extra || opts.editable);
  });
}

function nextSortOrder(items: SrDraftItem[], section: SrSection): number {
  const max = items.filter((i) => i.section === section).reduce((n, i) => Math.max(n, i.sort_order || 0), 0);
  return max + 10;
}

export function persistRowsFromItems(
  items: SrDraftItem[],
  opts: { service_report_id: string; organization_id: number | string | null }
): Array<Record<string, unknown>> {
  return items.map((item, i) => ({
    service_report_id: opts.service_report_id,
    organization_id: opts.organization_id,
    element_id: item.element_id && !String(item.element_id).startsWith('fallback:') ? item.element_id : null,
    section: item.section,
    label: item.label,
    result: item.result || null,
    value_numeric: item.value_numeric,
    unit: item.unit,
    is_extra: !!item.is_extra,
    sort_order: item.sort_order ?? (i + 1) * 10,
    // Only sent when set, so legacy-section saves work before 000945.
    ...(item.section_label ? { section_label: item.section_label } : {}),
  }));
}

export function laserFallbackForm(equipmentType?: string | null): LoadedSrForm {
  const requested = equipmentTypeOrDefault(equipmentType);
  const defaults = laserDefaultElements();
  return {
    template: LASER_FALLBACK_TEMPLATE,
    usedFallback: true,
    requestedType: requested,
    resolvedType: DEFAULT_EQUIPMENT_TYPE,
    elements: laserFallbackElements(),
    items: assembleDraftItems(defaults),
    sections: LASER_SECTIONS.map((s) => ({ ...s })),
    editable: false,
  };
}

/** In-memory element list for a starter template (same slugs as 000945). */
export function starterElements(template: StarterTemplate): SrElement[] {
  const out: SrElement[] = [];
  for (const section of template.sections) {
    section.items.forEach((item, i) => {
      out.push({
        id: `fallback:${section.key}:${item.slug}`,
        slug: item.slug,
        label: item.label,
        section: section.key,
        input_kind: item.input_kind === 'numeric' ? 'numeric' : 'pass_fail_na',
        unit: item.unit ?? null,
        spec_hint: item.spec_hint ?? null,
        is_active: true,
        sort_hint: (i + 1) * 10,
      });
    });
  }
  return out;
}

/**
 * Starter checklist for a non-laser type, used before 000945 is applied or
 * when the DB has no template for that type. Never the laser form.
 */
export function starterFallbackForm(equipmentType?: string | null): LoadedSrForm {
  const requested = equipmentTypeOrDefault(equipmentType);
  if (requested === DEFAULT_EQUIPMENT_TYPE) return laserFallbackForm(requested);
  const t = starterTemplateFor(requested);
  const elements = starterElements(t);
  return {
    template: {
      id: `fallback-${t.slug}`,
      slug: t.slug,
      name: t.name,
      equipment_type: t.equipment_type,
      status: 'published',
      is_default: true,
      notes: t.notes,
      editable_default: t.editable_default,
    },
    usedFallback: true,
    requestedType: requested,
    resolvedType: t.equipment_type === GENERAL_EQUIPMENT_TYPE ? requested : (t.equipment_type as EquipmentType),
    elements,
    items: assembleDraftItems(elements),
    sections: t.sections.map((s) => ({ key: s.key, label: s.label })),
    editable: t.editable_default,
  };
}

/** Fallback for a type: laser keeps the CL_* form, others get their starter. */
export function fallbackFormForType(equipmentType?: string | null): LoadedSrForm {
  return equipmentTypeOrDefault(equipmentType) === DEFAULT_EQUIPMENT_TYPE
    ? laserFallbackForm(equipmentType)
    : starterFallbackForm(equipmentType);
}

type SrClient = {
  from: (table: string) => any;
};

const ELEMENT_COLS = 'id, slug, label, section, input_kind, unit, spec_hint, is_active, sort_hint';
const TEMPLATE_COLS_LEGACY = 'id, slug, name, equipment_type, status, is_default, notes';
const TEMPLATE_COLS = `${TEMPLATE_COLS_LEGACY}, manufacturer, model, organization_id, editable_default`;

/** Column missing because 000945 is not applied yet (retry with old columns). */
export function isMissingSrColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  const m = `${error?.code || ''} ${error?.message || ''}`;
  return /42703|PGRST204|column .* does not exist|could not find .* column/i.test(m);
}

async function selectWithFallback(run: (cols: string) => any, cols: string, legacyCols: string) {
  const first = await run(cols);
  if (!first.error || !isMissingSrColumn(first.error)) return first;
  return run(legacyCols);
}

export async function loadPublishedLibrary(supabase: SrClient): Promise<SrElement[] | null> {
  const { data, error } = await selectWithFallback(
    (cols) => supabase.from('sr_elements').select(cols).eq('is_active', true).order('section').order('sort_hint'),
    `${ELEMENT_COLS}, equipment_type`,
    ELEMENT_COLS
  );
  if (error) {
    if (isMissingSrSchema(error)) return null;
    throw error;
  }
  return (data || []) as SrElement[];
}

/** Sections for a DB template; derived from its elements when the table is missing. */
async function loadTemplateSections(
  supabase: SrClient,
  template: SrTemplate,
  elements: SrElement[]
): Promise<SrSectionDef[]> {
  const isLaser = template.slug === LASER_PM_TEMPLATE_SLUG;
  const { data, error } = await supabase
    .from('sr_template_sections')
    .select('section_key, label, sort_order')
    .eq('template_id', template.id)
    .order('sort_order');
  let sections: SrSectionDef[] = [];
  if (!error && Array.isArray(data)) {
    sections = data
      .filter((r: any) => isValidSectionKey(r.section_key))
      .map((r: any) => ({ key: r.section_key, label: r.label || titleForSectionKey(r.section_key) }));
  } else if (error && !isMissingSrSchema(error)) {
    throw error;
  }
  if (!sections.length && isLaser) sections = LASER_SECTIONS.map((s) => ({ ...s }));
  const starter = starterTemplateFor(template.equipment_type);
  const starterLabels: Record<string, string> = {};
  for (const s of starter.sections) starterLabels[s.key] = s.label;
  const seen = new Set(sections.map((s) => s.key));
  for (const el of elements) {
    if (seen.has(el.section)) continue;
    seen.add(el.section);
    sections.push({
      key: el.section,
      label: isLaser ? titleForSectionKey(el.section) : titleForSectionKey(el.section, starterLabels),
    });
  }
  // Safety last, as on today's form.
  return [...sections.filter((s) => s.key !== 'safety'), ...sections.filter((s) => s.key === 'safety')];
}

export async function loadSrTemplateForEquipmentType(
  supabase: SrClient,
  equipmentType?: string | null,
  selection?: { manufacturer?: string | null; model?: string | null }
): Promise<LoadedSrForm> {
  const requested = equipmentTypeOrDefault(equipmentType);
  const fallback = fallbackFormForType(requested);

  const { data: templates, error: tmplErr } = await selectWithFallback(
    (cols) => supabase.from('sr_templates').select(cols).eq('status', 'published'),
    TEMPLATE_COLS,
    TEMPLATE_COLS_LEGACY
  );
  if (tmplErr) {
    if (isMissingSrSchema(tmplErr)) return fallback;
    throw tmplErr;
  }

  const picked = pickTemplateForEquipmentType((templates || []) as SrTemplate[], requested, selection);
  if (!picked) return fallback;

  const { data: links, error: linkErr } = await supabase
    .from('sr_template_elements')
    .select('element_id, sort_order')
    .eq('template_id', picked.id)
    .order('sort_order');
  if (linkErr) {
    if (isMissingSrSchema(linkErr)) return fallback;
    throw linkErr;
  }

  const ids = (links || []).map((r: any) => r.element_id).filter(Boolean);
  let elements: SrElement[] = [];
  if (ids.length) {
    const { data: els, error: elErr } = await supabase.from('sr_elements').select(ELEMENT_COLS).in('id', ids);
    if (elErr) {
      if (isMissingSrSchema(elErr)) return fallback;
      throw elErr;
    }
    const byId = new Map<string, SrElement>((els || []).map((el: SrElement) => [el.id, el]));
    elements = (links || [])
      .map((link: any) => {
        const el = byId.get(link.element_id);
        if (!el) return null;
        return { ...el, sort_hint: link.sort_order ?? el.sort_hint };
      })
      .filter(Boolean) as SrElement[];
  }

  if (!elements.length) return fallback;

  const template = picked as SrTemplate;
  const sections = await loadTemplateSections(supabase, template, elements);
  return {
    template,
    usedFallback: false,
    requestedType: requested,
    resolvedType:
      template.equipment_type === GENERAL_EQUIPMENT_TYPE ? requested : equipmentTypeOrDefault(template.equipment_type),
    elements,
    items: assembleDraftItems(elements),
    sections,
    editable: !!template.editable_default,
  };
}

export async function loadServiceReportItems(
  supabase: SrClient,
  reportId: string,
  library?: SrElement[] | null
): Promise<SrDraftItem[] | null> {
  const base = 'id, element_id, section, label, result, value_numeric, unit, is_extra, sort_order';
  const { data, error } = await selectWithFallback(
    (cols) => supabase.from('service_report_items').select(cols).eq('service_report_id', reportId).order('sort_order'),
    `${base}, section_label`,
    base
  );
  if (error) {
    if (isMissingSrSchema(error)) return null;
    throw error;
  }
  if (!data?.length) return [];
  const byId = new Map((library || []).map((el) => [el.id, el]));
  return itemsFromPersistedRows(data, byId);
}

function isSrLegacySection(v: unknown): boolean {
  return (SR_SECTIONS as readonly string[]).includes(String(v));
}

/** Insert rejected by the pre-000945 schema (section CHECK or section_label). */
export function isPreTemplateSchemaReject(error: { message?: string; code?: string } | null | undefined): boolean {
  const m = `${error?.code || ''} ${error?.message || ''}`;
  return /23514|service_report_items_section_check|section_label/i.test(m);
}

export async function replaceServiceReportItems(
  supabase: SrClient,
  opts: { reportId: string; organizationId: number | string | null; items: SrDraftItem[] }
): Promise<{ ok: true } | { ok: false; skipped: true } | { ok: false; error: Error }> {
  const del = await supabase.from('service_report_items').delete().eq('service_report_id', opts.reportId);
  if (del.error) {
    if (isMissingSrSchema(del.error)) return { ok: false, skipped: true };
    return { ok: false, error: new Error(del.error.message) };
  }
  const rows = persistRowsFromItems(opts.items, {
    service_report_id: opts.reportId,
    organization_id: opts.organizationId,
  });
  if (!rows.length) return { ok: true };
  const ins = await supabase.from('service_report_items').insert(rows);
  if (ins.error && isPreTemplateSchemaReject(ins.error)) {
    // 000945 not applied: the old CHECK only allows the four legacy sections and
    // section_label does not exist. Keep the legacy rows; the legacy JSON still
    // carries those answers. Non-legacy sections are skipped (deploy DB first).
    const legacyRows = rows
      .filter((r) => isSrLegacySection(r.section))
      .map(({ section_label: _drop, ...rest }) => rest);
    if (legacyRows.length) await supabase.from('service_report_items').insert(legacyRows);
    return { ok: false, skipped: true };
  }
  if (ins.error) {
    if (isMissingSrSchema(ins.error)) return { ok: false, skipped: true };
    return { ok: false, error: new Error(ins.error.message) };
  }
  return { ok: true };
}

