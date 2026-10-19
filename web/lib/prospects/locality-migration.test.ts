import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '../../supabase/migrations');
const mig = readFileSync(join(dir, '20261018_000933_find_clinics_locality.sql'), 'utf8');
const rollback = readFileSync(join(dir, '20261018_000933_find_clinics_locality_rollback.sql'), 'utf8');
const m929 = readFileSync(join(dir, '20261018_000929_organizations_country.sql'), 'utf8');

const NEW_FNS = [
  'prospect_fold(text)',
  'prospect_city_key(text)',
  'prospect_country_code(text)',
  'prospect_region_key(text, text)',
  'prospect_pool_rows_local(bigint, text, text, text)',
];

function fnBlocks(sql: string): string[] {
  return sql.split(/(?=CREATE OR REPLACE FUNCTION )/).slice(1).map((b) => b.slice(0, b.indexOf('\n$$;') + 4));
}

test('000933: one transaction with lock_timeout, and flagged for renumbering', () => {
  const body = mig.replace(/^--.*$/gm, '');
  assert.match(body, /^\s*BEGIN;\s*\n\s*SET LOCAL lock_timeout = '5s';/m);
  assert.match(body.trimEnd(), /COMMIT;$/);
  assert.match(mig, /MAY NEED RENUMBERING/);
  assert.match(rollback.replace(/^--.*$/gm, ''), /^\s*BEGIN;\s*\n\s*SET LOCAL lock_timeout = '5s';/m);
});

test('000933: every function is SECURITY DEFINER with an empty search_path', () => {
  const blocks = fnBlocks(mig);
  assert.equal(blocks.length, 6);
  for (const b of blocks) {
    assert.match(b, /\nSECURITY DEFINER\nSET search_path = ''\n/, b.slice(0, 80));
  }
});

test('000933: helpers are revoked from PUBLIC, anon and authenticated; the RPC stays authenticated-only', () => {
  for (const f of NEW_FNS) {
    assert.ok(mig.includes(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`), f);
    assert.ok(!new RegExp(`GRANT[^;]*public\\.${f.replace(/[()]/g, '\\$&')}`).test(mig), `no grant on ${f}`);
  }
  assert.ok(mig.includes('REVOKE ALL ON FUNCTION public.find_clinic_prospects(text, text, int, int) FROM PUBLIC, anon;'));
  assert.ok(mig.includes('GRANT EXECUTE ON FUNCTION public.find_clinic_prospects(text, text, int, int) TO authenticated;'));
});

test('000933: drift guards cover helper names and a foreign find_clinic_prospects', () => {
  assert.match(mig, /a 000933 helper name already exists and was not created by 000933/);
  assert.match(mig, /find_clinic_prospects was not created by 000929\/000933/);
  assert.match(mig, /000929 must be applied first/);
});

test('000933 rollback restores the 000929 find_clinic_prospects byte for byte and drops every helper', () => {
  const start = m929.indexOf('CREATE OR REPLACE FUNCTION public.find_clinic_prospects(');
  const end = m929.indexOf("Premium = paged rows.';", start) + "Premium = paged rows.';".length;
  assert.ok(start > 0 && end > start);
  assert.ok(rollback.includes(m929.slice(start, end)));
  for (const f of NEW_FNS) assert.ok(rollback.includes(`DROP FUNCTION IF EXISTS public.${f};`), f);
  assert.ok(!/(CREATE OR REPLACE|DROP) FUNCTION[^\n]*(prospect_state_key|prospect_pool_rows\()/.test(rollback), 'rollback leaves 000929 helpers alone');
  assert.ok(!/(CREATE OR REPLACE|DROP) FUNCTION[^\n]*(prospect_state_key|prospect_pool_rows\(|add_prospect_customer|org_is_paid_entitled)/.test(mig), '000933 leaves 000929 helpers alone');
});

test('000933 region maps: AB/Alberta, SP/São Paulo, QC/Québec, NL/Nuevo León resolve to one key', () => {
  const bycc = JSON.parse(mig.match(/ELSE coalesce\(v\.cc \|\| ':' \|\| \('(\{.*?\})'::jsonb/)![1].replace(/''/g, "'"));
  const nocc = JSON.parse(mig.match(/WHEN v\.cc IS NULL THEN coalesce\('(\{.*?\})'::jsonb/)![1].replace(/''/g, "'"));
  assert.equal(bycc['CA|ab'], 'AB');
  assert.equal(bycc['CA|alberta'], 'AB');
  assert.equal(bycc['CA|alta'], 'AB');
  assert.equal(bycc['BR|sp'], 'SP');
  assert.equal(bycc['BR|sao paulo'], 'SP');
  assert.equal(bycc['CA|quebec'], 'QC');
  assert.equal(bycc['MX|nl'], 'NLE');
  assert.equal(bycc['MX|nuevo leon'], 'NLE');
  assert.equal(bycc['MX|cdmx'], 'CMX');
  assert.equal(bycc['US|arizona'], 'AZ');
  assert.equal(nocc['ab'], 'CA:AB');
  assert.equal(nocc['sp'], 'BR:SP');
  assert.equal(nocc['az'], 'US:AZ');
  // country-specific abbreviations are never guessed without a country
  assert.equal(nocc['alta'], undefined);
  assert.equal(nocc['cdmx'], undefined);
  // all 13 provinces/territories, 27 BR units, 32 MX states, 50 states + DC + PR
  const codes = (cc: string) => new Set(Object.entries(bycc).filter(([k]) => k.startsWith(cc + '|')).map(([, v]) => v));
  assert.equal(codes('CA').size, 13);
  assert.equal(codes('BR').size, 27);
  assert.equal(codes('MX').size, 32);
  assert.equal(codes('US').size, 52);
});
