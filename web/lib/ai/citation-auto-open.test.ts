import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import { formatAssistantHtml } from './citations.ts';
import {
  ASSISTANT_SETTINGS_BLOB_KEY,
  AUTO_OPEN_CITED_MANUAL_KEY,
  CITATION_OPEN_EVENT,
  autoOpenTarget,
  autoOpenTargetFromReply,
  citationAutoOpenAllowed,
  citationOpenPresentation,
  dispatchCitationOpen,
  parseCitationOpenDetail,
  planCitationAutoOpen,
  readAutoOpenCitedManual,
  readVoiceSpeaking,
  writeAutoOpenCitedManual,
  type AutoOpenDecision,
} from './citation-auto-open.ts';

const here = dirname(fileURLToPath(import.meta.url));

function memory(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

const openBase = {
  enabled: true,
  fresh: true,
  alreadyOpened: false,
  settled: true,
  speaking: false,
  citation: { manualId: 105, page: 42 },
  canView: true,
};

test('auto-open setting defaults on and persists with assistant settings', () => {
  assert.equal(readAutoOpenCitedManual(null), true);
  assert.equal(readAutoOpenCitedManual(memory()), true);
  assert.equal(readAutoOpenCitedManual(memory({ [AUTO_OPEN_CITED_MANUAL_KEY]: 'false' })), false);
  assert.equal(readAutoOpenCitedManual(memory({ [AUTO_OPEN_CITED_MANUAL_KEY]: 'true' })), true);
  assert.equal(
    readAutoOpenCitedManual(
      memory({ [ASSISTANT_SETTINGS_BLOB_KEY]: JSON.stringify({ autoOpenCitedManual: false, zappVoice: 'sage' }) })
    ),
    false
  );
  assert.equal(
    readAutoOpenCitedManual(
      memory({
        [AUTO_OPEN_CITED_MANUAL_KEY]: 'true',
        [ASSISTANT_SETTINGS_BLOB_KEY]: JSON.stringify({ autoOpenCitedManual: false }),
      })
    ),
    true
  );
  assert.equal(readAutoOpenCitedManual(memory({ [ASSISTANT_SETTINGS_BLOB_KEY]: '{' })), true);

  const store = memory({ [ASSISTANT_SETTINGS_BLOB_KEY]: JSON.stringify({ zappVoice: 'sage', zappPersona: true }) });
  writeAutoOpenCitedManual(store, false);
  assert.equal(store.getItem(AUTO_OPEN_CITED_MANUAL_KEY), 'false');
  const blob = JSON.parse(store.getItem(ASSISTANT_SETTINGS_BLOB_KEY) || '{}') as {
    zappVoice?: string;
    autoOpenCitedManual?: boolean;
  };
  assert.equal(blob.zappVoice, 'sage');
  assert.equal(blob.autoOpenCitedManual, false);
  assert.equal(readAutoOpenCitedManual(store), false);
});

test('auto-open uses only the first citation, and only with a real page', () => {
  assert.deepEqual(
    autoOpenTarget([
      { manualId: 105, page: 42, title: 'Xeo' },
      { manualId: 16, page: 7 },
    ]),
    { manualId: 105, page: 42 }
  );
  assert.equal(
    autoOpenTarget([
      { manualId: 105, section: '4.2' },
      { manualId: 105, page: 42 },
    ]),
    null
  );
  assert.equal(autoOpenTarget([{ manualId: 105 }]), null);
  assert.equal(autoOpenTarget([{ manualId: 0, page: 3 }]), null);
  assert.equal(autoOpenTarget([]), null);

  assert.deepEqual(
    autoOpenTargetFromReply({
      content: 'Check the flow switch.\n[[cite:id=105&p=42&t=Xeo]]\n[[cite:id=105&p=43]]',
    }),
    { manualId: 105, page: 42 }
  );
  assert.equal(autoOpenTargetFromReply({ content: '[[cite:id=105&s=4.2]]' }), null);
  assert.equal(autoOpenTargetFromReply({ content: 'No manual cited.' }), null);
});

test('auto-open runs once for a fresh settled answer', () => {
  const open: AutoOpenDecision = { action: 'open', manualId: 105, page: 42 };
  assert.deepEqual(planCitationAutoOpen(openBase), open);
  assert.deepEqual(planCitationAutoOpen({ ...openBase, fresh: false }), { action: 'skip' });
  assert.deepEqual(planCitationAutoOpen({ ...openBase, alreadyOpened: true }), { action: 'skip' });
  assert.deepEqual(planCitationAutoOpen({ ...openBase, settled: false }), { action: 'wait' });
  assert.deepEqual(planCitationAutoOpen({ ...openBase, speaking: true }), { action: 'wait' });
  assert.deepEqual(planCitationAutoOpen({ ...openBase, enabled: false }), { action: 'skip' });
  assert.deepEqual(planCitationAutoOpen({ ...openBase, enabled: false, speaking: true }), { action: 'skip' });
  assert.deepEqual(planCitationAutoOpen({ ...openBase, citation: null }), { action: 'skip' });
  assert.deepEqual(planCitationAutoOpen({ ...openBase, canView: false }), { action: 'skip' });
});

test('auto-open access follows the AI catalog viewer rule', () => {
  assert.equal(
    citationAutoOpenAllowed({
      role: 'fse',
      orgType: 'service_company',
      storagePath: 'shared/cutera/xeo/Xeo Service Manual RevB.pdf',
      catalogKnown: true,
    }),
    true
  );
  assert.equal(
    citationAutoOpenAllowed({
      role: 'fse',
      orgType: 'service_company',
      storagePath: 'uploads/private/xeo.pdf',
      catalogKnown: true,
    }),
    false
  );
  assert.equal(
    citationAutoOpenAllowed({
      role: 'fse',
      orgType: 'service_company',
      storagePath: 'uploads/private/xeo.pdf',
      inLibrary: true,
      catalogKnown: true,
    }),
    true
  );
  assert.equal(
    citationAutoOpenAllowed({
      role: 'owner',
      orgType: 'laser_clinic',
      storagePath: 'shared/cutera/xeo/Xeo Service Manual RevB.pdf',
      catalogKnown: true,
    }),
    false
  );
  assert.equal(
    citationAutoOpenAllowed({
      role: 'fse',
      orgType: 'service_company',
      storagePath: 'shared/cutera/xeo/manual.pdf',
      catalogKnown: false,
    }),
    false
  );
  assert.equal(
    citationAutoOpenAllowed({
      role: 'fse',
      orgType: 'service_company',
      storagePath: '',
      catalogKnown: true,
    }),
    false
  );
});

test('presentation is a side panel on wide web and full screen on phones and Android', () => {
  assert.equal(citationOpenPresentation({ viewportWidth: 1280, userAgent: 'Mozilla/5.0' }), 'panel');
  assert.equal(citationOpenPresentation({ viewportWidth: 1024, userAgent: 'Mozilla/5.0' }), 'panel');
  assert.equal(citationOpenPresentation({ viewportWidth: 1023, userAgent: 'Mozilla/5.0' }), 'fullscreen');
  assert.equal(
    citationOpenPresentation({ viewportWidth: 1400, userAgent: 'Mozilla/5.0 TSPAndroid/0.5.0-beta' }),
    'fullscreen'
  );
  assert.equal(citationOpenPresentation({ viewportWidth: 1400, androidShell: true }), 'fullscreen');
});

test('voice signals block until speech ends', () => {
  assert.equal(readVoiceSpeaking(null), false);
  assert.equal(readVoiceSpeaking({}), false);
  assert.equal(readVoiceSpeaking({ TSP: { isVoiceSpeaking: () => true } }), true);
  assert.equal(readVoiceSpeaking({ TSP: { isVoiceSpeaking: () => false }, speechSynthesis: { speaking: true } }), true);
  assert.equal(
    readVoiceSpeaking({ document: { documentElement: { dataset: { assistantVoice: 'speaking' } } } }),
    true
  );
  assert.equal(readVoiceSpeaking({ document: { documentElement: { dataset: { assistantVoice: 'idle' } } } }), false);
});

test('citation-open event carries only manual id and page', () => {
  let heard: unknown = null;
  const target = new EventTarget();
  target.addEventListener(CITATION_OPEN_EVENT, (event) => {
    heard = (event as CustomEvent).detail;
  });
  dispatchCitationOpen(target, { manualId: 105, page: 42 });
  assert.deepEqual(heard, { manualId: 105, page: 42 });
  assert.deepEqual(parseCitationOpenDetail({ manualId: '16', page: '3' }), { manualId: 16, page: 3 });
  assert.deepEqual(parseCitationOpenDetail({ manualId: 16, page: 3 }), { manualId: 16, page: 3 });
  assert.equal(parseCitationOpenDetail({ manualId: 16 }), null);
  assert.equal(parseCitationOpenDetail({ manualId: 16, page: 0 }), null);
});

test('cite chips expose manual id and page for the in-app opener', () => {
  const html = formatAssistantHtml('See the flow switch.\n[[cite:id=105&p=42&t=Xeo]]', []);
  assert.match(html, /data-cite-manual="105"/);
  assert.match(html, /data-cite-page="42"/);
  assert.match(html, /\/manuals\/view\?id=105/);
  assert.match(html, /page=42/);
  const sectionOnly = formatAssistantHtml('[[cite:id=17&s=4.2]]', []);
  assert.match(sectionOnly, /data-cite-manual="17"/);
  assert.doesNotMatch(sectionOnly, /data-cite-page=/);
});

test('assistant UI wires the setting, once-per-answer plan, and JS contract', () => {
  const lib = readFileSync(join(here, 'citation-auto-open.ts'), 'utf8');
  const hook = readFileSync(join(here, '../../components/useAssistantCitationOpen.ts'), 'utf8');
  const panel = readFileSync(join(here, '../../components/AssistantCitedManual.tsx'), 'utf8');
  const settings = readFileSync(join(here, '../../app/settings/page.tsx'), 'utf8');
  const client = readFileSync(join(here, '../../app/ai-assistant/AIAssistantClient.tsx'), 'utf8');
  assert.match(lib, /assistant:citation-open/);
  assert.match(lib, /assistant:open-citation/);
  assert.match(hook, /planCitationAutoOpen/);
  assert.match(hook, /openCitation/);
  assert.match(hook, /dispatchCitationOpen/);
  assert.match(hook, /markFresh/);
  assert.match(client, /markFresh/);
  assert.match(client, /useAssistantCitationOpen/);
  assert.match(panel, /Back to answer/);
  assert.match(panel, /Escape/);
  assert.match(panel, /ManualPdfViewer/);
  assert.match(panel, /embedded/);
  assert.match(settings, /Auto-open cited manual page/);
  assert.match(settings, /useAutoOpenCitedManual/);
});
