import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMiniGentleYag, isStockedBomPart, rankPartsForDevice, sectionForDescription, type PartPick } from './bom.ts';
import { searchCrossReference } from './cross-ref.ts';
import { planMpnDedup } from './dedup-plan.ts';
import { manualNineBlocksLibrary, manualNineCoverage, acceptEvidenceLines, manualNineQueue, MANUAL_NINE_SOURCES } from './manual-nine.ts';
import { reattachSystemLines } from './reattach.ts';
import { normalizeMpn } from './mpn.ts';
import {
  catalogInsertFromOrg,
  enrichBlankOrgFields,
  filterInventoryRows,
  findExistingOrgPart,
  publicEnrichmentStub,
} from './org-part.ts';
import { loadMiniGentleYagSeed, miniGentleYagFamilyTreeText } from './seed.ts';
import {
  applySweepOutcome,
  extractBomLines,
  ingestManualNineSource,
  MINI_GENTLEYAG_MANUAL,
  planSweepBatch,
  scoreBomText,
  SWEEP_BATCH_DEFAULT,
  SWEEP_BATCH_MAX,
  SWEEP_BATCH_MIN,
  sweepPriority,
  type SweepProgress,
} from './sweep.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('MPN normalization ignores case, spaces, and dashes', () => {
  assert.equal(normalizeMpn(' 7122-00-3497 '), '7122003497');
  assert.equal(normalizeMpn('7122 00 3497'), normalizeMpn('7122-00-3497'));
});

test('zero quantity is hidden unless the toggle asks for it', () => {
  const rows = [{ id: 1, quantity_on_hand: 0 }, { id: 2, quantity_on_hand: 3 }, { id: 3, quantity_on_hand: null }];
  assert.deepEqual(filterInventoryRows(rows).map((row) => row.id), [2]);
  assert.equal(filterInventoryRows(rows, { hideZero: false }).length, 3);
});

test('the same MPN is reused and catalog inserts carry no price', () => {
  const existing = [{ id: 9, mpn_normalized: '7122003497', catalog_part_id: 4, unit_cost: 80 }];
  assert.equal(findExistingOrgPart(existing, { mpn: '7122-00-3497' })?.id, 9);
  const created = catalogInsertFromOrg({
    mpn: '7122-00-3497',
    brand: 'Candela',
    description: 'Laser head',
    unit_cost: 500,
    sell_price: 900,
  });
  assert.equal(created?.mpn_normalized, '7122003497');
  assert.equal('unit_cost' in (created || {}), false);
  assert.equal('sell_price' in (created || {}), false);
});

test('blank org fields can be filled from the catalog, never from a catalog price', () => {
  const filled = enrichBlankOrgFields(
    { description_override: null, unit_cost: null, sell_price: 40, field_sources: {} },
    { description: 'Laser head assembly', sale_price: 999, name: 'Head' },
    { unit_cost: 10, sell_price: 20, preferred_vendor_name: 'Candela' },
  );
  assert.deepEqual(filled.filled.sort(), ['description_override', 'preferred_vendor_name']);
  assert.equal(filled.patch.description_override, 'Laser head assembly');
  assert.equal(filled.patch.unit_cost, undefined);
  assert.equal(filled.patch.sell_price, undefined);
  const kept = enrichBlankOrgFields(
    { description_override: 'Shop name', field_sources: { description_override: 'org' } },
    { description: 'Catalog name' },
  );
  assert.deepEqual(kept.filled, []);
  assert.equal(publicEnrichmentStub('7122-00-3497').available, false);
});

