import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CL_AESTHETIC, CL_ELECTRICAL, CL_MECHANICAL } from './models.ts';
import {
  checklistSectionsJson,
  customSectionKey,
  displaySectionsForReport,
  EXISTING_ELEMENT_SLUGS,
  isValidSectionKey,
  LEGACY_SECTION_TITLES,
  orderedSections,
  resolveTemplate,
  STARTER_TEMPLATES,
  starterSeedValues,
  starterTemplateFor,
  templateMatchScore,
} from './service-report-templates.ts';
import {
  addCustomElement,
  fallbackFormForType,
  laserFallbackForm,
  removeItem,
  unusedLibraryElements,
} from './service-report-elements.ts';
import { EQUIPMENT_TYPES } from './equipment-types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const LASER_ONLY = new Set(['Optics inspected & cleaned', 'Coolant flushed & topped off', 'Aiming Beam brightness', 'DI & Coolant Filters changed']);

test('every non-laser equipment type has an editable starter with safety last and no laser items', () => {
  for (const { value } of EQUIPMENT_TYPES) {
    if (value === 'laser') continue;
    const t = starterTemplateFor(value);
    assert.equal(t.equipment_type, value, `starter for ${value}`);
    assert.equal(t.editable_default, true);
    assert.equal(t.slug, `${value.replace(/_/g, '-')}-pm-default`);
    assert.equal(t.sections.at(-1)?.key, 'safety');
    for (const s of t.sections) {
      assert.ok(isValidSectionKey(s.key), s.key);
      for (const item of s.items) assert.ok(!LASER_ONLY.has(item.label), `${value} carries ${item.label}`);
    }
  }
  assert.equal(starterTemplateFor('nope-type').equipment_type, 'general');
  assert.equal(STARTER_TEMPLATES.length, 12);
  const slugs = STARTER_TEMPLATES.flatMap((t) => t.sections.flatMap((s) => s.items.map((i) => `${t.slug}:${i.slug}`)));
  assert.equal(new Set(slugs).size, slugs.length, 'no duplicate items within a template');
});

test('beds starter is a bed checklist', () => {
  const beds = starterTemplateFor('beds');
  assert.deepEqual(beds.sections.map((s) => s.key), ['electrical', 'motion', 'mechanical', 'aesthetic', 'safety']);
});

test('laser form is unchanged (CL_* + safety, legacy titles, not editable)', () => {
  const form = laserFallbackForm('laser');
  assert.equal(form.editable, false);
  assert.deepEqual(form.sections.map((s) => s.label), Object.values(LEGACY_SECTION_TITLES));
  assert.deepEqual(form.items.filter((i) => i.section === 'electrical').map((i) => i.label), [...CL_ELECTRICAL]);
  assert.deepEqual(form.items.filter((i) => i.section === 'mechanical').map((i) => i.label), [...CL_MECHANICAL]);
  assert.deepEqual(form.items.filter((i) => i.section === 'aesthetic').map((i) => i.label), [...CL_AESTHETIC]);
  assert.equal(checklistSectionsJson(form.items, form.sections), null);
});

test('fallbackFormForType gives starters for non-laser types', () => {
  const beds = fallbackFormForType('beds');
  assert.equal(beds.template?.slug, 'beds-pm-default');
  assert.equal(beds.editable, true);
  assert.ok(beds.items.some((i) => i.section === 'motion'));
  assert.ok(!beds.items.some((i) => LASER_ONLY.has(i.label)));
});

test('cascade: type -> manufacturer -> model, most specific wins, org beats platform', () => {
  const ts = [
    { slug: 'laser', equipment_type: 'laser', is_default: true, status: 'published' },
    { slug: 'beds', equipment_type: 'beds', is_default: true, status: 'published' },
    { slug: 'beds-hill', equipment_type: 'beds', manufacturer: 'Hill-Rom', is_default: true, status: 'published' },
    { slug: 'beds-hill-m', equipment_type: 'beds', manufacturer: 'Hill-Rom', model: 'P1900', is_default: true, status: 'published' },
    { slug: 'beds-org', equipment_type: 'beds', organization_id: 5, is_default: true, status: 'published' },
    { slug: 'beds-draft', equipment_type: 'beds', manufacturer: 'Stryker', status: 'draft' },
    { slug: 'general', equipment_type: 'general', is_default: true, status: 'published' },
  ];
  assert.equal(resolveTemplate(ts, { equipmentType: 'beds' })?.slug, 'beds-org');
  assert.equal(resolveTemplate(ts, { equipmentType: 'beds', manufacturer: 'hill-rom' })?.slug, 'beds-hill');
  assert.equal(resolveTemplate(ts, { equipmentType: 'beds', manufacturer: 'Hill-Rom', model: 'p1900' })?.slug, 'beds-hill-m');
  assert.equal(resolveTemplate(ts, { equipmentType: 'beds', manufacturer: 'Stryker' })?.slug, 'beds-org');
  assert.equal(resolveTemplate(ts, { equipmentType: 'ventilator' })?.slug, 'general');
  assert.equal(resolveTemplate(ts.slice(1), { equipmentType: 'laser' }), null);
  assert.equal(templateMatchScore(ts[2], { equipmentType: 'beds' }), -1);
});

