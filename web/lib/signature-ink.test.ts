import assert from 'node:assert/strict';
import test from 'node:test';
import { pixelsHaveInk } from './signature-ink.ts';

function px(n: number, rgba: [number, number, number, number]) {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) out.set(rgba, i * 4);
  return out;
}

test('all-white and all-transparent pads have no ink', () => {
  assert.equal(pixelsHaveInk(px(32000, [255, 255, 255, 255])), false);
  assert.equal(pixelsHaveInk(px(32000, [0, 0, 0, 0])), false);
});

test('dark strokes count as ink', () => {
  const d = px(32000, [255, 255, 255, 255]);
  for (let i = 0; i < 50; i++) d.set([17, 17, 17, 255], (1000 + i) * 4);
  assert.equal(pixelsHaveInk(d), true);
});

test('a few stray dark pixels are not a signature', () => {
  const d = px(32000, [255, 255, 255, 255]);
  for (let i = 0; i < 5; i++) d.set([0, 0, 0, 255], i * 4);
  assert.equal(pixelsHaveInk(d), false);
});

test('profile save and report prefill use ink detection', async () => {
  const fs = await import('node:fs');
  const profile = fs.readFileSync(new URL('../app/profile/page.tsx', import.meta.url), 'utf8');
  const report = fs.readFileSync(new URL('../app/reports/new/NewServiceReportClient.tsx', import.meta.url), 'utf8');
  assert.match(profile, /canvasHasInk\(/);
  assert.match(report, /imageHasInk\(/);
});
