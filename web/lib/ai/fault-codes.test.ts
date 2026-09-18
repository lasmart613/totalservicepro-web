import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import {
  extractFaultCode,
  extractFaultCodes,
  MAX_FAULT_CODES,
} from '../../../supabase/functions/grok-assistant/fault-codes.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('extracts paired technician codes including E-prefix and lookup phrasing', () => {
  assert.deepEqual(extractFaultCodes('I am getting 322 and 367 error codes'), ['322', '367']);
  assert.deepEqual(extractFaultCodes('E322 and E367 on Cutera Xeo'), ['322', '367']);
  assert.deepEqual(extractFaultCodes('e322 / e367'), ['322', '367']);
  assert.deepEqual(extractFaultCodes('look up 322 for Cutera Xeo'), ['322']);
  assert.deepEqual(extractFaultCodes('look up 322 or 367 for the Cutera Xeo'), ['322', '367']);
  assert.deepEqual(extractFaultCodes('F-322 alarm'), ['322']);
  assert.equal(extractFaultCode('getting 322 and 367 error codes'), '322');
  assert.equal(extractFaultCode('no codes here'), null);
});

test('keeps Candela-style prefixes and strips E/F to the DB numeric', () => {
  assert.deepEqual(extractFaultCodes('W-123 on the Vbeam'), ['W-123']);
  assert.deepEqual(extractFaultCodes('ER 45 flashing'), ['ER45']);
  assert.deepEqual(extractFaultCodes('F-12.5 alarm on UltraPulse'), ['12.5']);
});

test('caps noise and skips years / wavelength units', () => {
  const many = 'errors 101 102 103 104 105 106 107';
  assert.equal(extractFaultCodes(many).length, MAX_FAULT_CODES);
  assert.deepEqual(extractFaultCodes('error 322 on a 2024 Cutera Xeo'), ['322']);
  assert.deepEqual(extractFaultCodes('look up 322 at 532 nm'), ['322']);
  assert.deepEqual(extractFaultCodes('the Xeo is down'), []);
});

test('grok-assistant searches the selected service manual before fault_codes', () => {
  const fn = readFileSync(join(here, '../../../supabase/functions/grok-assistant/index.ts'), 'utf8');
  assert.match(fn, /extractFaultCodes/);
  assert.match(fn, /from '\.\/fault-codes\.ts'/);
  assert.match(fn, /selected service manual first/i);
  assert.match(fn, /AUTHORITATIVE for fault meaning/);
  assert.doesNotMatch(
    fn,
    /When FAULT CODE LOOKUP RESULT is provided: treat it as the authoritative/
  );
  const chat = fn.slice(fn.indexOf("body.action === 'chat'"));
  assert.match(chat, /Promise\.all\(\[searchP, resolveP\]\)/);
  const searchCall = chat.indexOf('searchManualCollection');
  const lookupCall = chat.indexOf('await applyFaultLookup()');
  assert.ok(searchCall >= 0 && lookupCall > searchCall, 'manual search must run before fault DB lookup');
  assert.match(fn, /await lookupFaultCode/);
  assert.match(fn, /!hasManualPassages && !hasCollectionPdfs && faultCodes\.length/);
  assert.match(fn, /collectionHitsFromResponse/);
  assert.match(fn, /file_id: s\.fileId/);
});
