import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import {
  attachProsePages,
  citationLabel,
  citationViewerHref,
  citationsForAssistantReply,
  citationsFromMeta,
  embedCitationMarker,
  extractPageRef,
  extractSectionRef,
  formatAssistantHtml,
  mergeCitations,
  parseCitationMarkers,
  stripCitationMarkers,
} from './citations.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('citation viewer href stays on the auth-gated in-app route', () => {
  assert.equal(
    citationViewerHref({ manualId: 105, title: 'Xeo Service Manual Rev B', page: 42 }),
    '/manuals/view?id=105&title=Xeo+Service+Manual+Rev+B&page=42'
  );
  assert.equal(citationViewerHref({ manualId: 16 }), '/manuals/view?id=16&page=1');
  assert.equal(
    citationViewerHref({ manualId: 105, section: '4.2' }),
    '/manuals/view?id=105&section=4.2'
  );
  assert.doesNotMatch(citationViewerHref({ manualId: 105, page: 3 }), /https?:|storage\/v1|sign=/);
});

test('structured cite markers round-trip without scraping prose', () => {
  const marker = embedCitationMarker({
    manualId: 105,
    page: 42,
    section: '4.2',
    title: 'Xeo Service Manual Rev B',
  });
  assert.match(marker, /\[\[cite:id=105&p=42&s=4\.2/);
  const parsed = parseCitationMarkers(`See the flow switch.\n${marker}`);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].manualId, 105);
  assert.equal(parsed[0].page, 42);
  assert.equal(parsed[0].section, '4.2');
  assert.equal(stripCitationMarkers(`Hello ${marker}\n`), 'Hello');
});