test('custom sections and items; removal rules', () => {
  const form = fallbackFormForType('beds');
  const key = customSectionKey('Hydraulics & Lift')!;
  assert.equal(key, 'custom_hydraulics_and_lift');
  let items = addCustomElement(form.items, 'Pump seal', key, 'Hydraulics & Lift');
  const added = items.find((i) => i.label === 'Pump seal')!;
  assert.equal(added.section_label, 'Hydraulics & Lift');
  const sections = orderedSections(items, form.sections);
  assert.ok(sections.some((s) => s.key === key && s.label === 'Hydraulics & Lift'));
  const json = checklistSectionsJson(items, sections)!;
  assert.ok(json.find((s) => s.key === 'motion'));
  assert.ok(!json.find((s) => s.key === 'safety'));
  assert.deepEqual(json.find((s) => s.key === key)?.items, [{ label: 'Pump seal', result: '' }]);

  const templateLine = items.find((i) => i.section === 'motion')!;
  assert.equal(removeItem(items, templateLine.key, { editable: true }).length, items.length - 1);
  assert.equal(removeItem(items, templateLine.key, { editable: false }).length, items.length);
  const safety = items.find((i) => i.section === 'safety')!;
  assert.equal(removeItem(items, safety.key, { editable: true }).length, items.length);
  items = removeItem(items, added.key, { editable: false });
  assert.ok(!items.some((i) => i.label === 'Pump seal'));
});

test('library hides other types\' elements', () => {
  const lib = [
    { id: '1', slug: 'a', label: 'A', section: 'electrical', equipment_type: null },
    { id: '2', slug: 'b', label: 'B', section: 'motion', equipment_type: 'beds' },
    { id: '3', slug: 'c', label: 'C', section: 'imaging', equipment_type: 'c_arm' },
  ] as any[];
  assert.deepEqual(unusedLibraryElements(lib, [], 'beds').map((e) => e.slug), ['a', 'b']);
});

test('displaySectionsForReport: legacy maps unchanged, checklist_sections when present', () => {
  const legacy = {
    checklist_electrical: { Display: 'PASS' },
    checklist_mechanical: {},
    checklist_aesthetic: { Skins: 'N/A' },
  };
  assert.deepEqual(displaySectionsForReport(legacy, ['E', 'M', 'A']), [
    { title: 'E', rows: { Display: 'PASS' } },
    { title: 'A', rows: { Skins: 'N/A' } },
  ]);
  const modular = {
    ...legacy,
    checklist_sections: JSON.stringify([{ key: 'motion', label: 'Motion', items: [{ label: 'Hi/lo', result: 'PASS' }] }]),
  };
  assert.deepEqual(displaySectionsForReport(modular, ['E', 'M', 'A']), [{ title: 'Motion', rows: { 'Hi/lo': 'PASS' } }]);
});

test('000945 migration seed matches STARTER_TEMPLATES exactly', () => {
  const sql = readFileSync(
    join(here, '../supabase/migrations/20261025_000945_service_report_type_templates.sql'),
    'utf8'
  );
  const block = sql.split('-- BEGIN STARTER SEED\n')[1]?.split('\n-- END STARTER SEED')[0];
  assert.ok(block, 'seed markers present');
  assert.equal(block, starterSeedValues().join(',\n'));
  for (const slug of EXISTING_ELEMENT_SLUGS) assert.ok(!block.includes(`'${slug}', '`) || /NULL\)/.test(block));
  const rb = readFileSync(
    join(here, '../supabase/migrations/20261025_000945_service_report_type_templates_rollback.sql'),
    'utf8'
  );
  assert.match(rb, /sr_templates_one_default_per_type/);
  assert.match(sql, /lock_timeout = '5s'/);
});
