import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  missingPastDueColumn,
  PAST_DUE_DOWNGRADE_DAYS,
  pastDueCutoffIso,
  pastDueDays,
  pastDueDowngradeDisabled,
  pastDueDowngradeDue,
} from './past-due.ts';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..', '..');
const DAY = 24 * 60 * 60 * 1000;
const SINCE = '2026-10-01T12:00:00.000Z';
const after = (ms: number) => new Date(Date.parse(SINCE) + ms);

test('the past_due window is 14 days', () => {
  assert.equal(PAST_DUE_DOWNGRADE_DAYS, 14);
});

test('day 13 (up to the last millisecond) is not due; 14 full days and later are', () => {
  assert.equal(pastDueDowngradeDue(SINCE, after(0)), false);
  assert.equal(pastDueDowngradeDue(SINCE, after(13 * DAY)), false);
  assert.equal(pastDueDowngradeDue(SINCE, after(14 * DAY - 1)), false);
  assert.equal(pastDueDowngradeDue(SINCE, after(14 * DAY)), true);
  assert.equal(pastDueDowngradeDue(SINCE, after(15 * DAY)), true);
  assert.equal(pastDueDowngradeDue(new Date(SINCE), after(14 * DAY)), true);
  assert.equal(pastDueDays(SINCE, after(14 * DAY - 1)), 13);
  assert.equal(pastDueDays(SINCE, after(14 * DAY)), 14);
});

test('missing, unparseable or future clocks are never due', () => {
  for (const value of [null, undefined, '', 'not a date']) {
    assert.equal(pastDueDowngradeDue(value as never, after(100 * DAY)), false, String(value));
    assert.equal(pastDueDays(value as never, after(100 * DAY)), null, String(value));
  }
  assert.equal(pastDueDowngradeDue(after(DAY).toISOString(), new Date(SINCE)), false);
});

test('the sweep cutoff is exactly 14 days before now', () => {
  assert.equal(pastDueCutoffIso(after(14 * DAY)), SINCE);
});

test('PAST_DUE_DOWNGRADE_DISABLED is only on for exactly "1"', () => {
  const prior = process.env.PAST_DUE_DOWNGRADE_DISABLED;
  try {
    delete process.env.PAST_DUE_DOWNGRADE_DISABLED;
    assert.equal(pastDueDowngradeDisabled(), false);
    process.env.PAST_DUE_DOWNGRADE_DISABLED = '0';
    assert.equal(pastDueDowngradeDisabled(), false);
    process.env.PAST_DUE_DOWNGRADE_DISABLED = ' 1 ';
    assert.equal(pastDueDowngradeDisabled(), true);
  } finally {
    if (prior === undefined) delete process.env.PAST_DUE_DOWNGRADE_DISABLED;
    else process.env.PAST_DUE_DOWNGRADE_DISABLED = prior;
  }
});

test('a missing past_due_since column is recognised (000928 not applied)', () => {
  assert.equal(missingPastDueColumn('column subscriptions.past_due_since does not exist'), true);
  assert.equal(missingPastDueColumn("Could not find the 'past_due_since' column"), true);
  assert.equal(missingPastDueColumn('permission denied'), false);
  assert.equal(missingPastDueColumn(null), false);
});