test('assistant HTML links page/section phrases to the viewer, not a PDF', () => {
  const html = formatAssistantHtml(
    'Open page 42 and Section 4.2 of the Xeo book.\n\n— Source: Xeo Service Manual Rev B, p.42\n[[cite:id=105&p=42&s=4.2&t=Xeo+Service+Manual+Rev+B]]',
    []
  );
  assert.match(html, /href="\/manuals\/view\?id=105/);
  assert.match(html, /page=42/);
  assert.match(html, /ai-cite-link/);
  assert.doesNotMatch(html, /\[\[cite:/);
  assert.doesNotMatch(html, /\.pdf\?|get-manual-url|window\.open/i);
  assert.doesNotMatch(html, /<script/i);
});

test('document-only citation still opens that manual', () => {
  const html = formatAssistantHtml('Calibrate the flow switch.', [
    { manualId: 105, title: 'Xeo Service Manual Rev B' },
  ]);
  assert.match(html, /href="\/manuals\/view\?id=105/);
  assert.match(html, /page=1/);
});

test('index-excerpt cite chips keep (p. N) instead of opening page 1', () => {
  const html = formatAssistantHtml(
    'CO2RE handpiece check (p. 152).\n\n— Source: CO2RE\n[[cite:id=17&t=CO2RE]]',
    [{ manualId: 17, title: 'CO2RE' }]
  );
  assert.match(html, /href="\/manuals\/view\?id=17[^"]*page=152/);
  assert.doesNotMatch(html, /id=17[^"]*page=1(?!\d)/);
});

test('cite URL includes page= when marker has p= and omits it only when unknown', () => {
  const withPage = embedCitationMarker({
    manualId: 105,
    page: 42,
    title: 'Cutera Xeo System',
  });
  assert.match(withPage, /\[\[cite:id=105&p=42/);
  assert.equal(
    citationViewerHref(parseCitationMarkers(withPage)[0]),
    '/manuals/view?id=105&title=Cutera+Xeo+System&page=42'
  );

  const noPage = embedCitationMarker({ manualId: 105, title: 'Cutera Xeo System' });
  assert.match(noPage, /\[\[cite:id=105&t=/);
  assert.doesNotMatch(noPage, /[?&]p=/);
  const parsed = parseCitationMarkers(noPage)[0];
  assert.equal(parsed.page, undefined);
  assert.equal(
    citationViewerHref(parsed),
    '/manuals/view?id=105&title=Cutera+Xeo+System&page=1'
  );
});

test('prose page mentions upgrade document-level Source chips', () => {
  assert.equal(extractPageRef('See page 42 of the flow-switch procedure.'), 42);
  assert.equal(extractPageRef('p.18 harness pinout'), 18);
  assert.equal(extractPageRef('no page mentioned'), undefined);
  const attached = attachProsePages(
    [{ manualId: 105, title: 'Cutera Xeo System' }],
    'Open page 42 and page 18 of the Xeo book.'
  );
  assert.equal(attached[0].page, 42);
  assert.ok(attached.some((c) => c.page === 18));
  const html = formatAssistantHtml(
    'See page 42 of the flow switch procedure.\n\n— Source: Cutera Xeo System\n[[cite:id=105&t=Cutera+Xeo+System]]',
    []
  );
  assert.match(html, /href="\/manuals\/view\?id=105[^"]*page=42/);
});

test('meta citations and section extraction', () => {
  assert.equal(extractSectionRef('See Section 4.2 Flow Switch harness.'), '4.2');
  assert.equal(extractSectionRef('Chapter 12 error tables.'), 'Ch.12');
  assert.equal(extractSectionRef('no heading here'), undefined);
  const fromMeta = citationsFromMeta(
    {
      manualId: 105,
      manualLabel: 'Cutera Xeo',
      citations: [{ manualId: 105, page: 12, section: '3.1', title: 'Xeo SM' }],
    },
    16
  );
  assert.equal(fromMeta[0].page, 12);
  assert.equal(citationLabel(fromMeta[0]), 'Xeo SM, p.12, §3.1');
  assert.equal(mergeCitations(fromMeta, fromMeta).length, 1);

  const linked = citationsForAssistantReply(
    { citations: [{ manualId: 17, title: 'CO2RE' }] },
    17,
    'See page 4 of the alignment procedure.'
  );
  assert.equal(linked[0].manualId, 17);
  assert.equal(linked[0].page, 4);
  const general = citationsForAssistantReply(
    { generalGuidance: true, manualId: 17, citations: [{ manualId: 17, page: 4, title: 'CO2RE' }] },
    17,
    'Typical RF deck check is on page 4.'
  );
  assert.deepEqual(general, []);
});

test('general-guidance humanizing touches only the device name on the first line', () => {
  const parts = 'Replace PN-4402-01 when E-12 or ERR_LAMP_OVERTEMP appears.';
  const words = 'Nd-YAG alignment is step-by-step.';
  const url = 'https://example.com/manuals/visulas_yag_iii/PN-4402-01';
  const normal = formatAssistantHtml([parts, words, url].join('\n'), []);
  for (const token of ['PN-4402-01', 'E-12', 'ERR_LAMP_OVERTEMP', 'Nd-YAG', 'step-by-step', url]) {
    assert.match(normal, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(normal, /Pn 4402 01|Err Lamp|Step By Step|Visulas YAG III/);

  const guidance = formatAssistantHtml(
    [
      "I couldn't search this manual's text yet, so this is general guidance for the Zeiss visulas_yag_iii:",
      parts,
      words,
      url,
    ].join('\n'),
    []
  );
  assert.match(guidance, /Zeiss Visulas YAG III:/);
  assert.doesNotMatch(guidance, /visulas_yag_iii:/);
  for (const token of ['PN-4402-01', 'E-12', 'ERR_LAMP_OVERTEMP', 'Nd-YAG', 'step-by-step', url]) {
    assert.match(guidance, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(guidance, /Pn 4402 01|Err Lamp Overtemp|Step By Step/);

  const quotedLater = formatAssistantHtml(
    [
      `${parts} ${words}`,
      "I couldn't search this manual's text yet, so this is general guidance for the Zeiss visulas_yag_iii:",
    ].join('\n'),
    []
  );
  assert.match(quotedLater, /Zeiss visulas_yag_iii:/);
  assert.match(quotedLater, /PN-4402-01/);
  assert.match(quotedLater, /Nd-YAG/);
});

test('AI assistant and viewer use structured cites, not public PDF URLs', () => {
  const client = readFileSync(join(here, '../../app/ai-assistant/AIAssistantClient.tsx'), 'utf8');
  const viewer = readFileSync(join(here, '../../components/ManualPdfViewer.tsx'), 'utf8');
  const rail = readFileSync(join(here, '../../components/ViewerAiPanel.tsx'), 'utf8');
  const grok = readFileSync(join(here, 'grok-client.ts'), 'utf8');
  assert.match(client, /formatAssistantHtml/);
  assert.match(client, /citationViewerHref|ai-cite-link/);
  assert.match(viewer, /initialPage|viewer-rail/);
  assert.match(rail, /Ask about this manual|byManual|messagesForManual/);
  assert.match(grok, /citations/);
});
