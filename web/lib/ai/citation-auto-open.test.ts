import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import { formatAssistantHtml } from './citations.ts';
import { buildGrokChatPayload } from './manual-scope.ts';
import {
  ANSWER_EVENT,
  ASSISTANT_SETTINGS_BLOB_KEY,
  AUTO_OPEN_CITED_MANUAL_KEY,
  CITATION_OPEN_EVENT,
  VOICE_MODE_EVENT,
  assistantCitationPairs,
  autoOpenAfterVoice,
  autoOpenTarget,
  autoOpenTargetFromReply,
  buildAssistantAnswerDetail,
  canAskAssistant,
  citationAutoOpenAllowed,
  citationOpenPresentation,
  claimAnswerAnnouncement,
  dispatchAssistantAnswer,
  dispatchCitationOpen,
  dispatchVoiceMode,
  emptyAnswerTurn,
  getVoiceMode,
  markAnswerFresh,
  onAnswerSettled,
  onViewerTakenOver,
  parseCitationOpenDetail,
  parseVoiceModeDetail,
  planCitationAutoOpen,
  readAutoOpenCitedManual,
  readVoiceSpeaking,
  setVoiceMode,
  spokenAnswerText,
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
  const grok = readFileSync(join(here, 'grok-client.ts'), 'utf8');
  assert.match(lib, /assistant:citation-open/);
  assert.match(lib, /assistant:open-citation/);
  assert.match(lib, /assistant:answer/);
  assert.match(lib, /assistant:voice-mode/);
  assert.match(hook, /planCitationAutoOpen/);
  assert.match(hook, /openCitation/);
  assert.match(hook, /setVoiceMode/);
  assert.match(hook, /askAssistant/);
  assert.match(hook, /dispatchCitationOpen/);
  assert.match(hook, /dispatchAssistantAnswer/);
  assert.match(hook, /onViewerTakenOver/);
  const answerCall = hook.indexOf('dispatchAssistantAnswer(window');
  const planCall = hook.indexOf('planCitationAutoOpen({');
  assert.ok(answerCall > 0 && planCall > answerCall);
  assert.doesNotMatch(hook, /MutationObserver/);
  assert.match(hook, /markFresh/);
  assert.match(client, /markFresh/);
  assert.match(client, /useAssistantCitationOpen/);
  assert.match(client, /getVoiceMode\(\)/);
  assert.match(client, /voiceMode: payload\.voiceMode/);
  assert.match(grok, /voiceMode: opts\.voiceMode === true/);
  assert.match(panel, /Back to answer/);
  assert.match(panel, /Escape/);
  assert.match(panel, /ManualPdfViewer/);
  assert.match(panel, /embedded/);
  assert.match(settings, /Auto-open cited manual page/);
  assert.match(settings, /useAutoOpenCitedManual/);
});

test('voice mode defaults off and reaches the grok chat payload', () => {
  assert.equal(getVoiceMode(), false);
  assert.equal(parseVoiceModeDetail({ on: true }), true);
  assert.equal(parseVoiceModeDetail({ on: 'true' }), null);
  const off = buildGrokChatPayload({
    messages: [{ role: 'user', content: 'Check the flow switch' }],
    voiceMode: getVoiceMode(),
  });
  assert.equal(off.voiceMode, false);

  assert.equal(setVoiceMode(true), true);
  assert.equal(getVoiceMode(), true);
  const on = buildGrokChatPayload({
    messages: [{ role: 'user', content: 'Check the flow switch' }],
    voiceMode: getVoiceMode(),
  });
  assert.equal(on.voiceMode, true);
  assert.equal(on.action, 'chat');

  let heard: unknown = null;
  const target = new EventTarget();
  target.addEventListener(VOICE_MODE_EVENT, (event) => {
    heard = (event as CustomEvent).detail;
  });
  dispatchVoiceMode(target, getVoiceMode());
  assert.deepEqual(heard, { on: true });

  setVoiceMode(false);
  assert.equal(getVoiceMode(), false);
  assert.equal(
    buildGrokChatPayload({
      messages: [{ role: 'user', content: 'Check the flow switch' }],
      voiceMode: getVoiceMode(),
    }).voiceMode,
    false
  );
});