test('cross-reference matches MPN, a vendor number, or the org inventory number', () => {
  const catalog = [
    { id: 1, part_number: '7122-00-3497', mpn_normalized: '7122003497', name: 'Laser head', brand: 'Candela' },
    { id: 2, part_number: '7122-00-3165', mpn_normalized: '7122003165', name: 'DI filter', brand: 'Candela' },
  ];
  const vendors = [
    { part_id: 1, vendor_name: 'Candela', vendor_part_number: '7122-00-3497' },
    { part_id: 1, vendor_name: 'Parts for Laser', vendor_part_number: 'PFL-3497' },
    { part_id: 2, vendor_name: 'Laser Scientific', vendor_part_number: 'LS-3165' },
  ];
  const orgParts = [
    {
      id: 9,
      catalog_part_id: 2,
      mpn_normalized: '7122003165',
      internal_part_number: 'SHOP-44',
      vendor_part_number: null,
      sell_price: 18,
      unit_cost: 9,
      quantity_on_hand: 4,
    },
  ];
  const byMpn = searchCrossReference('7122-00-3497', { catalog, vendors, orgParts });
  assert.equal(byMpn[0]?.mpn, '7122-00-3497');
  assert.equal(byMpn[0]?.matchedOn, 'mpn');
  assert.equal(byMpn[0]?.sellPrice, null);
  assert.equal(byMpn[0]?.vendors.some((vendor) => vendor.vendor_name === 'Parts for Laser'), true);

  const byVendor = searchCrossReference('PFL-3497', { catalog, vendors, orgParts });
  assert.equal(byVendor[0]?.catalogPartId, 1);
  assert.equal(byVendor[0]?.matchedOn, 'vendor_pn');
  assert.equal(byVendor[0]?.unitCost, null);

  const byOrg = searchCrossReference('shop-44', { catalog, vendors, orgParts });
  assert.equal(byOrg[0]?.orgPartId, 9);
  assert.equal(byOrg[0]?.matchedOn, 'org_internal');
  assert.equal(byOrg[0]?.sellPrice, 18);
  assert.equal(byOrg[0]?.mpn, '7122-00-3165');
  assert.equal(normalizeMpn('PFL-3497'), 'PFL3497');
});

test('a device BOM is offered before the general catalog', () => {
  const bom: PartPick[] = [{ key: 'b', part_number: '7122-00-3497', description: 'Laser head', unit_price: 12, source: 'bom', section: 'Laser head' }];
  const other: PartPick[] = [
    { key: 'c', part_number: '7122-00-3497', description: 'duplicate', unit_price: 99, source: 'catalog' },
    { key: 'm', part_number: 'OTHER-1', description: 'Marketplace lamp', unit_price: 5, source: 'marketplace' },
  ];
  const ranked = rankPartsForDevice(bom, other, '');
  assert.equal(ranked[0]?.source, 'bom');
  assert.equal(ranked[0]?.unit_price, 12);
  assert.equal(ranked.filter((hit) => hit.part_number === '7122-00-3497').length, 1);
  assert.equal(isMiniGentleYag('Candela', 'VP YAG'), true);
  assert.equal(isMiniGentleYag('Candela', 'GentleMAX'), false);
});

test('Mini GentleYAG seed keeps every stocked section, including head and rail', () => {
  const lines = loadMiniGentleYagSeed();
  assert.ok(lines.length >= 150, `expected a full family-tree extract, got ${lines.length}`);
  const sections = new Set(lines.map((line) => line.section));
  for (const section of ['Laser head', 'Laser rail', 'Laser rail — aiming beam', 'Fluid section', 'DCD', 'Calport']) {
    assert.ok(sections.has(section), section);
  }
  assert.ok(lines.some((line) => line.mpn === '7122-00-3497'));
  assert.ok(lines.some((line) => line.mpn === '7122-00-3446'));
  assert.equal(lines.some((line) => line.mpn.startsWith('7111-80-')), false);
  assert.equal(isStockedBomPart('7122-99-3497', 'ASSY DWG,LSR HD'), false);
  assert.equal(sectionForDescription('7122-00-3497', 'ASSY,LSR HD,GL INSR,VPYAG'), 'Laser head');
  const extracted = extractBomLines(miniGentleYagFamilyTreeText(lines));
  assert.equal(extracted.length, lines.length);
  const score = scoreBomText(miniGentleYagFamilyTreeText(lines));
  assert.equal(score.hasBom, true);
});

