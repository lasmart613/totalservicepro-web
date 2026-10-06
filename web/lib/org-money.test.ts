import assert from 'node:assert/strict';
import test from 'node:test';
import { canEditOrgCurrency, loadOrgMoneyPrefs, validateOrgMoneyFields } from './org-money.ts';

test('only owner and admin roles may edit organization currency', () => {
  for (const role of ['admin', 'company_admin', 'owner', 'Owner']) {
    assert.equal(canEditOrgCurrency(role), true, role);
  }
  for (const role of ['service_manager', 'billing_manager', 'fse', 'customer', 'supplier', '']) {
    assert.equal(canEditOrgCurrency(role), false, role);
  }
});

test('currency writes are an allowlist', () => {
  assert.deepEqual(validateOrgMoneyFields({ currency_code: 'brl', number_format: 'auto' }), {
    ok: true,
    fields: { currency_code: 'BRL', number_format: 'auto' },
  });
  const bad = validateOrgMoneyFields({ currency_code: 'USDX' });
  assert.equal(bad.ok, false);
  const badFormat = validateOrgMoneyFields({ number_format: 'custom' });
  assert.equal(badFormat.ok, false);
});

test('a missing currency column falls back to USD instead of throwing', async () => {
  const calls: string[] = [];
  const client = {
    from() {
      return {
        select(columns: string) {
          return {
            eq() {
              return {
                async maybeSingle() {
                  calls.push(columns);
                  if (columns.includes('currency_code')) {
                    return { data: null, error: { message: "Could not find the 'currency_code' column of 'organizations' in the schema cache" } };
                  }
                  return { data: { name: 'Shop' }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  const prefs = await loadOrgMoneyPrefs(client, 7);
  assert.deepEqual(prefs, { currencyCode: 'USD', numberFormat: 'auto' });
  assert.ok(calls.some((columns) => columns === 'name'));
});
