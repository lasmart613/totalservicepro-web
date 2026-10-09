import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapsSearchUrlFromGeo, queryAfterQ } from './geo-maps-url.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const mainSrc = join(repo, 'app/src/main/java/com/photometrytools/GeoMapsUrl.java');
const testSrc = join(repo, 'app/src/test/java/com/photometrytools/GeoMapsUrlTest.java');

const TEMPE = 'https://www.google.com/maps/search/?api=1&query=Tempe%2C%20AZ';
const MAIN_ST =
  'https://www.google.com/maps/search/?api=1&query=100%20Main%20St%2C%20Evanston%2C%20IL%2060201';

test('mapsSearchUrlFromGeo reads ?q= on opaque geo URIs and builds the https Maps URL', () => {
  assert.equal(queryAfterQ('geo:0,0?q=Tempe%2C%20AZ'), 'Tempe%2C%20AZ');
  assert.equal(queryAfterQ('geo:0,0?q=Tempe%2C%20AZ&z=16'), 'Tempe%2C%20AZ');
  assert.equal(queryAfterQ('geo:0,0?q='), null);
  assert.equal(queryAfterQ('geo:0,0'), null);
  assert.equal(queryAfterQ(null), null);

  assert.equal(mapsSearchUrlFromGeo('geo:0,0?q=Tempe%2C%20AZ'), TEMPE);
  assert.equal(mapsSearchUrlFromGeo('geo:0,0?q=100%20Main%20St%2C%20Evanston%2C%20IL%2060201'), MAIN_ST);
  assert.equal(mapsSearchUrlFromGeo('geo:0,0?q=Tempe%2C%20AZ&z=16'), TEMPE);
  assert.equal(mapsSearchUrlFromGeo('geo:0,0?q='), null);
  assert.equal(mapsSearchUrlFromGeo('geo:0,0'), null);
  assert.equal(mapsSearchUrlFromGeo(null), null);
  assert.equal(mapsSearchUrlFromGeo('geo:0,0?q=%20%20'), null);
  // URLSearchParams would turn this '+' into a space and re-emit '+'.
  assert.equal(
    mapsSearchUrlFromGeo('geo:0,0?q=Tempe,+AZ'),
    'https://www.google.com/maps/search/?api=1&query=Tempe%2C%2BAZ'
  );
  assert.equal(mapsSearchUrlFromGeo('geo:0,0?q=Fun%21'), 'https://www.google.com/maps/search/?api=1&query=Fun!');
  assert.equal(TEMPE.includes('+'), false);
  assert.equal(MAIN_ST.includes('+'), false);

  // A form encoder (URLEncoder / URLSearchParams) emits '+'. Output must still be %20.
  const formEncode = (value) =>
    new URLSearchParams([['q', value]]).toString().slice(2);
  assert.match(formEncode('Tempe, AZ'), /\+/);
  assert.equal(
    mapsSearchUrlFromGeo('geo:0,0?q=Tempe%2C%20AZ', undefined, formEncode),
    TEMPE
  );

  const out = mkdtempSync(join(tmpdir(), 'geomaps-'));
  const compiled = spawnSync('javac', ['-d', out, mainSrc, testSrc], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout || 'javac failed');
  const ran = spawnSync('java', ['-cp', out, 'com.photometrytools.GeoMapsUrlTest'], { encoding: 'utf8' });
  assert.equal(ran.status, 0, `${ran.stderr || ''}${ran.stdout || ''}`);
  assert.match(ran.stdout || '', /GeoMapsUrlTest ok/);
});
