import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  INCOMPLETE_FREE_BADGE,
  libraryRowIsFree,
  manualIsIncomplete,
  mayViewIncompleteFree,
  pathWithinManual,
  slotCountedManuals,
} from './manual-incomplete.ts';
import { companyLibraryOpenNeedsAdd } from './manuals-access.ts';
import { refundReasonMessage } from './manual-library-refund.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('badge copy', () => {
  assert.equal(INCOMPLETE_FREE_BADGE, 'Incomplete – free');
});

test('incomplete flag parsing', () => {
  assert.equal(manualIsIncomplete({ is_incomplete: true }), true);
  assert.equal(manualIsIncomplete({ is_incomplete: 't' }), true);
  assert.equal(manualIsIncomplete({ is_incomplete: false }), false);
  assert.equal(manualIsIncomplete({ is_incomplete: null }), false);
  assert.equal(manualIsIncomplete(null), false);
});

test('slot count excludes incomplete manuals', () => {
  assert.equal(slotCountedManuals([]), 0);
  assert.equal(
    slotCountedManuals([{ is_incomplete: false }, { is_incomplete: true }, { incomplete: true }, {}]),
    2,
  );
  assert.equal(slotCountedManuals(new Map([['1', { incomplete: false }]]).values()), 1);
});

test('path must be within the manual', () => {
  assert.equal(pathWithinManual('shared/a/b.pdf', 'shared/a/b.pdf'), true);
  assert.equal(pathWithinManual('shared/a', 'shared/a/ch1.pdf'), true);
  assert.equal(pathWithinManual('shared/a', 'shared/ab/x.pdf'), false);
  assert.equal(pathWithinManual('shared/a/b.pdf', 'shared/other.pdf'), false);
  assert.equal(pathWithinManual('', 'x'), false);
});

test('free view fails closed', () => {
  const svc = { is_incomplete: true, doc_kind: 'service', storage_path: 'shared/x.pdf' };
  assert.equal(mayViewIncompleteFree({ manual: svc, orgId: 4, serviceCompany: true, requestedPath: 'shared/x.pdf' }), true);
  assert.equal(mayViewIncompleteFree({ manual: svc, orgId: null, serviceCompany: true }), false, 'no org');
  assert.equal(mayViewIncompleteFree({ manual: svc, orgId: 4, serviceCompany: false }), false, 'service shelf');
  assert.equal(
    mayViewIncompleteFree({ manual: { ...svc, doc_kind: 'operator' }, orgId: 4, serviceCompany: false }),
    true,
    'operator manual for owner org',
  );
  assert.equal(
    mayViewIncompleteFree({ manual: { ...svc, is_incomplete: false }, orgId: 4, serviceCompany: true }),
    false,
    'complete manual is not free',
  );
  assert.equal(
    mayViewIncompleteFree({ manual: svc, orgId: 4, serviceCompany: true, requestedPath: 'shared/secret.pdf' }),
    false,
    'other file',
  );
  assert.equal(mayViewIncompleteFree({ manual: null, orgId: 4, serviceCompany: true }), false);
});

test('open flow: unowned incomplete opens directly, server can still ask to add', () => {
  assert.equal(companyLibraryOpenNeedsAdd({ owned: false, incomplete: true }), false);
  assert.equal(companyLibraryOpenNeedsAdd({ owned: false }), true);
  assert.equal(companyLibraryOpenNeedsAdd({ owned: true, freeIncomplete: true, inLibrary: false }), false);
  assert.equal(companyLibraryOpenNeedsAdd({ owned: true, requiresAdd: true, freeIncomplete: true }), true);
  assert.equal(companyLibraryOpenNeedsAdd({ owned: true, inLibrary: false }), true);
});

test('refund copy for incomplete_free', () => {
  assert.match(refundReasonMessage('incomplete_free'), /free/i);
});

