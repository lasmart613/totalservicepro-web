/** q25: a refusal must not render a pageless section chip rebuilt from its own wording. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { citationsForAssistantReply, formatAssistantHtml } from './citations.ts';

const here = dirname(fileURLToPath(import.meta.url));
const edge = readFileSync(join(here, '../../../supabase/functions/grok-assistant/index.ts'), 'utf8');

// Synthetic text shaped like the live q25 refusal (manual 132).
const refusal =
  'The provided passages from the Lutronic Spectra Service Manual (page 71 / section 4.2 and the full Chapter 4 installation content) do not contain any torque specification for the articulated arm mounting bolts.';
const meta = {
  manualId: 132,
  manualLabel: 'Lutronic Spectra Service Manual',
  pageCount: 142,
  hasManualPassages: true,
  citations: [],
};

test('without the declined flag the client still rebuilds a section chip (the q25 leftover)', () => {
  const cites = citationsForAssistantReply(meta, 132, refusal);
  const html = formatAssistantHtml(refusal, cites);
  assert.match(html, /section=4\.2/);
  assert.match(html, /ai-cite-row/);
});

test('declined refusal: no citations, no chip row, no section or page links', () => {
  const cites = citationsForAssistantReply({ ...meta, declined: true }, 132, refusal);
  assert.deepEqual(cites, []);
  const html = formatAssistantHtml(refusal, cites);
  assert.doesNotMatch(html, /ai-cite-row/);
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /section 4\.2/);
});

test('a normal answer with the same meta keeps its section chip', () => {
  const cites = citationsForAssistantReply(
    { ...meta, citations: [{ manualId: 132, page: 53, section: '4.7.2' }] },
    132,
    'Set the gap per section 4.7.2 (page 53).'
  );
  assert.ok(cites.some((c) => c.section === '4.7.2'));
});

test('grok-assistant marks refusals declined in _meta on every settle path', () => {
  assert.equal((edge.match(/replyDeclined = true/g) || []).length, 2);
  assert.match(edge, /\.\.\.\(replyDeclined \? \{ declined: true \} : \{\}\)/);
  const settle = edge.indexOf('const settleReply');
  assert.ok(edge.indexOf('let replyDeclined = false') < settle);
});