test('migration 000928 follows the migration rules and has an exact rollback', () => {
  const dir = join(web, 'supabase/migrations');
  const up = readFileSync(join(dir, '20261018_000928_subscriptions_past_due_clock.sql'), 'utf8');
  const down = readFileSync(join(dir, '20261018_000928_subscriptions_past_due_clock_rollback.sql'), 'utf8');
  for (const sql of [up, down]) {
    assert.match(sql, /^SET LOCAL lock_timeout = '5s';/);
    assert.doesNotMatch(sql, /pg_catalog\.(extract|coalesce)/i);
    assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT)\s*;/im);
  }
  assert.equal((up.match(/^ SECURITY DEFINER$/gm) || []).length, 1);
  assert.equal((up.match(/^ SET search_path = ''$/gm) || []).length, 1);
  assert.match(up, /REVOKE ALL ON FUNCTION public\.subscriptions_past_due_clock\(\) FROM PUBLIC;/);
  assert.match(up, /REVOKE ALL ON FUNCTION public\.subscriptions_past_due_clock\(\) FROM anon, authenticated, service_role;/);
  assert.doesNotMatch(up, /GRANT /);
  // Drift guard on the one function it creates (or re-creates on a re-run).
  assert.match(up, /exists with another body; refusing to overwrite/);
  assert.match(up, /<> '2a0d072a45f52660ba23f4822738c26a'/);
  // Conservative backfill: apply time, never retroactive.
  assert.match(up, /UPDATE public\.subscriptions\s+SET past_due_since = now\(\)\s+WHERE status = 'grace_period'\s+AND past_due_since IS NULL/);
  assert.doesNotMatch(up, /current_period_(start|end)|interval '/i);
  // Rollback drops exactly the four things 000928 adds.
  assert.match(down, /DROP TRIGGER IF EXISTS subscriptions_past_due_clock ON public\.subscriptions;/);
  assert.match(down, /DROP FUNCTION IF EXISTS public\.subscriptions_past_due_clock\(\);/);
  assert.match(down, /DROP INDEX IF EXISTS public\.subscriptions_past_due_since_idx;/);
  assert.match(down, /ALTER TABLE public\.subscriptions DROP COLUMN IF EXISTS past_due_since;/);
  assert.equal((down.match(/^(DROP|ALTER|CREATE|UPDATE|GRANT|REVOKE)\b/gm) || []).length, 4);
  assert.ok(existsSync(join(web, 'supabase/tests/20261018_subscriptions_past_due_clock.sql')));
});

test('scheduled function: hourly, env checked, kill switch, no URL handler output', () => {
  const fn = readFileSync(join(web, 'netlify/functions/past-due-downgrade.mts'), 'utf8');
  assert.match(fn, /export const config = \{\s*schedule: '23 \* \* \* \*',?\s*\}/);
  assert.match(fn, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(fn, /pastDueDowngradeDisabled\(\)/);
  assert.match(fn, /createNodeServiceClient\(/);
  assert.match(fn, /runPastDueSweep\(/);
  assert.doesNotMatch(fn, /new Response\(/);
  assert.doesNotMatch(fn, /path:/);
  const toml = readFileSync(join(web, '../netlify.toml'), 'utf8');
  assert.doesNotMatch(toml, /\[functions/);
});

/** Every relative / @/ import reachable from a file. */
function moduleGraph(entry: string): { files: string[]; aliasImports: string[] } {
  const seen = new Set<string>();
  const aliasImports: string[] = [];
  const resolveSpec = (from: string, spec: string) => {
    const base = spec.startsWith('@/') ? join(web, spec.slice(2)) : resolve(dirname(from), spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    throw new Error(`unresolved ${spec} from ${from}`);
  };
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] || m[2];
      if (spec.startsWith('@/')) aliasImports.push(`${file.slice(web.length + 1)} -> ${spec}`);
      if (spec.startsWith('.') || spec.startsWith('@/')) walk(resolveSpec(file, spec));
    }
  };
  walk(join(web, entry));
  return { files: [...seen].map((f) => f.slice(web.length + 1)), aliasImports };
}

test('the scheduled function graph uses relative imports only (no @/ alias for the function bundler)', () => {
  const graph = moduleGraph('netlify/functions/past-due-downgrade.mts');
  assert.deepEqual(graph.aliasImports, []);
  assert.ok(graph.files.includes('lib/billing/apply-org-downgrade.ts'));
  assert.ok(graph.files.includes('lib/billing/stripe-subscription.ts'));
  assert.ok(!graph.files.some((f) => f.startsWith('app/')), 'no Next route modules');
});

test('webhook route documents the 14-day past_due rule', () => {
  const src = readFileSync(join(web, 'app/api/billing/upgrade/webhook/route.ts'), 'utf8');
  assert.match(src, /past_due stays Premium for 14 days/);
  assert.doesNotMatch(src, /past_due included\) it\s+\* is logged and does not change the plan/);
});
