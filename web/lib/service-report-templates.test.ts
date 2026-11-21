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
  reportHeaderTagline,
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
  detectTemplateSchema,
  LASER_LIBRARY_EXTRAS,
  laserFallbackElements,
  replaceServiceReportItems,
  removeItem,
  sectionsLostWithoutTemplateSchema,
  unusedLibraryElements,
} from './service-report-elements.ts';
import { EQUIPMENT_TYPES } from './equipment-types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const LASER_ONLY = new Set(['Optics inspected & cleaned', 'Coolant flushed & topped off', 'Aiming Beam brightness', 'DI & Coolant Filters changed']);

test('every non-laser equipment type has an editable starter with safety last and no laser items', () => {
  for (const { value } of EQUIPMENT_TYPES) {
    if (value === 'laser') continue;
    const t = starterTemplateFor(value);
    // No dedicated HV checklist yet: the general PM, never the laser form.
    const expectedType = value === 'hv_power_supply' ? 'general' : value;
    const expectedSlug = value === 'hv_power_supply' ? 'general-pm-default' : `${value.replace(/_/g, '-')}-pm-default`;
    assert.equal(t.equipment_type, expectedType, `starter for ${value}`);
    assert.equal(t.editable_default, true);
    assert.equal(t.slug, expectedSlug);
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
    { id: '1', slug: 'display', label: 'A', section: 'electrical', equipment_type: null },
    { id: '2', slug: 'b', label: 'B', section: 'motion', equipment_type: 'beds' },
    { id: '3', slug: 'c', label: 'C', section: 'imaging', equipment_type: 'c_arm' },
  ] as any[];
  assert.deepEqual(unusedLibraryElements(lib, [], 'beds').map((e) => e.slug), ['display', 'b']);
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

test('beds "+ Add from library" offers no laser items, even on a pre-000945 library', () => {
  // Pre-000945 prod library: every element NULL-typed, incl. laser-only lines.
  const legacyLib = laserFallbackElements().map((e) => ({ ...e, equipment_type: null }));
  const beds = fallbackFormForType('beds');
  const offered = unusedLibraryElements(legacyLib, beds.items, 'beds');
  const laserLabels = new Set([...CL_ELECTRICAL, ...CL_MECHANICAL, ...CL_AESTHETIC, ...LASER_LIBRARY_EXTRAS.map((e) => e.label)]);
  const sharedLaserLabels = new Set(legacyLib.filter((e) => EXISTING_ELEMENT_SLUGS.has(e.slug)).map((e) => e.label));
  for (const el of offered) {
    assert.ok(!laserLabels.has(el.label) || sharedLaserLabels.has(el.label), `laser item offered on beds: ${el.label}`);
  }
  for (const slug of ['door-interlock', 'fiber-handpiece']) assert.ok(!offered.some((e) => e.slug === slug), slug);
  for (const label of ['Optics inspected & cleaned', 'Aiming Beam brightness']) {
    assert.ok(!offered.some((e) => e.label === label), label);
  }
  // Template element ids are always offered (when not already on the form).
  const pinned = legacyLib.find((e) => e.slug === 'door-interlock')!;
  assert.ok(unusedLibraryElements(legacyLib, beds.items, 'beds', [pinned.id]).some((e) => e.id === pinned.id));
  // Laser keeps its full library.
  const laser = laserFallbackForm('laser');
  const laserOffered = unusedLibraryElements(legacyLib, laser.items, 'laser');
  assert.ok(LASER_LIBRARY_EXTRAS.every((e) => laserOffered.some((u) => u.slug === e.slug)));
});

test('sections lost without 000945: none for laser, template + custom ones otherwise', () => {
  const laser = laserFallbackForm('laser');
  assert.deepEqual(sectionsLostWithoutTemplateSchema(laser.items, laser.sections), []);
  const beds = fallbackFormForType('beds');
  const lost = sectionsLostWithoutTemplateSchema(beds.items, beds.sections);
  assert.ok(lost.length > 0);
  const motion = beds.sections.find((s) => !['electrical', 'mechanical', 'aesthetic', 'safety'].includes(s.key))!;
  assert.ok(lost.includes(motion.label));
  const withCustom = addCustomElement(laser.items, 'Boot', 'custom_lift');
  const lostCustom = sectionsLostWithoutTemplateSchema(
    withCustom.map((i) => (i.section === 'custom_lift' ? { ...i, section_label: 'Lift' } : i)),
    laser.sections
  );
  assert.deepEqual(lostCustom, ['Lift']);
});

function mockSupabase(opts: { rpcError?: { code?: string; message: string } | null; probeError?: any }) {
  const calls: string[] = [];
  const chain = (table: string) => {
    const q: any = {
      delete() { calls.push(`delete:${table}`); return q; },
      eq() { return Promise.resolve({ error: null }); },
      insert(rows: unknown[]) { calls.push(`insert:${table}:${rows.length}`); return Promise.resolve({ error: null }); },
      select() { return q; },
      limit() { return Promise.resolve({ error: opts.probeError ?? null, data: [] }); },
    };
    return q;
  };
  return {
    calls,
    client: {
      from: (t: string) => chain(t),
      rpc: (fn: string, args: any) => {
        calls.push(`rpc:${fn}:${args.p_items.length}`);
        return Promise.resolve({ error: opts.rpcError ?? null });
      },
    },
  };
}

test('report items save through the atomic RPC; legacy path only when the RPC is missing', async () => {
  const items = fallbackFormForType('beds').items.map((i) => ({ ...i, result: 'pass' }));
  const ok = mockSupabase({});
  assert.deepEqual(await replaceServiceReportItems(ok.client, { reportId: 'r1', organizationId: 11, items }), { ok: true });
  assert.deepEqual(ok.calls, [`rpc:replace_service_report_items:${items.length}`], 'no delete-all when the RPC exists');

  const failed = mockSupabase({ rpcError: { code: 'P0945', message: 'safety rows cannot be deleted' } });
  const res = await replaceServiceReportItems(failed.client, { reportId: 'r1', organizationId: 11, items });
  assert.equal(res.ok, false);
  assert.ok(!failed.calls.some((c) => c.startsWith('delete')), 'RPC failure must not fall back to delete-all');

  const missing = mockSupabase({ rpcError: { code: 'PGRST202', message: 'Could not find the function public.replace_service_report_items' } });
  await replaceServiceReportItems(missing.client, { reportId: 'r1', organizationId: 11, items });
  assert.ok(missing.calls.includes('delete:service_report_items'), 'pre-000945 legacy path');
});

test('detectTemplateSchema: applied, missing, unknown', async () => {
  assert.equal(await detectTemplateSchema(mockSupabase({}).client), true);
  assert.equal(
    await detectTemplateSchema(mockSupabase({ probeError: { code: 'PGRST205', message: "Could not find the table 'public.sr_template_sections' in the schema cache" } }).client),
    false
  );
  assert.equal(await detectTemplateSchema(mockSupabase({ probeError: { message: 'fetch failed' } }).client), null);
});

test('high voltage power supply uses the general checklist, not the laser form', () => {
  const form = fallbackFormForType('hv_power_supply');
  assert.equal(form.template?.slug, 'general-pm-default');
  assert.equal(form.template?.equipment_type, 'general');
  assert.notEqual(form.template?.slug, 'laser-pm-default');
  assert.equal(reportHeaderTagline('hv_power_supply'), 'High Voltage Power Supply Service');
  assert.equal(
    resolveTemplate(
      [
        { slug: 'general', equipment_type: 'general', is_default: true, status: 'published' },
        { slug: 'laser', equipment_type: 'laser', is_default: true, status: 'published' },
      ],
      { equipmentType: 'hv_power_supply' }
    )?.slug,
    'general'
  );
});

test('report header uses the equipment type for non-laser reports', () => {
  assert.equal(reportHeaderTagline('laser'), undefined);
  assert.equal(reportHeaderTagline(null), undefined);
  assert.match(reportHeaderTagline('beds')!, /^Beds.* Service$/);
  assert.equal(reportHeaderTagline('ventilator'), 'Ventilator Service');
});

test('000945 safety trigger + RPC are SECURITY DEFINER, search_path \'\', org-checked, client-safe grants', () => {
  const sql = readFileSync(join(here, '../supabase/migrations/20261025_000945_service_report_type_templates.sql'), 'utf8');
  const rb = readFileSync(join(here, '../supabase/migrations/20261025_000945_service_report_type_templates_rollback.sql'), 'utf8');
  for (const fn of ['sr_items_keep_safety()', 'replace_service_report_items(p_report_id uuid, p_items jsonb)']) {
    const body = sql.slice(sql.indexOf(`CREATE FUNCTION public.${fn}`));
    assert.match(body.slice(0, 200), /SECURITY DEFINER\s+SET search_path = ''/, fn);
  }
  assert.match(sql, /public\.get_my_org_id\(\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.replace_service_report_items\(uuid, jsonb\) FROM PUBLIC, anon;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.replace_service_report_items\(uuid, jsonb\) TO authenticated, service_role;/);
  assert.match(rb, /DROP TRIGGER sr_items_keep_safety ON public\.service_report_items;/);
  assert.match(rb, /DROP FUNCTION public\.replace_service_report_items\(uuid, jsonb\);/);
});
