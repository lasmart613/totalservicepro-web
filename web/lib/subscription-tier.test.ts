import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { subscriptionTier } from './subscription-tier.ts';

const now = new Date('2026-10-06T00:00:00.000Z');

test('no subscription row is the free tier', () => {
  assert.equal(subscriptionTier(null, now), 'free');
  assert.equal(subscriptionTier(undefined as unknown as null, now), 'free');
  assert.equal(subscriptionTier({ tier: 'premium', status: 'inactive', expires_at: null }, now), 'free');
  assert.equal(
    subscriptionTier({ tier: 'premium', status: 'active', expires_at: '2026-10-01T00:00:00.000Z' }, now),
    'free'
  );
  assert.equal(
    subscriptionTier({ tier: 'premium', status: 'active', expires_at: '2026-12-01T00:00:00.000Z' }, now),
    'premium'
  );
});

test('subscription check uses maybeSingle and web clients do not use .single()', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const edge = readFileSync(join(here, '../../supabase/functions/grok-assistant/index.ts'), 'utf8');
  const lookup = edge.slice(edge.indexOf("from('subscriptions')"), edge.indexOf("from('subscriptions')") + 280);
  assert.match(lookup, /\.maybeSingle\(\)/);
  assert.doesNotMatch(lookup, /\.single\(\)/);
  assert.match(edge, /sub\?\.status === 'active' && sub\?\.tier \? sub\.tier : 'free'/);

  const web = readFileSync(join(here, './billing/persist-org-upgrade.ts'), 'utf8');
  assert.match(web, /from\('subscriptions'\)/);
  assert.doesNotMatch(web, /from\('subscriptions'\)[\s\S]{0,180}\.single\(\)/);
});
