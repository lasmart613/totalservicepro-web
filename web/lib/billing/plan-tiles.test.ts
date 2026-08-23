import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PLAN_AUDIENCE,
  FREE_AI_LINE,
  PLAN_AUDIENCES,
  PLAN_AUDIENCE_OPTIONS,
  PLAN_TILE_COPY,
  PREMIUM_AI_LINE,
  PREMIUM_MANUALS_LINE,
  SHARED_SERVICE_HISTORY_LINE,
  TEAM_AI_LINE,
  TEAM_MANUALS_LINE,
  WEEKLY_UPDATES_LINE,
  nextPlanAudience,
  parsePlanAudience,
  planTileLines,
  plansHrefForAudience,
} from './plan-tiles.ts';

const TILES = ['free', 'premium', 'team'] as const;

test('weekly updates perk is one shared phrase', () => {
  assert.equal(WEEKLY_UPDATES_LINE, 'New features added weekly');
});

test('manual entitlements stay Premium 15 and Team 50', () => {
  assert.equal(PREMIUM_MANUALS_LINE, '15 service manuals');
  assert.equal(TEAM_MANUALS_LINE, '50 service manuals');
  assert.doesNotMatch(TEAM_MANUALS_LINE, /unlimited/i);
});

test('audience pills are Service Company, Laser Owner, Parts Supplier, Manufacturer', () => {
  assert.deepEqual(
    PLAN_AUDIENCE_OPTIONS.map((a) => a.label),
    ['Service Company', 'Laser Owner', 'Parts Supplier', 'Manufacturer']
  );
  assert.equal(DEFAULT_PLAN_AUDIENCE, 'company');
});

test('?role=owner|supplier|company parse, with landing aliases', () => {
  assert.equal(parsePlanAudience(undefined), 'company');
  assert.equal(parsePlanAudience(''), 'company');
  assert.equal(parsePlanAudience('company'), 'company');
  assert.equal(parsePlanAudience('shop'), 'company');
  assert.equal(parsePlanAudience('owner'), 'owner');
  assert.equal(parsePlanAudience('clinic'), 'owner');
  assert.equal(parsePlanAudience('supplier'), 'supplier');
  assert.equal(parsePlanAudience('parts'), 'supplier');
  assert.equal(parsePlanAudience('manufacturer'), 'manufacturer');
  assert.equal(parsePlanAudience('oem'), 'manufacturer');
  assert.equal(parsePlanAudience('unknown'), 'company');
});

test('landing Free Plan hrefs stay on /plans with role query', () => {
  assert.equal(plansHrefForAudience('company'), '/plans');
  assert.equal(plansHrefForAudience('owner'), '/plans?role=owner');
  assert.equal(plansHrefForAudience('supplier'), '/plans?role=supplier');
  assert.equal(plansHrefForAudience('manufacturer'), '/plans?role=manufacturer');
});

test('swipe wraps the four audiences', () => {
  assert.equal(nextPlanAudience('company', 1), 'owner');
  assert.equal(nextPlanAudience('manufacturer', 1), 'company');
  assert.equal(nextPlanAudience('company', -1), 'manufacturer');
});

const SHOP_AUDIENCES = ['company', 'owner', 'supplier'] as const;

test('shared entitlements appear on every audience and every tier', () => {
  for (const audience of PLAN_AUDIENCES) {
    for (const tile of TILES) {
      const lines = planTileLines(audience, tile);
      assert.ok(lines.includes(WEEKLY_UPDATES_LINE), `${audience} ${tile} weekly`);
      assert.ok(lines.includes(SHARED_SERVICE_HISTORY_LINE), `${audience} ${tile} history`);
      assert.equal(
        lines.filter((l) => /unlimited/i.test(l)).length,
        0,
        `${audience} ${tile} must not say unlimited`
      );
    }
  }
  for (const audience of SHOP_AUDIENCES) {
    assert.ok(planTileLines(audience, 'free').includes(FREE_AI_LINE));
    assert.ok(planTileLines(audience, 'premium').includes(PREMIUM_AI_LINE));
    assert.ok(planTileLines(audience, 'premium').includes(PREMIUM_MANUALS_LINE));
    assert.ok(planTileLines(audience, 'team').includes(TEAM_AI_LINE));
    assert.ok(planTileLines(audience, 'team').includes(TEAM_MANUALS_LINE));
  }
});

test('manufacturer tiles stay conservative — no shop AI, manuals, or query counts', () => {
  for (const tile of TILES) {
    const blob = planTileLines('manufacturer', tile).join('\n');
    assert.doesNotMatch(blob, /service manuals/i);
    assert.doesNotMatch(blob, /AI queries/i);
    assert.doesNotMatch(blob, /\b\d+\s+text\b/i);
    assert.doesNotMatch(blob, /bid on open service/i);
    assert.doesNotMatch(blob, /schedule service calls/i);
  }
});

test('Parts Supplier photo entitlements are locked by tier', () => {
  const free = planTileLines('supplier', 'free').join('\n');
  const premium = planTileLines('supplier', 'premium').join('\n');
  const team = planTileLines('supplier', 'team').join('\n');

  assert.match(free, /one .*photo/i);
  assert.match(free, /low-res|smaller/i);
  assert.doesNotMatch(free, /multiple|hi-res|featured|storefront/i);

  assert.match(premium, /multiple/i);
  assert.match(premium, /hi-res/i);
  assert.doesNotMatch(premium, /featured|storefront|premium placement/i);
  assert.doesNotMatch(premium, /%/);
  assert.doesNotMatch(premium, /\b\d{2,}\s+(sku|listings?)\b/i);

  assert.match(team, /hi-res/i);
  assert.match(team, /featured|premium placement/i);
  assert.match(team, /storefront/i);
  assert.doesNotMatch(team, /%/);
  assert.doesNotMatch(team, /\b\d{2,}\s+(sku|listings?)\b/i);
});

test('audience copy stays separate — do not merge roles', () => {
  assert.notDeepEqual(PLAN_TILE_COPY.company.free, PLAN_TILE_COPY.owner.free);
  assert.notDeepEqual(PLAN_TILE_COPY.company.free, PLAN_TILE_COPY.supplier.free);
  assert.notDeepEqual(PLAN_TILE_COPY.company.free, PLAN_TILE_COPY.manufacturer.free);
  assert.ok(PLAN_TILE_COPY.company.free.some((l) => /schedule service calls/i.test(l)));
  assert.ok(PLAN_TILE_COPY.owner.free.some((l) => /rated repair/i.test(l)));
  assert.ok(PLAN_TILE_COPY.supplier.free.some((l) => /one .*photo/i.test(l)));
  assert.ok(PLAN_TILE_COPY.manufacturer.free.some((l) => /OEM|factory|directory/i.test(l)));
});