test('askAssistant refuses when the page is not ready or a send is in flight', () => {
  const ready = { ready: true, sending: false, hasToken: true, text: ' Check the flow switch ' };
  assert.equal(canAskAssistant(ready), true);
  assert.equal(canAskAssistant({ ...ready, ready: false }), false);
  assert.equal(canAskAssistant({ ...ready, sending: true }), false);
  assert.equal(canAskAssistant({ ...ready, hasToken: false }), false);
  assert.equal(canAskAssistant({ ...ready, text: '   ' }), false);
  assert.equal(canAskAssistant({ ...ready, text: null }), false);
});

test('assistant:answer is once per fresh settled answer and is spoken text', () => {
  let state = emptyAnswerTurn();
  assert.equal(onAnswerSettled(state, '10', true).announce, false);

  state = markAnswerFresh(state, '10');
  const streaming = onAnswerSettled(state, '10', false);
  assert.equal(streaming.announce, false);
  assert.equal(streaming.state.pendingKey, '10');
  assert.deepEqual(streaming.state.announcedKeys, []);

  const first = onAnswerSettled(streaming.state, '10', true);
  assert.equal(first.announce, true);
  const again = onAnswerSettled(first.state, '10', true);
  assert.equal(again.announce, false);
  const rerender = onAnswerSettled(again.state, '10', true);
  assert.equal(rerender.announce, false);

  assert.equal(claimAnswerAnnouncement('answer-10'), true);
  assert.equal(claimAnswerAnnouncement('answer-10'), false);

  const content = 'Check the **flow switch**.\n[[cite:id=105&p=42&t=Xeo]]\nSee [the diagram](https://example.com/x).\n[[cite:id=16&p=7]]';
  assert.equal(spokenAnswerText(content), 'Check the flow switch.\nSee the diagram.');
  const detail = buildAssistantAnswerDetail({
    ts: 10,
    content,
    voiceMode: true,
  });
  assert.ok(detail);
  assert.equal(detail.text, 'Check the flow switch.\nSee the diagram.');
  assert.deepEqual(detail.citations, [
    { manualId: 105, page: 42 },
    { manualId: 16, page: 7 },
  ]);
  assert.deepEqual(assistantCitationPairs({ content }), detail.citations);
  assert.deepEqual(detail.top, { manualId: 105, page: 42 });
  assert.equal(detail.voiceMode, true);
  assert.equal(detail.ts, 10);

  const sectionFirst = buildAssistantAnswerDetail({
    ts: 11,
    content: '[[cite:id=105&s=4.2]]\n[[cite:id=105&p=42]]',
    voiceMode: false,
  });
  assert.equal(sectionFirst?.top, null);
  assert.deepEqual(sectionFirst?.citations, [{ manualId: 105, page: 42 }]);
  assert.equal(sectionFirst?.voiceMode, false);

  let heard: unknown = null;
  const target = new EventTarget();
  target.addEventListener(ANSWER_EVENT, (event) => {
    heard = (event as CustomEvent).detail;
  });
  dispatchAssistantAnswer(target, detail);
  assert.deepEqual(heard, {
    ts: 10,
    text: detail.text,
    citations: [
      { manualId: 105, page: 42 },
      { manualId: 16, page: 7 },
    ],
    top: { manualId: 105, page: 42 },
    voiceMode: true,
  });
  assert.equal(buildAssistantAnswerDetail({ ts: Number.NaN, content: 'x', voiceMode: false }), null);
});

test('voice hold does not reopen after an inbound open or Back', () => {
  let state = markAnswerFresh(emptyAnswerTurn(), '10');
  state = onAnswerSettled(state, '10', true).state;

  const held = autoOpenAfterVoice(state, true, true);
  assert.equal(held.open, false);
  assert.equal(held.state.pendingKey, '10');

  const inbound = onViewerTakenOver(held.state);
  assert.equal(inbound.pendingKey, null);
  assert.deepEqual(inbound.openedKeys, ['10']);
  assert.equal(autoOpenAfterVoice(inbound, false, true).open, false);

  const heldForBack = autoOpenAfterVoice(state, true, true);
  const closed = onViewerTakenOver(heldForBack.state);
  assert.equal(autoOpenAfterVoice(closed, false, true).open, false);
  assert.equal(onViewerTakenOver(closed).pendingKey, null);

  const released = autoOpenAfterVoice(held.state, false, true);
  assert.equal(released.open, true);
  assert.equal(released.state.pendingKey, null);
  assert.equal(autoOpenAfterVoice(released.state, false, true).open, false);
});
