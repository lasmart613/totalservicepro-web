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

export const SR_SECTIONS = ['electrical', 'mechanical', 'aesthetic', 'safety'] as const;
export type SrSection = (typeof SR_SECTIONS)[number];

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
};

export type SrTemplate = {
  id: string;
  slug: string;
  name: string;
  equipment_type: string;
  status: string;
  is_default: boolean;
  notes?: string | null;
};

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
};

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
  return SR_SECTIONS.includes(String(value) as SrSection);
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

export function pickTemplateForEquipmentType<T extends { equipment_type?: string | null; is_default?: boolean; status?: string }>(
  templates: T[],
  equipmentType: string | null | undefined
): T | null {
  const requested = equipmentTypeOrDefault(equipmentType);
  const published = templates.filter((t) => !t.status || t.status === 'published');
  const exactDefault = published.find((t) => t.equipment_type === requested && t.is_default);
  if (exactDefault) return exactDefault;
  const exact = published.find((t) => t.equipment_type === requested);
  if (exact) return exact;
  const laserDefault = published.find((t) => t.equipment_type === DEFAULT_EQUIPMENT_TYPE && t.is_default);
  if (laserDefault) return laserDefault;
  return published.find((t) => t.equipment_type === DEFAULT_EQUIPMENT_TYPE) || published[0] || null;
}

function sortKey(item: { section: SrSection; sort_order?: number; label?: string }): string {
  const sectionRank = SR_SECTIONS.indexOf(item.section);
  const order = item.sort_order ?? 0;
  return `${String(sectionRank).padStart(2, '0')}:${String(order).padStart(5, '0')}:${item.label || ''}`;
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
      input_kind: el.input_kind === 'numeric' ? 'numeric' : 'pass_fail_na',
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

export function labelsForSection(items: SrDraftItem[], section: SrChecklistSection): string[] {
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
    };
  });
}

export function unusedLibraryElements(library: SrElement[], items: SrDraftItem[]): SrElement[] {
  const usedIds = new Set(items.map((i) => i.element_id).filter(Boolean) as string[]);
  const usedLabels = new Set(items.map((i) => `${i.section}::${i.label}`));
  return library.filter((el) => {
    if (el.section === 'safety') return false;
    if (el.is_active === false) return false;
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
  section: SrSection
): SrDraftItem[] {
  const trimmed = String(label || '').trim();
  if (!trimmed) return items;
  const sec = isChecklistSection(section) ? section : 'mechanical';
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
  };
  return [...items, item];
}

export function removeExtraItem(items: SrDraftItem[], key: string): SrDraftItem[] {
  return items.filter((i) => !(i.is_extra && i.key === key));
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
  };
}

type SrClient = {
  from: (table: string) => any;
};

export async function loadPublishedLibrary(supabase: SrClient): Promise<SrElement[] | null> {
  const { data, error } = await supabase
    .from('sr_elements')
    .select('id, slug, label, section, input_kind, unit, spec_hint, is_active, sort_hint')
    .eq('is_active', true)
    .order('section')
    .order('sort_hint');
  if (error) {
    if (isMissingSrSchema(error)) return null;
    throw error;
  }
  return (data || []) as SrElement[];
}

export async function loadSrTemplateForEquipmentType(
  supabase: SrClient,
  equipmentType?: string | null
): Promise<LoadedSrForm> {
  const requested = equipmentTypeOrDefault(equipmentType);
  const fallback = laserFallbackForm(requested);

  const { data: templates, error: tmplErr } = await supabase
    .from('sr_templates')
    .select('id, slug, name, equipment_type, status, is_default, notes')
    .eq('status', 'published');
  if (tmplErr) {
    if (isMissingSrSchema(tmplErr)) return fallback;
    throw tmplErr;
  }

  const picked = pickTemplateForEquipmentType(templates || [], requested);
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
    const { data: els, error: elErr } = await supabase
      .from('sr_elements')
      .select('id, slug, label, section, input_kind, unit, spec_hint, is_active, sort_hint')
      .in('id', ids);
    if (elErr) {
      if (isMissingSrSchema(elErr)) return fallback;
      throw elErr;
    }
    const byId = new Map((els || []).map((el: SrElement) => [el.id, el]));
    elements = (links || [])
      .map((link: any) => {
        const el = byId.get(link.element_id);
        if (!el) return null;
        return { ...el, sort_hint: link.sort_order ?? el.sort_hint };
      })
      .filter(Boolean) as SrElement[];
  }

  if (!elements.length) return fallback;

  return {
    template: picked as SrTemplate,
    usedFallback: false,
    requestedType: requested,
    resolvedType: equipmentTypeOrDefault(picked.equipment_type),
    elements,
    items: assembleDraftItems(elements),
  };
}

export async function loadServiceReportItems(
  supabase: SrClient,
  reportId: string,
  library?: SrElement[] | null
): Promise<SrDraftItem[] | null> {
  const { data, error } = await supabase
    .from('service_report_items')
    .select('id, element_id, section, label, result, value_numeric, unit, is_extra, sort_order')
    .eq('service_report_id', reportId)
    .order('sort_order');
  if (error) {
    if (isMissingSrSchema(error)) return null;
    throw error;
  }
  if (!data?.length) return [];
  const byId = new Map((library || []).map((el) => [el.id, el]));
  return itemsFromPersistedRows(data, byId);
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
  if (ins.error) {
    if (isMissingSrSchema(ins.error)) return { ok: false, skipped: true };
    return { ok: false, error: new Error(ins.error.message) };
  }
  return { ok: true };
}