test('the sweep runs Mini GentleYAG first, then other Candela, in batches of 50-100', () => {
  assert.equal(sweepPriority({ manual_id: 9, brand: 'Candela', model: 'vpyag', title: 'Mini GentleYAG' }), 0);
  assert.equal(sweepPriority({ manual_id: 40, brand: 'Candela', model: 'vpyag', title: 'Mini GentleYAG' }), 10);
  assert.equal(sweepPriority({ brand: 'Candela', model: 'gentleyag', title: 'GentleYAG' }), 10);
  assert.equal(sweepPriority({ brand: 'Lumenis', model: 'acupulse', title: 'AcuPulse' }), 100);
  assert.equal(MINI_GENTLEYAG_MANUAL.libraryId, 9);
  assert.ok(SWEEP_BATCH_DEFAULT >= SWEEP_BATCH_MIN && SWEEP_BATCH_DEFAULT <= SWEEP_BATCH_MAX);

  const manuals: SweepProgress[] = [
    { manual_id: 500, brand: 'Quanta', title: 'Cyber Ho', status: 'pending', priority: 100 },
    { manual_id: 24, brand: 'Candela', model: 'gentleyag', title: 'GentleYag', status: 'pending', priority: 10 },
    { manual_id: 9, brand: 'Candela', model: 'vpyag', title: 'Mini GentleYAG (VPYag)', status: 'pending', priority: 0 },
    { manual_id: 8, brand: 'Candela', model: 'vpyag', title: 'already done', status: 'extracted', priority: 0 },
  ];
  const withAnotherPriorityZero = [
    ...manuals,
    { manual_id: 40, brand: 'Candela', model: 'vpyag', title: 'another VP YAG', status: 'pending' as const, priority: 0 },
  ];
  const batch = planSweepBatch(withAnotherPriorityZero, 75);
  assert.deepEqual(batch.map((row) => row.manual_id), [9]);
  const again = applySweepOutcome(batch[0], { lines: loadMiniGentleYagSeed() });
  assert.equal(again.status, 'extracted');
  const rest = manuals.filter((row) => row.manual_id !== 9);
  const omitted = planSweepBatch([again, ...rest], 75);
  assert.deepEqual(omitted.map((row) => row.manual_id), []);
  const empty = planSweepBatch([again, ...rest], 75, []);
  assert.deepEqual(empty.map((row) => row.manual_id), []);
  const done = manualNineQueue().map((file) => ({ ...file, status: 'no_line_items' as const }));
  const after = planSweepBatch([again, ...rest], 75, done);
  assert.equal(after.some((row) => row.manual_id === 9), false);
  assert.deepEqual(after.map((row) => row.manual_id), [24, 500]);
  const failed = applySweepOutcome(manuals[1], { lines: [], error: 'unreadable page' });
  assert.equal(failed.status, 'error');
  assert.equal(planSweepBatch([again, failed, manuals[0]], 50, done)[0]?.manual_id, 24);
  const partial = done.slice(0, 36);
  assert.equal(manualNineCoverage(partial).complete, false);
  assert.deepEqual(planSweepBatch([again, ...rest], 75, partial).map((row) => row.manual_id), []);
  const oneError = done.map((file, index) => (index === 0 ? { ...file, status: 'error' as const } : file));
  assert.equal(manualNineCoverage(oneError).errored.length, 1);
  assert.deepEqual(planSweepBatch([again, ...rest], 75, oneError).map((row) => row.manual_id), []);
  const released = planSweepBatch([again, ...rest], 75, oneError.map((file) => ({ ...file, status: 'extracted' as const })));
  assert.deepEqual(released.map((row) => row.manual_id), [24, 500]);
});

test('System lines stay unassigned unless a manual quote names the parent', () => {
  const lines = [
    { mpn: '2846-30-0806', description: 'SCR,SEMS', section: 'System', provenance: 'family-tree-ocr', parent_mpn: null, assembly_confidence: 'unassigned' as const },
  ];
  const untouched = reattachSystemLines(lines, []);
  assert.equal(untouched[0]?.section, 'System');
  assert.equal(untouched[0]?.assembly_confidence, 'unassigned');
  const moved = reattachSystemLines(lines, [{
    child_mpn: '2846-30-0806',
    parent_mpn: '7122-00-3446',
    source_path: 'shared/candela/VPYag/Sect 4/7122-99-3446_04.pdf',
    quote: 'Item 4 screw 2846-30-0806 on laser rail assembly 7122-00-3446',
  }]);
  assert.equal(moved[0]?.assembly_confidence, 'unassigned');
  assert.equal(moved[0]?.provenance_kind, 'candidate');
  assert.equal(moved[0]?.parent_mpn, '7122-00-3446');
  assert.equal(moved[0]?.section, 'System');
  assert.match(moved[0]?.provenance || '', /^candidate /);
  assert.match(moved[0]?.provenance || '', /7122-99-3446_04/);
  const forged = reattachSystemLines(lines, [{
    child_mpn: '2846-30-0806',
    parent_mpn: '7122-00-3446',
    source_path: 'notes/not-a-manual.pdf',
    quote: '2846-30-0806 and 7122-00-3446',
  }]);
  assert.equal(forged[0]?.provenance_kind, 'unassigned');
  assert.equal(forged[0]?.assembly_confidence, 'unassigned');
  assert.equal(forged[0]?.parent_mpn, null);
});

