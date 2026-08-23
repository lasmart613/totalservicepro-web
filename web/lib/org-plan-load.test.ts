import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOrgPlanRow } from './org-plan-load.ts';

test('falls back to is_premium when plan columns are missing', async () => {
  let calls = 0;
  const client = {
    from() {
      return {
        select(columns: string) {
          return {
            eq() {
              return {
                async maybeSingle() {
                  calls += 1;
                  if (/subscription_tier|\bplan\b|manual_slots/.test(columns)) {
                    return {
                      data: null,
                      error: { message: "Could not find the 'subscription_tier' column of 'organizations'" },
                    };
                  }
                  return { data: { is_premium: true, name: 'Acme' }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  const row = await loadOrgPlanRow(client, 12);
  assert.equal(row?.is_premium, true);
  assert.equal(row?.name, 'Acme');
  assert.ok(calls >= 2);
});