test('get-manual-url: incomplete manuals skip the cap and are viewable free', () => {
  const src = read('supabase/functions/get-manual-url/index.ts');
  assert.match(src, /from "\.\/incomplete\.ts"/);
  assert.match(src, /!targetIncomplete && usedSlots \+ slotsHeld >= slotLimit/);
  assert.match(src, /mayViewIncompleteFree\(/);
  assert.match(src, /free_incomplete: true/);
  assert.match(src, /manuals\(id, storage_path, is_incomplete\)/);
  // free views are not library reads: url_issued stays gated on inLibrary
  assert.match(src, /if \(inLibrary && !wantList && manualId && orgId != null\) \{\s*try \{\s*await admin\.rpc\("manual_record_url_issued"/);
});

test('library route and page exclude incomplete manuals from slot use', () => {
  const route = read('web/app/api/manuals/library/route.ts');
  assert.match(route, /slotCountedManuals/);
  assert.match(route, /!free && !isUnlimitedManualSlots\(limit\) && usedNow >= limit/);
  const page = read('web/app/manuals/page.tsx');
  assert.match(page, /ownedIds\.size - ownedFreeIds\.size/);
  assert.match(page, /INCOMPLETE_FREE_BADGE/);
  assert.match(read('web/components/ManualPdfViewer.tsx'), /INCOMPLETE_FREE_BADGE/);
});

test('Android parity: incomplete manuals do not use a slot', () => {
  const html = read('app/src/main/assets/manual_library.html');
  assert.match(html, /function slotsUsed\(\)/);
  assert.match(html, /const used = slotsUsed\(\)/);
  assert.match(html, /else if \(isManualIncomplete\(manual\)\)/);
  assert.match(html, /Incomplete – free/);
});

test('000942 migration standards', () => {
  const dir = 'web/supabase/migrations/';
  const m = read(dir + '20261022_000942_incomplete_manuals_free.sql');
  const r = read(dir + '20261022_000942_incomplete_manuals_free_rollback.sql');
  // 000942: 4 replaced library functions + the free_at_add trigger function.
  for (const [s, n] of [[m, 5], [r, 4]] as const) {
    assert.match(s, /^BEGIN;$/m);
    assert.match(s, /^COMMIT;$/m);
    assert.match(s, /SET LOCAL lock_timeout = '5s';/);
    assert.equal((s.match(/^SECURITY DEFINER$/gm) || []).length, n);
    assert.equal((s.match(/^SET search_path = ''$/gm) || []).length, n);
    assert.equal((s.match(/^REVOKE ALL ON FUNCTION/gm) || []).length, n);
  }
  assert.match(m, /000942 drift/);
  assert.match(r, /000942 rollback:/);
  assert.doesNotMatch(r, /v_free|is_incomplete IS TRUE/);
});

test('sticky free hold: added free stays free after incomplete -> complete', () => {
  assert.equal(libraryRowIsFree({ free_at_add: true }, { is_incomplete: false }), true);
  assert.equal(libraryRowIsFree({ free_at_add: false }, { is_incomplete: true }), true);
  assert.equal(libraryRowIsFree({ free_at_add: false }, { is_incomplete: false }), false);
  // Pre-000942: no column -> today's flag only.
  assert.equal(libraryRowIsFree({}, { is_incomplete: false }), false);
  assert.equal(libraryRowIsFree(null, null), false);
  assert.equal(slotCountedManuals([{ free_at_add: true, is_incomplete: false }, { is_incomplete: false }]), 1);
});

test('shelf skips Add only when the server would serve the free view; refusals fall back', () => {
  const owner = { orgId: 5, serviceCompany: false };
  const m = { is_incomplete: true, doc_kind: null, storage_path: 'shared/x' };
  // Owner-side org, doc_kind NULL: server refuses -> page prompts the (free) add.
  assert.equal(mayViewIncompleteFree({ manual: m, ...owner, requestedPath: m.storage_path }), false);
  assert.equal(
    companyLibraryOpenNeedsAdd({ owned: false, incomplete: mayViewIncompleteFree({ manual: m, ...owner }) }),
    true,
  );
  // Undeployed edge / denied reply after a direct open -> prompt add.
  assert.equal(companyLibraryOpenNeedsAdd({ owned: true, requiresAdd: true }), true);
  assert.equal(companyLibraryOpenNeedsAdd({ owned: true, error: 'Access denied — manual not in company library' }), true);
});

test('Android: incomplete open mirrors the server rule and falls back to Add', () => {
  const lib = read('app/src/main/assets/manual_library.html');
  const viewer = read('app/src/main/assets/pdf_viewer.html');
  assert.match(lib, /function mayViewIncompleteFreeClient\(m\)/);
  assert.match(lib, /kind === 'operator' \|\| kind === 'user'/);
  assert.match(lib, /mayViewIncompleteFreeClient\(manual\) && await probeFreeView\(manual\)/);
  assert.doesNotMatch(lib, /alreadyOwns \|\| isManualIncomplete\(manual\)/);
  assert.match(lib, /function openPendingAdd\(\)/);
  assert.match(lib, /r\.free_at_add === true/);
  assert.match(viewer, /manual_library\.html\?add=/);
  assert.match(viewer, /data\.requires_add === true/);
});

test('000942 keeps a sticky, trigger-set free_at_add', () => {
  const sql = read('web/supabase/migrations/20261022_000942_incomplete_manuals_free.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS free_at_add boolean NOT NULL DEFAULT false/);
  assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.user_manuals/);
  assert.match(sql, /NEW\.free_at_add := OLD\.free_at_add/);
  assert.match(sql, /IF v_row\.free_at_add OR EXISTS/);
  const rb = read('web/supabase/migrations/20261022_000942_incomplete_manuals_free_rollback.sql');
  assert.match(rb, /DROP COLUMN IF EXISTS free_at_add/);
});