test('duplicate MPNs merge only inside one manufacturer and flag conflicting text', () => {
  const plans = planMpnDedup([
    { id: 2, brand: 'Candela', mpn_normalized: '7122003497', description: 'Laser head' },
    { id: 5, brand: 'Candela', mpn_normalized: '7122003497', description: 'Laser head' },
    { id: 9, brand: 'Lumenis', mpn_normalized: '7122003497', description: 'Different maker' },
    { id: 3, brand: 'Candela', mpn_normalized: 'AAA', description: 'Short' },
    { id: 4, brand: 'Candela', mpn_normalized: 'AAA', description: 'A longer conflicting description' },
  ]);
  const same = plans.find((plan) => plan.brand === 'candela' && plan.mpn_normalized === '7122003497');
  assert.equal(same?.action, 'merge_ready');
  assert.equal(same?.keeper_id, 2);
  assert.deepEqual(same?.loser_ids, [5]);
  assert.ok(same?.remap.some((row) => row.table === 'device_bom' && row.from_id === 5 && row.to_id === 2));
  const other = plans.find((plan) => plan.brand === 'lumenis');
  assert.equal(other?.action, 'keep');
  const conflict = plans.find((plan) => plan.mpn_normalized === 'AAA');
  assert.equal(conflict?.action, 'review');
  assert.equal(conflict?.remap.length, 0);
});

test('manual 9 parts lists and head/rail drawings block the rest of the library', () => {
  const queue = manualNineQueue();
  assert.ok(queue.some((file) => file.storage_path.endsWith('7122-99-3497_01.pdf')));
  assert.ok(queue.some((file) => file.storage_path.endsWith('7122-99-3446_04.pdf')));
  assert.equal(manualNineBlocksLibrary(queue), true);
  const done = queue.map((file) => ({ ...file, status: 'no_line_items' as const }));
  assert.equal(manualNineBlocksLibrary(done), false);
  const imported = acceptEvidenceLines([
    { mpn: '7122-00-3497', description: 'Laser head', source_path: queue[0].storage_path },
    { mpn: 'MADE-UP', description: 'not in a file', source_path: 'notes/guess.pdf' },
  ]);
  assert.equal(imported.accepted.length, 1);
  assert.equal(imported.rejected.length, 1);
  const blocked = planSweepBatch(
    [
      { manual_id: 9, status: 'extracted', priority: 0 },
      { manual_id: 40, status: 'pending', priority: 0 },
    ],
    75,
    queue,
  );
  assert.deepEqual(blocked.map((row) => row.manual_id), []);
  assert.deepEqual(planSweepBatch(
    [
      { manual_id: 9, status: 'extracted', priority: 0 },
      { manual_id: 40, status: 'pending', priority: 0 },
    ],
    75,
  ).map((row) => row.manual_id), []);
  const released = planSweepBatch(
    [
      { manual_id: 9, status: 'extracted', priority: 0 },
      { manual_id: 40, status: 'pending', priority: 0 },
    ],
    75,
    done,
  );
  assert.deepEqual(released.map((row) => row.manual_id), [40]);
  const rail = queue.find((file) => file.storage_path.endsWith('7122-99-3446_04.pdf'));
  assert.ok(rail);
  const ingested = ingestManualNineSource(
    rail.storage_path,
    '7122-00-3446 ASSY,LSR RAIL R=. 1 EA\n2846-30-0806 SCR,SEMS R=. 2 EA',
    [{
      child_mpn: '2846-30-0806',
      parent_mpn: '7122-00-3446',
      source_path: rail.storage_path,
      quote: '2846-30-0806 on 7122-00-3446',
    }],
  );
  assert.equal(manualNineCoverage(undefined).complete, false);
  assert.equal(manualNineCoverage(undefined).missing.length, MANUAL_NINE_SOURCES.length);
  assert.equal(manualNineCoverage([]).missing.length, 37);
  assert.equal(manualNineCoverage(done.slice(1)).complete, false);
  assert.equal(ingested.plan.persisted, false);
  assert.equal(ingested.plan.sourceVerified.length, 0);
  assert.equal(ingested.plan.candidates[0]?.provenance_kind, 'candidate');
  assert.equal(ingested.plan.candidates[0]?.assembly_confidence, 'unassigned');
  assert.equal(ingested.plan.candidates[0]?.parent_mpn, '7122-00-3446');
  const outside = ingestManualNineSource('notes/not-a-manual.pdf', '7122-00-3446 ASSY R=. 1', []);
  assert.equal(outside.accepted.length, 0);
  assert.equal(outside.plan.persisted, false);
});

