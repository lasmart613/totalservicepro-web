import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CL_AESTHETIC, CL_ELECTRICAL, CL_MECHANICAL } from './models.ts';
import {
  addCustomElement,
  addLibraryElement,
  applyChecklistMap,
  applySafetyToItems,
  assembleDraftItems,
  hydrateItemsFromLegacy,
  isMissingSrSchema,
  itemsToLegacyChecklists,
  keepExtras,
  labelsForSection,
  laserDefaultElements,
  laserFallbackElements,
  laserFallbackForm,
  LASER_LIBRARY_EXTRAS,
  LASER_PM_TEMPLATE_SLUG,
  loadSrTemplateForEquipmentType,
  mergeResultsIntoItems,
  persistRowsFromItems,
  pickTemplateForEquipmentType,
  removeExtraItem,
  replaceServiceReportItems,
  SAFETY_GROUND_SLUG,
  SAFETY_LEAKAGE_SLUG,
  safetyFromItems,
  unusedLibraryElements,
} from './service-report-elements.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('laser fallback seeds current CL_* plus safety as today', () => {
  const els = laserDefaultElements();
  assert.deepEqual(
    els.filter((e) => e.section === 'electrical').map((e) => e.label),
    [...CL_ELECTRICAL]
  );
  assert.deepEqual(
    els.filter((e) => e.section === 'mechanical').map((e) => e.label),
    [...CL_MECHANICAL]
  );
  assert.deepEqual(
    els.filter((e) => e.section === 'aesthetic').map((e) => e.label),
    [...CL_AESTHETIC]
  );
  const safety = els.filter((e) => e.section === 'safety');
  assert.equal(safety.length, 2);
  assert.equal(safety[0].slug, SAFETY_GROUND_SLUG);
  assert.equal(safety[0].input_kind, 'numeric');
  assert.equal(safety[0].unit, 'Ω');
  assert.equal(safety[1].slug, SAFETY_LEAKAGE_SLUG);
  assert.equal(safety[1].unit, 'µA');
});

test('template lookup uses equipment_type and falls back to laser', () => {
  const templates = [
    { slug: 'laser-pm-default', equipment_type: 'laser', is_default: true, status: 'published' },
    { slug: 'c-arm-draft', equipment_type: 'c_arm', is_default: true, status: 'draft' },
  ];
  assert.equal(pickTemplateForEquipmentType(templates, 'laser')?.slug, 'laser-pm-default');
  assert.equal(pickTemplateForEquipmentType(templates, 'ventilator')?.slug, 'laser-pm-default');
  assert.equal(pickTemplateForEquipmentType(templates, 'other')?.slug, 'laser-pm-default');
  assert.equal(pickTemplateForEquipmentType(templates, 'c_arm')?.slug, 'laser-pm-default');
});

test('dual-write maps extras into the matching checklist_* JSON', () => {
  const form = laserFallbackForm('laser');
  let items = applyChecklistMap(form.items, 'electrical', {
    'Power Cord & Plug integrity': 'PASS',
  });
  items = addCustomElement(items, 'Interlock jumper continuity', 'electrical');
  items = applyChecklistMap(items, 'electrical', {
    'Power Cord & Plug integrity': 'PASS',
    'Interlock jumper continuity': 'FAIL',
  });
  const json = itemsToLegacyChecklists(items);
  assert.equal(json.electrical['Power Cord & Plug integrity'], 'PASS');
  assert.equal(json.electrical['Interlock jumper continuity'], 'FAIL');
  assert.ok(keepExtras(items).some((i) => i.label === 'Interlock jumper continuity' && i.is_extra));
  assert.equal(labelsForSection(items, 'electrical').includes('Interlock jumper continuity'), true);
});

test('legacy checklist JSON hydrates extras that were not on the default form', () => {
  const form = laserFallbackForm();
  const items = hydrateItemsFromLegacy(form.items, {
    electrical: {
      'Power Cord & Plug integrity': 'N/A',
      'Shop-only HV interlock': 'PASS',
    },
    mechanical: {},
    aesthetic: {},
  });
  const extra = items.find((i) => i.label === 'Shop-only HV interlock');
  assert.ok(extra);
  assert.equal(extra?.is_extra, true);
  assert.equal(extra?.section, 'electrical');
  assert.equal(extra?.result, 'PASS');
  assert.equal(items.find((i) => i.label === 'Power Cord & Plug integrity')?.result, 'N/A');
});

test('safety dual-write keeps numeric columns + PASS/FAIL', () => {
  const form = laserFallbackForm();
  const items = applySafetyToItems(form.items, {
    ground_resistance: 0.12,
    leakage_current: 410,
    ground_resistance_pass: true,
    leakage_current_pass: false,
  });
  const safety = safetyFromItems(items);
  assert.equal(safety.ground_resistance, 0.12);
  assert.equal(safety.leakage_current, 410);
  assert.equal(safety.ground_resistance_pass, true);
  assert.equal(safety.leakage_current_pass, false);
  const rows = persistRowsFromItems(items, { service_report_id: 'rep-1', organization_id: 4 });
  const ground = rows.find((r) => r.label === 'Ground Resistance');
  assert.equal(ground?.section, 'safety');
  assert.equal(ground?.value_numeric, 0.12);
  assert.equal(ground?.result, 'PASS');
  assert.equal(ground?.is_extra, false);
});

