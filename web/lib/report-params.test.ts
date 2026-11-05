import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServiceReportPrintHTML } from './service-report-print.ts';
import {
  MODELS,
  CUSTOM_PARAMS_KEY,
  REMOVED_PARAMS_KEY,
  addCustomReportParam,
  addableReportParams,
  isCandelaLaser,
  isDcdSettingParam,
  mergeModelParamValues,
  paramStorageKey,
  removeReportParam,
  restoreReportParam,
  systemParameterRows,
  visibleReportParams,
} from './models.ts';

const OLD_DCD = {
  'Total System Shots': '12000',
  'DCD Canister Shots': '300',
  'DCD Delay Set (ms)': '30',
  'DCD Delay Measured (ms)': '31',
  'DCD Duration Set (ms)': '40',
  'DCD Duration Measured (ms)': '41',
  'Pre-spray (ms)': '20',
  'Post-spray (ms)': '10',
  'Cryogen Spray Duration': '50',
  Delay: '30',
};

test('no Candela model template offers DCD set parameters', () => {
  for (const [key, m] of Object.entries(MODELS)) {
    if (!isCandelaLaser(m.mfg, key, m.label)) continue;
    for (const p of m.params) assert.equal(isDcdSettingParam(paramStorageKey(p)), false, `${key}: ${paramStorageKey(p)}`);
  }
});

test('Candela detection is case-insensitive and covers model names', () => {
  for (const n of ['candela', 'CANDELA GentleMax', 'VBeam Perfecta', 'GentleLASE', 'Mini GentleYAG (VPYag)', 'GentleMAX PRO', 'PicoWay']) {
    assert.ok(isCandelaLaser(n), n);
  }
  for (const n of ['Lumenis UltraPulse', 'Cynosure Apogee', 'Cutera Xeo', '', null]) assert.equal(isCandelaLaser(n), false, String(n));
});

test('DCD matcher hides settings but keeps the canister shot counter', () => {
  for (const k of Object.keys(OLD_DCD).filter((k) => k !== 'Total System Shots' && k !== 'DCD Canister Shots')) {
    assert.ok(isDcdSettingParam(k), k);
  }
  assert.equal(isDcdSettingParam('DCD Canister Shots'), false);
  assert.equal(isDcdSettingParam('HV @ Reference Fluence (VDC)'), false);
});

for (const model of ['Candela VPYag', 'Candela GentleYAG', 'Candela GentleMAX_PRO']) {
  test(`old ${model} report with DCD values hides them on view, print and email`, () => {
    const rows = systemParameterRows(OLD_DCD, model, model);
    const keys = rows.map((r) => r.key);
    assert.ok(keys.includes('Total System Shots'));
    assert.ok(keys.includes('DCD Canister Shots'));
    for (const k of keys) assert.equal(isDcdSettingParam(k), false, k);
    const html = buildServiceReportPrintHTML({ model_type: model, equipment_name: model, model_parameters: OLD_DCD } as any);
    assert.doesNotMatch(html, /DCD (Delay|Duration)|Pre-spray|Post-spray|Cryogen/i);
    assert.match(html, /12000/);
  });
}

test('Candela detected from equipment name alone (no static model)', () => {
  const rows = systemParameterRows(OLD_DCD, 'some-db-model', 'Candela GentleLASE Pro');
  for (const r of rows) assert.equal(isDcdSettingParam(r.key), false, r.key);
});

test('Candela form never lists DCD, even for old saved values or via Add parameter', () => {
  const m = MODELS['Candela VPYag'];
  const vis = visibleReportParams(m, OLD_DCD).map(paramStorageKey);
  for (const k of vis) assert.equal(isDcdSettingParam(k), false, k);
  const removedDcd = { ...OLD_DCD, [REMOVED_PARAMS_KEY]: ['DCD Delay Set (ms)', 'Lamp Shots'] };
  const add = addableReportParams(m, removedDcd).map(paramStorageKey);
  assert.deepEqual(add, ['Lamp Shots']);
  for (const name of ['DCD Delay', 'pre-spray', 'Post Spray', 'cryogen', 'dcd duration']) {
    const r = addCustomReportParam({}, name, '1', { model: m });
    assert.deepEqual(r, { ok: false, reason: 'dcd_blocked' }, name);
  }
  // Name-only Candela (unknown model) is also blocked
  assert.equal(addCustomReportParam({}, 'DCD delay', '1', { model: null, names: ['Candela'] }).ok, false);
  // merge on save does not re-seed DCD keys
  const merged = mergeModelParamValues({ mfg: 'Candela', params: ['DCD Delay Set (ms)', 'Lamp Shots'] }, {});
  assert.deepEqual(Object.keys(merged), ['Lamp Shots']);
});

