import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PLAN_AUDIENCE,
  FIND_WORK_BID_LINE,
  FREE_MANUALS_LINE,
  FREE_TRIAL_LINE,
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
import { UNLIMITED_MANUAL_SLOTS } from '../org-plan.ts';

const TILES = ['free', 'premium', 'team'] as const;

test('weekly updates perk is one shared phrase', () => {
  assert.equal(WEEKLY_UPDATES_LINE, 'New features added weekly');
});

test('manual entitlements: Premium 15, Team unlimited (999 in code)', () => {
  assert.equal(PREMIUM_MANUALS_LINE, '15 service manuals');
  assert.equal(TEAM_MANUALS_LINE, 'Unlimited service manuals');
  assert.equal(UNLIMITED_MANUAL_SLOTS, 999);
});

test('audience pills are Service Company, Laser Owner, Parts Supplier', () => {
  assert.deepEqual(
    PLAN_AUDIENCE_OPTIONS.map((a) => a.label),
    ['Service Company', 'Laser Owner', 'Parts Supplier']
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
  assert.equal(parsePlanAudience('unknown'), 'company');
});

test('landing Free Plan hrefs stay on /plans with role query', () => {
  assert.equal(plansHrefForAudience('company'), '/plans');
  assert.equal(plansHrefForAudience('owner'), '/plans?role=owner');
  assert.equal(plansHrefForAudience('supplier'), '/plans?role=supplier');
});

test('swipe wraps the three audiences', () => {
  assert.equal(nextPlanAudience('company', 1), 'owner');
  assert.equal(nextPlanAudience('supplier', 1), 'company');
  assert.equal(nextPlanAudience('company', -1), 'supplier');
});

test('shared entitlements appear on every audience and every tier', () => {
  for (const audience of PLAN_AUDIENCES) {
    for (const tile of TILES) {
      const lines = planTileLines(audience, tile);
      assert.ok(lines.includes(WEEKLY_UPDATES_LINE), `${audience} ${tile} weekly`);
      assert.ok(lines.includes(SHARED_SERVICE_HISTORY_LINE), `${audience} ${tile} history`);
      assert.equal(
        lines.filter((l) => /unlimited/i.test(l) && l !== TEAM_MANUALS_LINE).length,
        0,
        `${audience} ${tile} only the Team manuals line may say unlimited`
      );
    }
  }
});

test('repair AI appears on Service Company tiles only', () => {
  assert.ok(planTileLines('company', 'free').includes(FREE_AI_LINE));
  assert.ok(planTileLines('company', 'premium').includes(PREMIUM_AI_LINE));
  assert.ok(planTileLines('company', 'team').includes(TEAM_AI_LINE));

  for (const audience of ['owner', 'supplier'] as const) {
    for (const tile of TILES) {
      const lines = planTileLines(audience, tile);
      assert.ok(!lines.includes(FREE_AI_LINE), `${audience} ${tile} free AI`);
      assert.ok(!lines.includes(PREMIUM_AI_LINE), `${audience} ${tile} premium AI`);
      assert.ok(!lines.includes(TEAM_AI_LINE), `${audience} ${tile} team AI`);
      assert.equal(
        lines.filter((l) => /AI quer/i.test(l)).length,
        0,
        `${audience} ${tile} must not advertise repair AI`
      );
    }
  }
});

test('service manuals appear on Service Company tiles only', () => {
  assert.ok(planTileLines('company', 'premium').includes(PREMIUM_MANUALS_LINE));
  assert.ok(planTileLines('company', 'team').includes(TEAM_MANUALS_LINE));
  assert.equal(PREMIUM_MANUALS_LINE, '15 service manuals');
  assert.equal(TEAM_MANUALS_LINE, 'Unlimited service manuals');

  for (const audience of ['owner', 'supplier'] as const) {
    for (const tile of TILES) {
      const lines = planTileLines(audience, tile);
      assert.equal(
        lines.filter((l) => /service manuals/i.test(l) && l !== FREE_MANUALS_LINE).length,
        0,
        `${audience} ${tile} must not advertise paid service manual counts`
      );
      assert.ok(!lines.includes(PREMIUM_MANUALS_LINE), `${audience} ${tile} premium manuals`);
      assert.ok(!lines.includes(TEAM_MANUALS_LINE), `${audience} ${tile} team manuals`);
    }
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
  assert.match(premium, /storefront/i);
  assert.doesNotMatch(premium, /featured|premium placement/i);
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
  assert.ok(PLAN_TILE_COPY.company.free.some((l) => /schedule service calls/i.test(l)));
  assert.ok(PLAN_TILE_COPY.owner.free.some((l) => /rated repair/i.test(l)));
  assert.ok(PLAN_TILE_COPY.supplier.free.some((l) => /one .*photo/i.test(l)));
});

test('Free tile lists 10 library manuals for every role', () => {
  assert.equal(FREE_MANUALS_LINE, '10 service manuals in your library');
  for (const audience of PLAN_AUDIENCES) {
    assert.ok(planTileLines(audience, 'free').includes(FREE_MANUALS_LINE), `${audience} free manuals`);
  }
  for (const audience of PLAN_AUDIENCES) {
    for (const tile of TILES) {
      assert.equal(
        planTileLines(audience, tile).filter((l) => /\b5 (service )?manuals/i.test(l)).length,
        0,
        `${audience} ${tile} old 5 manuals copy`
      );
    }
  }
});

test('Free Service Company tile mentions the 60-day Premium trial', () => {
  assert.match(FREE_TRIAL_LINE, /60-day free Premium trial/);
  assert.ok(planTileLines('company', 'free').includes(FREE_TRIAL_LINE));
});

test('bidding is on Free, never presented as Premium-only', () => {
  assert.ok(planTileLines('company', 'free').includes(FIND_WORK_BID_LINE));
  for (const audience of PLAN_AUDIENCES) {
    for (const tile of ['premium', 'team'] as const) {
      assert.equal(
        planTileLines(audience, tile).filter((l) => /\bbid\b/i.test(l)).length,
        0,
        `${audience} ${tile} bid line`
      );
    }
  }
});

test('new Free tile lines are translated in every locale', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  for (const loc of ['ar', 'de', 'es', 'fa', 'fr', 'he', 'it', 'pt']) {
    const src = readFileSync(fileURLToPath(new URL(`../${loc}/copy.ts`, import.meta.url)), 'utf8');
    for (const line of [FREE_MANUALS_LINE, FREE_TRIAL_LINE, FIND_WORK_BID_LINE]) {
      assert.ok(src.includes(`'${line}':`), `${loc} missing ${line}`);
    }
  }
});
