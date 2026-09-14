import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TICKET_PREFIX_ALPHABET,
  TICKET_PREFIX_FALLBACK,
  TICKET_PREFIX_LEN,
  allocateTicketPrefix,
  allocateTicketPrefixBrokenChar3,
  hashedTicketPrefix,
  mnemonicTicketPrefix,
} from './ticket-prefix.ts';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, '../supabase/migrations/20260914_000001_fix_org_ticket_prefix_char3.sql'),
  'utf8'
);
const pending = readFileSync(join(here, './pending-signup.ts'), 'utf8');

test('mnemonic is always exactly 3 characters from letters only', () => {
  assert.equal(mnemonicTicketPrefix('Shop Repair Inc'), 'SHO');
  assert.equal(mnemonicTicketPrefix('Northshore Clinic'), 'NOR');
  assert.equal(mnemonicTicketPrefix('SH Laser'), 'SHL');
  assert.equal(mnemonicTicketPrefix('AB'), 'ABX');
  assert.equal(mnemonicTicketPrefix('A'), 'AXX');
  assert.equal(mnemonicTicketPrefix('123'), TICKET_PREFIX_FALLBACK);
  assert.equal(mnemonicTicketPrefix(''), TICKET_PREFIX_FALLBACK);
  assert.equal(mnemonicTicketPrefix(null), TICKET_PREFIX_FALLBACK);
});

test('legacy collision path emits SH10 (4 chars) after SH1–SH9 — the live bug', () => {
  const taken = ['SHO', 'SH1', 'SH2', 'SH3', 'SH4', 'SH5', 'SH6', 'SH7', 'SH8', 'SH9'];
  const next = allocateTicketPrefixBrokenChar3('Shop Repair Inc', taken);
  assert.equal(next, 'SH10');
  assert.ok(next.length > TICKET_PREFIX_LEN);
});

test('new scheme uses SH0 after the mnemonic, then SH1–SH9, then SHA', () => {
  const taken: string[] = [];
  const first = allocateTicketPrefix('Shop Repair Inc', taken);
  assert.equal(first, 'SHO');
  taken.push(first);

  const second = allocateTicketPrefix('Shop Repair Inc', taken);
  assert.equal(second, 'SH0');
  taken.push(second);

  for (let n = 1; n <= 9; n++) {
    const p = allocateTicketPrefix('Shop Repair Inc', taken);
    assert.equal(p, `SH${n}`);
    assert.equal(p.length, TICKET_PREFIX_LEN);
    taken.push(p);
  }

  const afterDigits = allocateTicketPrefix('Shop Repair Inc', taken);
  assert.equal(afterDigits, 'SHA');
  assert.equal(afterDigits.length, TICKET_PREFIX_LEN);
});

test('collision path never emits a prefix longer than 3 characters under load', () => {
  const taken: string[] = [];
  const seen = new Set<string>();
  // 1 mnemonic + 36 stem suffixes + several hash fallbacks
  for (let i = 0; i < 50; i++) {
    const prefix = allocateTicketPrefix('Shop Repair Inc', taken, { id: 1000 + i });
    assert.equal(prefix.length, TICKET_PREFIX_LEN);
    assert.match(prefix, /^[0-9A-Z]{3}$/);
    assert.equal(seen.has(prefix), false, `duplicate ${prefix} at i=${i}`);
    seen.add(prefix);
    taken.push(prefix);
  }
  assert.equal(taken[0], 'SHO');
  assert.equal(taken[1], 'SH0');
  assert.equal(taken[10], 'SH9');
  assert.equal(taken[11], 'SHA');
  // SHO is already used as the mnemonic, so the A–Z sweep skips it.
  // 1 mnemonic + 10 digits + 25 remaining letters = 36 stem-space codes; index 35 is SHZ.
  assert.equal(taken[35], 'SHZ');
  assert.equal(taken.includes('SHO'), true);
  assert.ok(taken[36] !== 'SH10');
  assert.equal(taken[36].length, TICKET_PREFIX_LEN);
  assert.match(taken[36], /^[0-9A-Z]{3}$/);
});

test('hash fallback stays unique when stem suffixes are exhausted', () => {
  const mnemonic = mnemonicTicketPrefix('Service Company');
  const stem = mnemonic.slice(0, 2);
  const taken = [mnemonic, ...[...TICKET_PREFIX_ALPHABET].map((ch) => `${stem}${ch}`)];
  const next = allocateTicketPrefix('Service Company', taken, { id: 42 });
  assert.equal(next, hashedTicketPrefix('Service Company', 42, 1));
  // Locked to live Postgres: md5('Service Company|42|1') bytes 6,122,77 → 6E5
  assert.equal(next, '6E5');
  assert.equal(next.length, TICKET_PREFIX_LEN);
  assert.equal(taken.includes(next), false);
});

test('many orgs sharing the same base letters all get distinct 3-char prefixes', () => {
  const names = [
    'Shop A',
    'Shop B',
    'Shoreline Repair',
    'Sharon Laser',
    'South Hills Service',
    'SH Medical',
  ];
  const taken: string[] = [];
  for (const name of names) {
    for (let copy = 0; copy < 8; copy++) {
      const prefix = allocateTicketPrefix(name, taken, { id: `${name}-${copy}` });
      assert.equal(prefix.length, TICKET_PREFIX_LEN);
      assert.equal(taken.includes(prefix), false);
      taken.push(prefix);
    }
  }
  assert.equal(taken.length, names.length * 8);
  assert.equal(new Set(taken).size, taken.length);
});

test('migration replaces the live function and keeps character(3)', () => {
  assert.match(migration, /set_org_ticket_prefix/);
  assert.match(migration, /trg_org_ticket_prefix/);
  assert.match(migration, /character\(3\)/);
  assert.match(migration, /APPLY ON LIVE SUPABASE/);
  assert.match(migration, /0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/);
  assert.match(migration, /LEFT\(mnemonic, 2\)/);
  assert.doesNotMatch(migration, /ALTER\s+TABLE[\s\S]*ticket_prefix[\s\S]*TYPE/i);
  assert.doesNotMatch(migration, /LEFT\(base_prefix,\s*2\)\s*\|\|\s*counter::TEXT/);
  assert.doesNotMatch(migration, /ticket_prefix\s+TYPE\s+(text|varchar|character\(4\))/i);
});

test('shop signup still omits ticket_prefix so the live trigger can uniquify', () => {
  assert.match(pending, /organizationInsertFromPending/);
  assert.doesNotMatch(pending, /ticket_prefix\s*:/);
});