test('remove/restore model param persists in jsonb and hides on render', () => {
  const m = MODELS['Candela VPYag'];
  let v: Record<string, any> = mergeModelParamValues(m, { 'Lamp Shots': '9' });
  v = removeReportParam(v, 'Lamp Shots');
  assert.deepEqual(v[REMOVED_PARAMS_KEY], ['Lamp Shots']);
  assert.equal('Lamp Shots' in v, false);
  const saved = JSON.parse(JSON.stringify(mergeModelParamValues(m, v)));
  assert.equal('Lamp Shots' in saved, false);
  assert.ok(!visibleReportParams(m, saved).map(paramStorageKey).includes('Lamp Shots'));
  assert.ok(!systemParameterRows({ ...saved, 'Total System Shots': '1' }, 'Candela VPYag', '').some((r) => r.key === 'Lamp Shots'));
  assert.ok(!buildServiceReportPrintHTML({ model_type: 'Candela VPYag', model_parameters: { ...saved, 'Total System Shots': '1' } } as any).includes('Lamp Shots'));
  assert.deepEqual(addableReportParams(m, saved).map(paramStorageKey), ['Lamp Shots', 'DCD Canister Shots']);
  const back = restoreReportParam(saved, 'Lamp Shots');
  assert.equal(REMOVED_PARAMS_KEY in back, false);
  assert.equal(back['Lamp Shots'], '');
  assert.ok(visibleReportParams(m, back).map(paramStorageKey).includes('Lamp Shots'));
});

test('custom name/value param adds, renders and removes', () => {
  const m = MODELS['Candela VPYag'];
  const r = addCustomReportParam({ 'Total System Shots': '5' }, '  Chiller Temp (°C) ', '18', { model: m });
  assert.ok(r.ok);
  const v = (r as any).values;
  assert.deepEqual(v[CUSTOM_PARAMS_KEY], ['Chiller Temp (°C)']);
  assert.equal(v['Chiller Temp (°C)'], '18');
  assert.deepEqual(addCustomReportParam(v, 'Chiller Temp (°C)', '1', { model: m }), { ok: false, reason: 'duplicate' });
  assert.deepEqual(addCustomReportParam(v, '  ', '1', { model: m }), { ok: false, reason: 'empty' });
  assert.ok(visibleReportParams(m, v).map(paramStorageKey).includes('Chiller Temp (°C)'));
  assert.ok(systemParameterRows(v, 'Candela VPYag', '').some((x) => x.key === 'Chiller Temp (°C)' && x.value === '18'));
  const gone = removeReportParam(v, 'Chiller Temp (°C)');
  assert.equal(CUSTOM_PARAMS_KEY in gone, false);
  assert.equal(REMOVED_PARAMS_KEY in gone, false);
  assert.equal('Chiller Temp (°C)' in gone, false);
});

test('non-Candela lasers are unchanged: DCD-named custom fields allowed and rendered', () => {
  const m = MODELS['Cynosure Apogee Elite MPX'];
  const r = addCustomReportParam({}, 'DCD Delay', '5', { model: m, names: ['Cynosure'] });
  assert.ok(r.ok);
  const stored = { 'Coolant Temp (°C)': '20', 'DCD Delay': '5' };
  const rows = systemParameterRows(stored, 'Cynosure Apogee Elite MPX', 'Cynosure Apogee Elite MPX');
  assert.ok(rows.some((x) => x.key === 'DCD Delay'));
  // full model param list still shown with no removals
  assert.deepEqual(visibleReportParams(m, {}).map(paramStorageKey), m.params.map(paramStorageKey));
  assert.equal(rows.filter((x) => x.value === '—').length, m.params.length - 1);
});

for (const model of ['Candela VPYag', 'Candela GentleYAG', 'Candela GentleMAX_PRO']) {
  test(`${model}: DCD Canister Shots is optional, not a default row`, () => {
    const m = MODELS[model];
    assert.ok(!m.params.map(paramStorageKey).includes('DCD Canister Shots'));
    const fresh = mergeModelParamValues(m, {});
    assert.ok(!('DCD Canister Shots' in fresh));
    assert.ok(!visibleReportParams(m, fresh).map(paramStorageKey).includes('DCD Canister Shots'));
    assert.ok(addableReportParams(m, fresh).map(paramStorageKey).includes('DCD Canister Shots'));
    const added = restoreReportParam(fresh, 'DCD Canister Shots');
    assert.ok(visibleReportParams(m, added).map(paramStorageKey).includes('DCD Canister Shots'));
    assert.ok(!addableReportParams(m, added).map(paramStorageKey).includes('DCD Canister Shots'));
    const removed = removeReportParam({ ...added, 'DCD Canister Shots': '5' }, 'DCD Canister Shots');
    assert.ok(!visibleReportParams(m, removed).map(paramStorageKey).includes('DCD Canister Shots'));
    assert.ok(addableReportParams(m, removed).map(paramStorageKey).includes('DCD Canister Shots'));
    const typed = addCustomReportParam(fresh, 'DCD Canister Shots', '7', { model: m });
    assert.ok(typed.ok && typed.values['DCD Canister Shots'] === '7' && !typed.values[CUSTOM_PARAMS_KEY]);
  });
  test(`${model}: old saved Canister Shots still shows on form, view and print`, () => {
    const m = MODELS[model];
    assert.ok(visibleReportParams(m, OLD_DCD).map(paramStorageKey).includes('DCD Canister Shots'));
    assert.ok(systemParameterRows(OLD_DCD, model, model).some((r) => r.key === 'DCD Canister Shots' && r.value === '300'));
    const html = buildServiceReportPrintHTML({ model_type: model, equipment_name: model, model_parameters: OLD_DCD } as any);
    assert.match(html, /DCD Canister Shots/);
    assert.doesNotMatch(html, /DCD (Delay|Duration)|Pre-spray|Post-spray|Cryogen/i);
  });
}
