import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const mainSrc = join(repo, 'app/src/main/java/com/photometrytools/GeoMapsUrl.java');
const testSrc = join(repo, 'app/src/test/java/com/photometrytools/GeoMapsUrlTest.java');

test('mapsSearchUrlFromGeo reads ?q= on opaque geo URIs and builds the https Maps URL', () => {
  const out = mkdtempSync(join(tmpdir(), 'geomaps-'));
  const compiled = spawnSync('javac', ['-d', out, mainSrc, testSrc], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
  const ran = spawnSync('java', ['-cp', out, 'com.photometrytools.GeoMapsUrlTest'], { encoding: 'utf8' });
  assert.equal(ran.status, 0, `${ran.stderr || ''}${ran.stdout || ''}`);
  assert.match(ran.stdout, /GeoMapsUrlTest ok/);
});