test('migration keeps prices on the org table and queues the sweep without applying it', () => {
  const sql = readFileSync(
    join(here, '../../supabase/migrations/20261105_000951_org_parts_inventory_bom.sql'),
    'utf8',
  );
  const rollback = readFileSync(
    join(here, '../../supabase/migrations/20261105_000951_org_parts_inventory_bom_rollback.sql'),
    'utf8',
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.organization_parts/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.device_bom/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.manual_bom_sweep/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.part_catalog_availability/);
  assert.match(sql, /is_active_org_member\(organization_id\)/);
  assert.match(sql, /7122-00-3497/);
  assert.match(sql, /7122-00-3446/);
  assert.match(sql, /WHEN m\.id = 9 THEN 0/);
  assert.match(sql, /parent_mpn/);
  assert.match(sql, /assembly_confidence/);
  assert.doesNotMatch(sql, /GRANT UPDATE \(%s\) ON public\.parts_catalog/);
  assert.match(sql, /part_catalog_availability_vendor_pn_uidx/);
  assert.match(sql, /vendor_pn_normalized/);
  assert.doesNotMatch(sql.slice(sql.indexOf('part_catalog_availability'), sql.indexOf('organization_parts')), /unit_cost|sell_price/);
  assert.match(rollback, /DROP TABLE IF EXISTS public\.organization_parts/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.parts_catalog FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT UPDATE \(is_active\) ON TABLE public\.parts_catalog TO authenticated/);
  assert.match(sql, /GRANT DELETE ON TABLE public\.part_vendors TO authenticated/);
  assert.match(sql, /000951 preflight abort/);
  assert.match(sql, /FOR ALL TABLES/);
  assert.doesNotMatch(sql, /ALTER PUBLICATION supabase_realtime DROP TABLE/);
  assert.match(sql, /ELSE 'held'/);
  assert.match(sql, /refusing to queue manual/);
  for (const source of MANUAL_NINE_SOURCES) {
    assert.ok(sql.includes(source.storage_path), source.storage_path);
  }
  assert.match(rollback, /PRICE READS REOPEN/);
  assert.match(rollback, /ROLLBACK REOPENS PRICE READS/);
  assert.match(rollback, /SELECT includes sale_price/);
  assert.doesNotMatch(rollback, /GRANT SELECT, UPDATE ON/);
  assert.doesNotMatch(rollback, /GRANT INSERT \(sale_price\)/);
  assert.match(sql, /a.attname <> 'sale_price'/);
  assert.match(sql, /unit_cost', 'currency'/);
  const fixture = readFileSync(join(here, '../../supabase/fixtures/20261105_qa2655_sample_qty.sql'), 'utf8');
  assert.match(fixture, /organization_id = 2655/);
  assert.match(fixture, /operator interlock/);
  assert.match(fixture, /not proof the database is non-production/);
  assert.doesNotMatch(fixture, /environment-proof|environment proof/i);
  assert.doesNotMatch(fixture, /organization_id = (1005|5509|2616|4|5515)/);
  const html = readFileSync(join(here, '../../../app/src/main/assets/parts_catalog.html'), 'utf8');
  assert.doesNotMatch(html, /select\('\*'\)/);
  assert.doesNotMatch(html, /sale_price:/);
  const dedupSql = readFileSync(join(here, '../../supabase/oneoff/20261105_000951_mpn_dedup_dry_run.sql'), 'utf8');
  assert.doesNotMatch(dedupSql, /\b(UPDATE|DELETE|INSERT)\b/i);
  assert.match(sql, /NEW\.status = 'held'/);
  assert.match(sql, /OLD\.status IN \('extracted', 'no_bom'\)/);
  assert.match(sql, /prosecdef/);
  assert.match(sql, /materialized view/);
  assert.match(sql, /dynamic SQL/);
  assert.match(sql, /does not clear production/);
  assert.doesNotMatch(sql, /AND NOT g\.rolbypassrls/);
  const audit = readFileSync(join(here, '../../supabase/oneoff/20261105_000951_price_lock_preflight.sql'), 'utf8');
  assert.doesNotMatch(audit, /^\s*(INSERT|UPDATE|DELETE|GRANT|REVOKE|ALTER|DROP|CREATE)\b/im);
  assert.match(audit, /qa_legacy_grant/);
  assert.match(audit, /FOR ALL TABLES/);
  assert.match(audit, /prosecdef/);
  assert.match(audit, /materialized/);
  assert.match(audit, /dynamic SQL/);
  assert.match(audit, /does not clear production/);
});
