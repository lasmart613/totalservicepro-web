import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const adsTxtPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'ads.txt');

test('public/ads.txt is the single Google AdSense seller line', () => {
  const body = readFileSync(adsTxtPath, 'utf8');
  assert.equal(body, 'google.com, pub-5353320292042327, DIRECT, f08c47fec0942fa0\n');
});
