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
  parseCitationMarkerQuery,
  sourceLineMatchesCitation,
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

test('duplicate Source lines collapse to the one that names a page', () => {
  const html = formatAssistantHtml(
    [
      'Check the calibration port.',
      '',
      '— Source: GentleMAX Pro Service Manual',
      '— Source: GentleMAX Pro Service Manual, p.120',
      '[[cite:id=110&p=120&t=GentleMAX+Pro+Service+Manual]]',
    ].join('\n'),
    []
  );
  assert.equal((html.match(/Source:/g) || []).length, 1);
  assert.match(html, /p\.120/);
  assert.match(html, /href="\/manuals\/view\?id=110[^"]*page=120/);
  assert.doesNotMatch(html, /— Source: GentleMAX Pro Service Manual</);

  const paged = citationViewerHref({
    manualId: 5,
    page: 142,
    title: 'GentleMAX PRO PLUS Service Manual',
  });
  assert.equal(
    paged,
    '/manuals/view?id=5&title=GentleMAX+PRO+PLUS+Service+Manual&page=142'
  );
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
    'CO2RE handpiece check (p. 152).\n\n— Source: CO2RE\n[[cite:id=17&p=152&t=CO2RE]]',
    [{ manualId: 17, title: 'CO2RE' }]
  );
  assert.match(html, /href="\/manuals\/view\?id=17[^"]*page=152/);
  assert.doesNotMatch(html, /id=17[^"]*page=1(?!\d)/);
  // Without a physical cite/stamp, prose "p. 152" is a printed label: no page=152.
  const unstamped = formatAssistantHtml(
    'CO2RE handpiece check (p. 152).\n\n— Source: CO2RE\n[[cite:id=17&t=CO2RE]]',
    [{ manualId: 17, title: 'CO2RE' }]
  );
  assert.doesNotMatch(unstamped, /page=152/);
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

test('prose page mentions never become page= unless a physical stamp matches', () => {
  assert.equal(extractPageRef('See page 42 of the flow-switch procedure.'), 42);
  assert.equal(extractPageRef('p.18 harness pinout'), 18);
  assert.equal(extractPageRef('no page mentioned'), undefined);
  assert.equal(extractPageRef('Error 43 is on pages 7-8 of the manual.'), undefined);
  const rangeHtml = formatAssistantHtml(
    'Error 43 is on pages 7-8.\n\n— Source: CO2RE\n[[cite:id=17&t=CO2RE]]',
    [{ manualId: 17, title: 'CO2RE' }]
  );
  assert.doesNotMatch(rangeHtml, /page=7(?!\d)/);
  // Printed labels in prose do not mint pages.
  const unstamped = attachProsePages(
    [{ manualId: 105, title: 'Cutera Xeo System' }],
    'Open page 42 and page 18 of the Xeo book.'
  );
  assert.equal(unstamped.length, 1);
  assert.equal(unstamped[0].page, undefined);
  // Same physical stamp present: page is physical, so it may upgrade.
  const stamped = attachProsePages(
    [{ manualId: 105, title: 'Cutera Xeo System' }],
    'Open page 42 of the Xeo book. [[pdfpage:42]]'
  );
  assert.equal(stamped[0].page, 42);
  // Backend physical page wins over a printed "page 7" in prose (CO2RE #43 = PDF p.150).
  const co2re = formatAssistantHtml(
    'Error 43 is in the troubleshooting table on page 7 (7-8).\n\n— Source: Candela CO2RE, p.150\n[[cite:id=17&p=150&t=Candela+CO2RE]]',
    []
  );
  assert.doesNotMatch(co2re, /page=7(?!\d)/);
  assert.match(co2re, /href="\/manuals\/view\?id=17[^"]*page=150/);
  const html = formatAssistantHtml(
    'See page 42 of the flow switch procedure.\n\n— Source: Cutera Xeo System\n[[cite:id=105&t=Cutera+Xeo+System]]',
    []
  );
  assert.doesNotMatch(html, /page=42/);
  assert.match(html, /href="\/manuals\/view\?id=105/);
});

test('printed page ranges stay plain unless a physical stamp matches the first page', () => {
  const plain = formatAssistantHtml(
    'See page 12-13 and p. 10–11.\n[[cite:id=17&t=CO2RE]]',
    [{ manualId: 17, title: 'CO2RE' }]
  );
  assert.match(plain, /See page 12-13/);
  assert.match(plain, /p\. 10–11/);
  assert.doesNotMatch(plain, /<a[^>]*>[^<]*page 12-13/);
  assert.doesNotMatch(plain, /<a[^>]*>[^<]*p\. 10/);
  assert.doesNotMatch(plain, /page=12/);
  assert.doesNotMatch(plain, /page=10(?!\d)/);
  assert.doesNotMatch(plain, /page=1(?!\d).*page 12|page 12-13[^<]*page=1/);

  const stamped = formatAssistantHtml(
    'See pages 42-44 of the flow switch.\n[[pdfpage:42]]\n[[cite:id=105&t=Xeo]]',
    [{ manualId: 105, title: 'Xeo' }]
  );
  assert.match(stamped, /href="\/manuals\/view\?id=105[^"]*page=42/);
  assert.match(stamped, /pages 42-44/);
  assert.doesNotMatch(stamped, /page=44/);
  assert.doesNotMatch(stamped, /\[\[pdfpage:/);

  const fromIndex = formatAssistantHtml(
    'See pages 42-44 of the flow switch.\n[[cite:id=105&t=Xeo]]',
    [{ manualId: 105, title: 'Xeo' }],
    'intro\f[[pdfpage:42]] flow switch'
  );
  assert.match(fromIndex, /page=42/);
  assert.doesNotMatch(fromIndex, /page=44/);
  assert.match(fromIndex, /pages 42-44/);
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
  assert.equal(linked[0].page, undefined, 'printed prose page never becomes page=');
  const physical = citationsForAssistantReply(
    { citations: [{ manualId: 17, title: 'CO2RE', page: 150 }] },
    17,
    'See the troubleshooting table on page 7-8 and page 7.'
  );
  assert.deepEqual(physical.map((c) => c.page), [150]);
  const general = citationsForAssistantReply(
    { generalGuidance: true, manualId: 17, citations: [{ manualId: 17, page: 4, title: 'CO2RE' }] },
    17,
    'Typical RF deck check is on page 4.'
  );
  assert.deepEqual(general, []);
});

test('out-of-range and cross-manual cites stay on their own row', () => {
  const fromMarker = parseCitationMarkerQuery('id=110&p=88&oor=1&t=GentleMAX+Pro+Service+Manual');
  assert.equal(fromMarker?.page, 88);
  assert.equal(fromMarker?.pageOutOfRange, true);
  assert.match(embedCitationMarker(fromMarker!), /oor=1/);
  assert.match(embedCitationMarker(fromMarker!), /p=88/);

  const parsed = parseCitationMarkers('[[cite:id=5&p=121&t=Candela+GentleMAX+PRO+PLUS+Service+Manual]]');
  assert.equal(parsed[0].manualId, 5);
  assert.equal(parsed[0].page, 121);
  assert.equal(parsed[0].pageOutOfRange, undefined);

  const cites = citationsForAssistantReply(
    {
      manualId: 110,
      manualLabel: 'GentleMAX Pro Service Manual',
      citations: [
        { manualId: 110, title: 'GentleMAX Pro Service Manual', page: 12 },
        {
          manualId: 5,
          title: 'Candela GentleMAX PRO PLUS Service Manual',
          page: 121,
        },
        {
          manualId: 110,
          page: 88,
          page_out_of_range: true,
        },
      ],
    },
    110,
    'Check the port.'
  );
  assert.deepEqual(
    cites.map((c) => ({ id: c.manualId, page: c.page, cross: c.crossManual === true, oor: c.pageOutOfRange === true })),
    [
      { id: 110, page: 12, cross: false, oor: false },
      { id: 5, page: 121, cross: true, oor: false },
      { id: 110, page: 88, cross: false, oor: true },
    ]
  );
  assert.equal(cites[1].title, 'Candela GentleMAX PRO PLUS Service Manual');
  assert.equal(cites[2].title, 'GentleMAX Pro Service Manual');

  const unlabeled = citationsForAssistantReply(
    {
      manualId: 110,
      manualLabel: 'GentleMAX Pro Service Manual',
      citations: [{ manualId: 5, page: 121 }],
    },
    110,
    ''
  );
  assert.equal(unlabeled[0].manualId, 5);
  assert.equal(unlabeled[0].title, undefined);
  assert.equal(unlabeled[0].crossManual, true);

  const html = formatAssistantHtml(
    '[[cite:id=5&p=121&t=Candela+GentleMAX+PRO+PLUS+Service+Manual]]\n[[cite:id=110&p=12&t=GentleMAX+Pro+Service+Manual]]',
    cites.filter((c) => c.page !== 88)
  );
  assert.match(html, /From: Candela GentleMAX PRO PLUS Service Manual, p\. 121/);
  assert.match(html, /href="\/manuals\/view\?id=5[^"]*page=121/);
  assert.match(html, /data-cite-manual="5"/);
  assert.doesNotMatch(html, /From: GentleMAX Pro/);
  assert.match(html, /GentleMAX Pro Service Manual, p\.12/);
  const oorHtml = formatAssistantHtml('[[cite:id=110&p=88&oor=1&t=GentleMAX+Pro+Service+Manual]]', [
    cites[2],
  ]);
  assert.match(oorHtml, /page=88/);
  assert.match(oorHtml, /oor=1/);
  assert.match(oorHtml, /data-cite-oor="1"/);
  assert.equal(oorHtml.match(/id=5/g), null);
});

test('an unscoped reply does not deep-link Auriga page labels to the open manual page 1', () => {
  const auriga =
    'Which system or chair model is this for? No manual is currently selected.\n\n' +
    'See page 3 of the Auriga hydraulic section.\n\n' +
    '— Source: Auriga Service Manual, p.3; LightSheer Duet, p.12';
  const cites = citationsForAssistantReply({ manualId: null, citations: [], manualLabel: '' }, 1086, auriga);
  assert.deepEqual(cites, []);
  const html = formatAssistantHtml(auriga, cites);
  assert.doesNotMatch(html, /id=1086/);
  assert.doesNotMatch(html, /page=1/);
  assert.match(html, /Auriga Service Manual/);
  assert.equal(
    sourceLineMatchesCitation('Auriga Service Manual, p.3', {
      manualId: 1086,
      title: 'Midmark Ritter 112/113 Special Procedure Table Service Manual',
    }),
    false
  );

  const scoped = citationsForAssistantReply(
    {
      manualId: 1086,
      manualLabel: 'Midmark Ritter 112/113 Special Procedure Table Service Manual',
      hasManualPassages: true,
      citations: [
        {
          manualId: 1086,
          title: 'Midmark Ritter 112/113 Special Procedure Table Service Manual',
          page: 14,
        },
      ],
    },
    1086,
    'Replace the back actuator. See page 3 of Auriga.\n\n— Source: Auriga Service Manual, p.3'
  );
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].manualId, 1086);
  assert.equal(scoped[0].page, 14);
  const scopedHtml = formatAssistantHtml(
    'Replace the back actuator.\n\n— Source: Midmark Ritter 112/113 Special Procedure Table Service Manual, p.14\n[[cite:id=1086&p=14&t=Midmark+Ritter+112]]',
    scoped
  );
  assert.match(scopedHtml, /href="\/manuals\/view\?id=1086[^"]*page=14/);
  assert.doesNotMatch(scopedHtml, /id=1086[^"]*page=1(?!\d)/);
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
