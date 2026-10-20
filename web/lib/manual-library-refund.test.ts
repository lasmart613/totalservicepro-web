import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADD_CONFIRM_ARM_MS,
  addConfirmArmed,
  createInFlightGuard,
  createPageViewBatcher,
  isMissingLibraryRpc,
  librarySource,
  loadSlotsHeld,
  normalizeLibrarySource,
  recordManualAccess,
  refundReasonMessage,
  removeActionLabel,
  removeConfirmBody,
  removeFromLibrary,
} from './manual-library-refund.ts';
import { appStrings } from './i18n/app-copy.ts';
import { MANUAL_LIBRARY_STRINGS } from './i18n/manual-library-copy.ts';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(webDir, p), 'utf8');
const LOCALES = ['fa', 'es', 'fr', 'he', 'it', 'de', 'pt', 'ar'] as const;

test('in-flight guard drops a second call for the same manual while the first runs', async () => {
  const g = createInFlightGuard();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const first = g.run('open:67', async () => {
    calls += 1;
    await gate;
    return 'added';
  });
  const second = await g.run('open:67', async () => {
    calls += 1;
    return 'added twice';
  });
  assert.equal(second, undefined);
  assert.equal(g.isBusy('open:67'), true);
  // a different manual is not blocked
  assert.equal(await g.run('open:68', async () => 'other'), 'other');
  release();
  assert.equal(await first, 'added');
  assert.equal(calls, 1);
  assert.equal(g.isBusy('open:67'), false);
  // released after an error too
  await assert.rejects(g.run('open:67', async () => { throw new Error('x'); }));
  assert.equal(await g.run('open:67', async () => 'again'), 'again');
});

test('Add is ignored for 300ms after the dialog opens', () => {
  assert.equal(ADD_CONFIRM_ARM_MS, 300);
  assert.equal(addConfirmArmed(1000, 1000), false);
  assert.equal(addConfirmArmed(1000, 1299), false);
  assert.equal(addConfirmArmed(1000, 1300), true);
});

test('source detection and sanitizing', () => {
  assert.equal(librarySource('Mozilla/5.0 (Linux; Android 14) TSPAndroid/0.5.2-beta'), 'android');
  assert.equal(librarySource('Mozilla/5.0 (iPhone) TSPiOS/1.0'), 'ios');
  assert.equal(librarySource('Mozilla/5.0 (Macintosh)'), 'web');
  assert.equal(normalizeLibrarySource('android'), 'android');
  assert.equal(normalizeLibrarySource('edge'), 'web');
  assert.equal(normalizeLibrarySource("web'; drop table"), 'web');
});