test('library add marks is_extra; custom is one-off without element_id', () => {
  const form = laserFallbackForm();
  const unused = unusedLibraryElements(form.elements, form.items);
  assert.ok(unused.some((e) => e.slug === 'door-interlock'));
  assert.ok(LASER_LIBRARY_EXTRAS.every((e) => unused.some((u) => u.slug === e.slug)));
  assert.ok(!unused.some((e) => e.label === CL_ELECTRICAL[0]));
  const extraEl = unused.find((e) => e.slug === 'door-interlock');
  assert.ok(extraEl);

  let items = addLibraryElement(form.items, extraEl!);
  items = addCustomElement(items, 'Customer-specific handpiece boot', 'aesthetic');
  const extras = keepExtras(items);
  assert.equal(extras.length, 2);
  assert.equal(extras.find((i) => i.label === extraEl!.label)?.element_id, extraEl!.id);
  assert.equal(extras.find((i) => i.label === extraEl!.label)?.is_extra, true);
  assert.equal(extras.find((i) => i.label === 'Customer-specific handpiece boot')?.element_id, null);
  items = removeExtraItem(items, extras[0].key);
  assert.equal(keepExtras(items).length, 1);
});

test('changing device-type template keeps prior answers on matching labels', () => {
  const first = assembleDraftItems(laserDefaultElements());
  const answered = applyChecklistMap(first, 'electrical', {
    'Key Switch test': 'FAIL',
  });
  const second = mergeResultsIntoItems(assembleDraftItems(laserDefaultElements()), answered);
  assert.equal(second.find((i) => i.label === 'Key Switch test')?.result, 'FAIL');
});

test('missing SR tables are treated as unapplied migration, not a hard save failure', () => {
  assert.equal(isMissingSrSchema({ message: "Could not find the table 'public.sr_templates' in the schema cache" }), true);
  assert.equal(isMissingSrSchema({ message: 'column service_report_items does not exist' }), true);
  assert.equal(isMissingSrSchema({ message: 'permission denied for table service_reports' }), false);
});

test('loadSrTemplateForEquipmentType falls back when PostgREST has no tables yet', async () => {
  const supabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({
                data: null,
                error: { message: "Could not find the table 'public.sr_templates' in the schema cache" },
              });
            },
          };
        },
      };
    },
  };
  const loaded = await loadSrTemplateForEquipmentType(supabase as any, 'ventilator');
  assert.equal(loaded.usedFallback, true);
  assert.equal(loaded.resolvedType, 'laser');
  assert.equal(loaded.template?.slug, LASER_PM_TEMPLATE_SLUG);
  assert.deepEqual(labelsForSection(loaded.items, 'electrical'), [...CL_ELECTRICAL]);
});

test('replaceServiceReportItems deletes then inserts; skips when table missing', async () => {
  const calls: string[] = [];
  const supabase = {
    from(table: string) {
      calls.push(table);
      return {
        delete() {
          return {
            eq() {
              return Promise.resolve({
                error: { message: "Could not find the table 'public.service_report_items' in the schema cache" },
              });
            },
          };
        },
        insert() {
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  const result = await replaceServiceReportItems(supabase as any, {
    reportId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    organizationId: 4,
    items: laserFallbackForm().items,
  });
  assert.deepEqual(result, { ok: false, skipped: true });
  assert.deepEqual(calls, ['service_report_items']);
});

test('migration seeds library + laser template and documents Larry apply step', () => {
  const sql = readFileSync(
    join(here, '../supabase/migrations/20260914_000002_service_report_elements.sql'),
    'utf8'
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.sr_elements/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.sr_templates/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.sr_template_elements/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.service_report_items/);
  assert.match(sql, /is_extra boolean NOT NULL DEFAULT false/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS equipment_type text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS sr_template_id uuid/);
  assert.match(sql, /laser-pm-default/);
  assert.match(sql, /Power Cord & Plug integrity/);
  assert.match(sql, /Aiming Beam brightness/);
  assert.match(sql, /Condition of Skins/);
  assert.match(sql, /ground-resistance/);
  assert.match(sql, /leakage-current/);
  assert.match(sql, /door-interlock/);
  assert.match(sql, /fiber-handpiece/);
  assert.match(sql, /warning-labels/);
  assert.match(sql, /APPLY ON LIVE SUPABASE/);
  assert.match(sql, /does not auto-apply/);
  assert.match(sql, /can_view_service_report_for_history/);
  assert.match(sql, /get_my_org_id/);
  assert.doesNotMatch(sql, /DELETE FROM public\.organizations/);
  assert.doesNotMatch(sql, /TRUNCATE/);
});

test('reports/new loads template by equipment_type and dual-writes extras', () => {
  const form = readFileSync(join(here, '../app/reports/new/NewServiceReportClient.tsx'), 'utf8');
  assert.match(form, /loadSrTemplateForEquipmentType/);
  assert.match(form, /replaceServiceReportItems/);
  assert.match(form, /equipment_type|equipmentType/);
  assert.match(form, /is_extra|addCustomElement|addLibraryElement/);
  assert.match(form, /checklist_electrical/);
  assert.match(form, /itemsToLegacyChecklists|checklist_electrical/);
  assert.doesNotMatch(form, /adsense|gtag\(|pagead/i);
});