test('remove goes through the RPC; legacy delete only when the RPC is missing', async () => {
  const calls: string[] = [];
  const mk = (rpcResult: { data: unknown; error: any }) => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${fn}:${JSON.stringify(args)}`);
      return rpcResult;
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      const q: any = { delete: () => q, eq: (k: string, v: unknown) => (calls.push(`eq:${k}=${v}`), q), error: null };
      return q;
    },
  });
  calls.length = 0;
  const ok = await removeFromLibrary(mk({ data: { removed: true, refunded: false, reason: 'downloaded' }, error: null }), 67, 4, 'web');
  assert.deepEqual(ok.result, { removed: true, refunded: false, reason: 'downloaded' });
  assert.deepEqual(calls, ['rpc:manual_library_remove:{"p_manual_id":67,"p_source":"web"}']);

  calls.length = 0;
  const denied = await removeFromLibrary(mk({ data: null, error: { code: '42501', message: 'not a member of a company' } }), 67, 4, 'web');
  assert.equal(denied.result, null);
  assert.equal(denied.error?.code, '42501');
  assert.ok(!calls.some((c) => c.startsWith('from:')), 'no direct delete on a real error');

  calls.length = 0;
  const legacy = await removeFromLibrary(
    mk({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.manual_library_remove' } }),
    67,
    4,
    'web',
  );
  assert.equal(legacy.result?.legacy, true);
  assert.ok(calls.includes('from:organization_manuals') && calls.includes('eq:organization_id=4') && calls.includes('eq:manual_id=67'));
  assert.equal(isMissingLibraryRpc({ message: 'permission denied' }), false);
});

test('slots held and access reports fail soft', async () => {
  const boom = { rpc: async () => { throw new Error('network'); } };
  assert.equal(await loadSlotsHeld(boom, 4), 0);
  assert.equal(await loadSlotsHeld({ rpc: async () => ({ data: 2, error: null }) }, 4), 2);
  assert.equal(await loadSlotsHeld({ rpc: async () => ({ data: 2, error: null }) }, null), 0);
  await recordManualAccess(boom, 67, 'download');
  const sent: any[] = [];
  const spy = { rpc: async (fn: string, args: Record<string, unknown>) => (sent.push([fn, args]), { data: 1, error: null }) };
  await recordManualAccess(spy, 67, 'page_view', { pages: [3, 3, 1, 0, -2, 2.5], pageCount: 120 });
  assert.deepEqual(sent[0], ['manual_record_access', { p_manual_id: 67, p_kind: 'page_view', p_pages: [3, 1], p_page_count: 120, p_source: 'web' }]);
  await recordManualAccess(spy, 67, 'page_view', { pages: [] });
  await recordManualAccess(spy, null, 'print');
  assert.equal(sent.length, 1);
});

test('page batcher sends each page once', () => {
  const batches: number[][] = [];
  const b = createPageViewBatcher((p) => batches.push(p));
  b.add(2); b.add(1); b.add(2); b.add(0);
  b.flush();
  b.add(2); b.add(3);
  b.flush();
  b.flush();
  assert.deepEqual(batches, [[1, 2], [3]]);
});

test('every reason has copy, translated in all 8 locales', () => {
  const keys = new Set<string>();
  for (const r of ['refund', 'window_expired', 'downloaded', 'printed', 'heavy_reading', 'many_fetches', 'monthly_cap', 'still_held', 'not_in_library', 'other']) {
    keys.add(refundReasonMessage(r));
  }
  keys.add(removeActionLabel({ owned: true, refund_eligible: true }));
  keys.add(removeActionLabel({ owned: true, refund_eligible: false }));
  keys.add(removeConfirmBody({ owned: true, refund_eligible: true }));
  keys.add(removeConfirmBody(null));
  for (const k of ['Add & open', 'Cancel', 'Undo', 'Added to company library', 'Add to company library?']) keys.add(k);
  for (const locale of LOCALES) {
    const dict = appStrings(locale);
    for (const k of keys) {
      assert.equal(typeof dict[k], 'string', `${locale}: ${k}`);
      assert.notEqual(dict[k], k, `${locale}: ${k}`);
    }
    for (const [k, v] of Object.entries(MANUAL_LIBRARY_STRINGS)) {
      for (const token of k.match(/\{\w+\}/g) || []) assert.ok(v[locale].includes(token), `${locale} dropped ${token} in ${k}`);
    }
  }
  assert.equal(removeActionLabel({ owned: true, refund_eligible: true }), 'Remove & refund');
});

test('/manuals uses the in-app dialog with the guard, Undo and Remove', () => {
  const page = read('app/manuals/page.tsx');
  assert.ok(!/window\.confirm\(/.test(page), 'no native confirm on /manuals');
  assert.ok(page.includes('<ManualConfirmDialog'));
  assert.ok(page.includes("acceptLabel: 'Add & open'"));
  assert.ok(/inFlight\.current\.run\(`open:/.test(page), 'openManual guarded');
  assert.ok(/inFlight\.current\.run\(`add:/.test(page), 'confirmAddManual guarded');
  assert.ok(/label: t\('Undo'\)/.test(page), 'Undo on the added toast');
  assert.ok(page.includes('removeFromLibrary(') && page.includes('data-testid="manual-remove"'));
  assert.ok(!/from\('organization_manuals'\)\s*\.delete\(/.test(page), 'page never deletes directly');
  // QA #332 MEDIUM: no direct client insert into the library tables
  assert.ok(!/from\('organization_manuals'\)\s*\.insert\(/.test(page), 'no client insert into organization_manuals');
  assert.ok(!/from\('user_manuals'\)\s*\.insert\(/.test(page), 'no client insert into user_manuals');
});

test('dialog: Cancel focused, Enter never accepts, Esc/backdrop cancel, armed accept, a11y', () => {
  const src = read('components/ManualConfirmDialog.tsx');
  assert.ok(/cancelRef\.current\?\.focus\(\)/.test(src));
  assert.ok(/e\.key === 'Enter'[\s\S]{0,300}preventDefault\(\)[\s\S]{0,200}cancel\(\)/.test(src));
  assert.ok(!/e\.key === 'Enter'[\s\S]{0,300}accept\(\)/.test(src), 'Enter path never calls accept');
  assert.ok(/e\.key === 'Escape'[\s\S]{0,120}cancel\(\)/.test(src));
  assert.ok(/if \(e\.target !== e\.currentTarget\) return;\s*if \(!addConfirmArmed\(openedAt\.current, Date\.now\(\), ADD_CONFIRM_ARM_MS\)\) return;\s*cancel\(\);/.test(src), 'backdrop ignored for 300ms');
  assert.ok(/addConfirmArmed\(openedAt\.current/.test(src));
  assert.ok(src.includes('role="dialog"') && src.includes('aria-modal="true"') && src.includes('aria-labelledby') && src.includes('aria-describedby'));
});

test('add paths count held slots and record the source', () => {
  const route = read('app/api/manuals/library/route.ts');
  assert.ok(route.includes("rpc('manual_slots_held'") && /usedNow >= limit && !reAddHeld/.test(route));
  assert.ok(route.includes("rpc('manual_slot_is_held'") && /if \(!hasServiceRole\(\)\)/.test(route));
  assert.ok(/source,\n\s*\}\);/.test(route));
  const edge = readFileSync(join(webDir, '..', 'supabase/functions/get-manual-url/index.ts'), 'utf8');
  assert.ok(edge.includes('"manual_slots_held"') && edge.includes('owned.size + slotsHeld >= slotLimit'));
  assert.ok(edge.includes('"manual_record_url_issued"'));
  assert.ok(edge.includes('"manual_slot_is_held"') && edge.includes('owned.size + slotsHeld >= slotLimit && !reAddHeld'));
  const viewer = read('components/ManualPdfViewer.tsx');
  assert.ok(viewer.includes("'beforeprint'") && viewer.includes("'page_view'") && viewer.includes('onClick={reportDownload}'));
  assert.ok(!/pageCount:\s/.test(viewer.slice(viewer.indexOf('createPageViewBatcher(('))), 'viewer no longer sends a page count');
});

test('migration 000936 standards', () => {
  const mig = read('supabase/migrations/20261020_000936_manual_library_refund.sql');
  const rb = read('supabase/migrations/20261020_000936_manual_library_refund_rollback.sql');
  for (const sql of [mig, rb]) {
    assert.match(sql, /^BEGIN;$/m);
    assert.match(sql, /^COMMIT;$/m);
    assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
    assert.match(sql, /RAISE EXCEPTION '000936/);
  }
  assert.match(mig, /interval '24 hours'/);
  assert.match(mig, /c_cap\s+constant int := 3/);
  assert.match(mig, /c_pages\s+constant int := 20/);
  assert.match(mig, /REVOKE ALL ON TABLE public\.manual_library_events FROM PUBLIC, anon, authenticated;/);
  assert.match(mig, /REVOKE INSERT, UPDATE, MAINTAIN ON TABLE public\.organization_manuals FROM anon, authenticated;/);
  assert.match(mig, /BEFORE INSERT ON public\.organization_manuals/);
  assert.match(mig, /manual_library_guard_insert\(\)\s*RETURNS trigger\s*LANGUAGE plpgsql\s*SECURITY INVOKER/);
  assert.match(mig, /v_pc\s+int\s+:= NULL;/);
  assert.match(rb, /GRANT INSERT, UPDATE, MAINTAIN ON TABLE public\.organization_manuals TO authenticated;/);
  for (const fn of ['manual_library_remove', 'manual_library_status', 'manual_record_access', 'manual_record_url_issued', 'manual_slots_held', 'manual_refund_check']) {
    assert.ok(new RegExp(`FUNCTION public\\.${fn}\\([^)]*\\)\\s*RETURNS[\\s\\S]{0,120}SECURITY DEFINER\\s*SET search_path = ''`).test(mig), fn);
    assert.ok(rb.includes(`DROP FUNCTION IF EXISTS public.${fn}(`), `rollback drops ${fn}`);
  }
});
