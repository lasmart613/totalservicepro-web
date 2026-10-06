const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const voice = require('../../main/assets/grok-voice.js');

const ASSISTANT = 'https://yljztfajyvjzqikxdddf.supabase.co/functions/v1/grok-assistant';
const TTS = 'https://yljztfajyvjzqikxdddf.supabase.co/functions/v1/grok-tts';

test('tts URL is derived from the grok-assistant URL', () => {
    assert.equal(voice.ttsUrlFromAssistant(ASSISTANT), TTS);
    assert.equal(
        voice.ttsUrlFromProject('https://yljztfajyvjzqikxdddf.supabase.co'),
        TTS
    );
});

test('default voice is eve and a saved sage id reads as eve', () => {
    assert.equal(voice.DEFAULT_VOICE_ID, 'eve');
    assert.equal(voice.normalizeVoiceId(undefined), 'eve');
    assert.equal(voice.normalizeVoiceId(''), 'eve');
    assert.equal(voice.normalizeVoiceId('eve'), 'eve');
    assert.equal(voice.normalizeVoiceId('EVE'), 'eve');
    assert.equal(voice.normalizeVoiceId('sage'), 'eve');
    assert.equal(voice.normalizeVoiceId('Sage'), 'eve');
    assert.equal(voice.normalizeVoiceId('nova'), 'eve');
    assert.deepEqual(voice.ALLOWED_VOICE_IDS, ['eve', 'ara', 'rex', 'sal', 'leo']);
    assert.equal(voice.ALLOWED_VOICE_IDS.includes('sage'), false);
    const contract = fs.readFileSync(
        path.join(__dirname, '../../../../supabase/functions/grok-tts/contract.ts'),
        'utf8'
    );
    const allowStart = contract.indexOf('export const ALLOWED_VOICE_IDS');
    const allowEnd = contract.indexOf('export const DEFAULT_VOICE_ID');
    const serverIds = [...contract.slice(allowStart, allowEnd).matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    assert.equal(serverIds.includes('sage'), false);
    assert.equal(contract.includes("DEFAULT_VOICE_ID = 'eve'"), true);
    for (const id of voice.ALLOWED_VOICE_IDS) {
        assert.ok(serverIds.includes(id), id + ' is not in the grok-tts allow-list');
    }
    const stored = { zappVoice: 'sage', zappVoiceGender: 'male', theme: 'dark' };
    assert.equal(voice.migrateStoredVoice(stored), true);
    assert.equal(stored.zappVoice, 'eve');
    assert.equal(stored.zappVoiceGender, 'female');
    assert.equal(stored.theme, 'dark');
    const kept = { zappVoice: 'rex', zappVoiceGender: 'male' };
    assert.equal(voice.migrateStoredVoice(kept), false);
    assert.equal(kept.zappVoice, 'rex');
    assert.equal(kept.zappVoiceGender, 'male');
});

test('voice list keeps only xAI voices and drops sage', () => {
    const parsed = voice.parseVoiceList({
        voices: [
            { voice_id: 'nova', name: 'Nova' },
            { voice_id: 'eve', name: 'Energetic' },
            { voice_id: 'sage', name: 'Warm narrator' }
        ]
    });
    assert.deepEqual(parsed.map((v) => v.id), ['eve', 'ara', 'rex', 'sal', 'leo']);
    assert.equal(parsed.find((v) => v.id === 'eve').label, 'Eve — Energetic');
    assert.equal(parsed.some((v) => v.id === 'sage'), false);
    assert.equal(parsed.some((v) => v.id === 'nova'), false);
    const male = voice.voicesForGender(parsed, 'male').map((v) => v.id);
    assert.deepEqual(male, ['rex', 'sal', 'leo']);
    const female = voice.voicesForGender(parsed, 'female').map((v) => v.id);
    assert.deepEqual(female, ['eve', 'ara']);
});

test('invalid_voice_id retries once with voice_id omitted', () => {
    assert.equal(voice.isInvalidVoiceId(400, { error: 'invalid_voice_id' }), true);
    assert.equal(voice.isInvalidVoiceId(400, { error: 'text_too_long' }), false);
    assert.equal(voice.isInvalidVoiceId(400, { error: 'TTS error' }), false);
    assert.equal(voice.isInvalidVoiceId(502, { error: 'invalid_voice_id' }), false);
    const sent = voice.ttsRequestBody('Check the pot.', 'sage', false);
    assert.equal(sent.voice_id, 'eve');
    assert.equal(sent.language, 'en');
    const omitted = voice.ttsRequestBody('Check the pot.', 'rex', true);
    assert.equal(Object.prototype.hasOwnProperty.call(omitted, 'voice_id'), false);
    assert.equal(omitted.text, 'Check the pot.');
    assert.equal(omitted.language, 'en');
});

test('speech text strips citations and stays within 4000 characters', () => {
    const spoken = voice.prepareSpeechText(
        'Check the simmer pot. **Now.**\n\n— Source: Xeo, p.42\n[[cite:id=105&p=42&t=Xeo]]'
    );
    assert.equal(spoken, 'Check the simmer pot. Now.');
    const long = ('Sentence number one. ').repeat(300);
    const clipped = voice.prepareSpeechText(long);
    assert.ok(clipped.length <= 4000);
    assert.ok(clipped.endsWith('.'));
});

test('text_too_long is recognized on HTTP 400 and HTTP 413', () => {
    assert.equal(voice.isTextTooLong(400, { error: 'text_too_long' }), true);
    assert.equal(voice.isTextTooLong(413, { error: 'text_too_long', max_characters: 4000 }), true);
    assert.equal(voice.isTextTooLong(413, null), true);
    assert.equal(voice.isTextTooLong(400, { error: 'Missing text' }), false);
    assert.equal(voice.isTextTooLong(429, { error: 'daily_limit_reached' }), false);
    assert.equal(voice.isTextTooLong(500, { error: 'text_too_long' }), false);
});

test('HTTP 429 daily and burst limits are the device-fallback case', () => {
    assert.equal(voice.isGrokVoiceLimit(429, { error: 'daily_limit_reached' }), true);
    assert.equal(voice.isGrokVoiceLimit(429, { error: 'rate_limited' }), true);
    assert.equal(voice.isGrokVoiceLimit(429, { error: 'upstream_rate_limited' }), false);
    assert.equal(voice.isGrokVoiceLimit(500, { error: 'daily_limit_reached' }), false);
    assert.equal(voice.isGrokVoiceLimit(429, null), false);
    assert.equal(voice.isGrokVoiceLimit(503, { error: 'usage_unavailable' }), false);
});

test('HTTP 503 usage_unavailable is a device fallback, not the limit notice', () => {
    assert.equal(voice.isUsageUnavailable(503, { error: 'usage_unavailable' }), true);
    assert.equal(voice.isUsageUnavailable(503, { error: 'AI not configured' }), false);
    assert.equal(voice.isUsageUnavailable(429, { error: 'usage_unavailable' }), false);
    assert.equal(voice.isUsageUnavailable(503, null), false);
});

test('top citation only, and general guidance does not open a manual', () => {
    const top = voice.topCitation(
        { _meta: { citations: [{ manualId: 105, page: 42 }, { manualId: 105, page: 43 }] } },
        'See the manual. [[cite:id=105&p=99]]'
    );
    assert.equal(top.manualId, 105);
    assert.equal(top.page, 42);
    assert.equal(voice.topCitation({ _meta: { generalGuidance: true, citations: [] } }, ''), null);
    assert.equal(voice.topCitation({ _meta: { citations: [{ manualId: 105 }] } }, ''), null);
    assert.deepEqual(voice.normalizeCitationTarget('105', '42'), { manualId: 105, page: 42 });
    assert.equal(voice.normalizeCitationTarget(105, 0), null);
    const fromMarker = voice.topCitation({}, 'Answer\n[[cite:id=17&p=150&t=CO2RE]]');
    assert.equal(fromMarker.manualId, 17);
    assert.equal(fromMarker.page, 150);
});

test('open voice command is narrow', () => {
    assert.equal(voice.isOpenCommand('open'), true);
    assert.equal(voice.isOpenCommand('Open the manual.'), true);
    assert.equal(voice.isOpenCommand('please open the page'), true);
    assert.equal(voice.isOpenCommand('open the laser head'), false);
    assert.equal(voice.isOpenCommand('what does fault 322 mean'), false);
});

test('online voice rewrites only assistant chat and speaks through the native bridge', () => {
    const online = require('../../main/assets/online-voice.js');
    assert.equal(online.isAssistantPath('/ai-assistant'), true);
    assert.equal(online.isAssistantPath('/ai-assistant/'), true);
    assert.equal(online.isAssistantPath('/manuals'), false);
    assert.equal(online.isLiveHost('repairplanet.net'), true);
    const chat = JSON.stringify({ action: 'chat', voiceMode: false, messages: [] });
    const rewritten = JSON.parse(online.planVoiceChat(true, ASSISTANT, chat));
    assert.equal(rewritten.voiceMode, true);
    assert.equal(online.planVoiceChat(false, ASSISTANT, chat), null);
    assert.equal(online.planVoiceChat(true, ASSISTANT, JSON.stringify({ action: 'usage' })), null);
    assert.equal(online.planVoiceChat(true, TTS, chat), null);
    assert.equal(
        online.assistantReplyText({ choices: [{ message: { content: 'Check the pot.' } }] }),
        'Check the pot.'
    );
    assert.equal(online.pageOwnsVoice({ askAssistant: function () {} }), true);
    assert.equal(online.pageOwnsVoice({ setVoiceMode: function () {} }), true);
    assert.equal(online.pageOwnsVoice({}), false);
    assert.equal(online.pageOwnsVoice(null), false);
    assert.equal(online.submitKind({ askAssistant: function () {} }), 'hook');
    assert.equal(online.submitKind({ setVoiceMode: function () {} }), 'shim');
    assert.equal(online.submitKind({}), 'shim');
    assert.equal(online.askOutcome({ askAssistant: function () {} }, true), 'sent');
    assert.equal(online.askOutcome({ askAssistant: function () {} }, false), 'toast');
    assert.equal(online.askOutcome({}, false), 'shim');
    assert.equal(online.answerText({ text: 'Check the pot.', voiceMode: true, top: null }), 'Check the pot.');

    const src = fs.readFileSync(path.join(__dirname, '../../main/assets/online-voice.js'), 'utf8');
    assert.match(src, /assistant:answer/);
    assert.match(src, /assistant:voice-mode/);
    assert.match(src, /setVoiceMode/);
    assert.match(src, /getVoiceMode/);
    assert.match(src, /askAssistant/);
    assert.match(src, /__tspReapplyVoiceMode/);
    const submitFn = src.slice(src.indexOf('function submitSpokenQuestion'), src.indexOf('function rememberAnswerTop'));
    const hookBranch = submitFn.slice(0, submitFn.indexOf('ensureShimFetch'));
    assert.match(hookBranch, /setVoiceMode\(true\)/);
    assert.match(hookBranch, /askAssistant\(text\)/);
    assert.match(hookBranch, /Could not send that/);
    assert.doesNotMatch(hookBranch, /setReactValue/);
    assert.doesNotMatch(hookBranch, /'Send'/);
    const answerFn = src.slice(src.indexOf('function onAssistantAnswer'), src.indexOf('function handleVoiceResult'));
    assert.ok(answerFn.indexOf('markPageSpeaking(true)') < answerFn.lastIndexOf('Android.speakAnswer('));
    const modeListener = src.slice(src.indexOf("addEventListener('assistant:voice-mode'"), src.indexOf('function mountBar'));
    assert.doesNotMatch(modeListener, /setVoiceMode/);
    assert.match(src, /Android\.speakAnswer/);
    assert.match(src, /assistant:voice-state/);
    assert.match(src, /dataset\.assistantVoice/);
    assert.match(src, /assistant:open-citation/);
    assert.match(src, /TSP\.openCitation/);
    assert.match(src, /interruptSpeech/);
    assert.doesNotMatch(src, /new CustomEvent\('assistant:citation-open'/);
    assert.doesNotMatch(src, /Android\.speak\(/);
    assert.doesNotMatch(src, /pdf_viewer\.html/);
});

test('bundled assistant speaks through grok-tts and still talks on a 429', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../main/assets/ai_assistant.html'), 'utf8');
    assert.match(html, /grok-voice\.js/);
    assert.match(html, /ttsUrlFromAssistant\(GROK_URL\)/);
    assert.match(html, /voice_id:/);
    assert.match(html, /Grok voice limit reached today/);
    assert.match(html, /assistant:citation-open/);
    assert.match(html, /isGrokVoiceLimit/);
    assert.match(html, /isUsageUnavailable/);
    assert.match(html, /isInvalidVoiceId/);
    assert.match(html, /ttsRequestBody/);
    assert.match(html, /playGrokTts\(spoken, token, voiceId, gen, retried, true\)/);
    assert.doesNotMatch(html, /['"]sage['"]/);
    assert.match(html, /speakWithDevice\(spoken, gen\)/);
    assert.match(html, /Grok voice unavailable — using device voice/);
    assert.match(html, /assistant:voice-state/);
    assert.match(html, /dataset\.assistantVoice/);
    assert.match(html, /TSP\.openCitation/);
    assert.match(html, /assistant:open-citation/);
    assert.match(html, /assistant:citation-open/);
    assert.doesNotMatch(html, /Android\.openCitation/);
    assert.doesNotMatch(html, /action:\s*'tts'/);
    assert.match(html, /manualId/);
    assert.match(html, /formatAssistantHtml/);

    const shell = fs.readFileSync(
        path.join(__dirname, '../../main/java/com/photometrytools/MainActivity.java'),
        'utf8'
    );
    assert.match(shell, /TextToSpeech/);
    assert.match(shell, /speakAnswer/);
    assert.match(shell, /MediaPlayer/);
    assert.match(shell, /injectOnlineVoice/);
    assert.match(shell, /assistant:citation-open/);
    assert.match(shell, /onCitationObserved/);
    assert.match(shell, /assistant:voice-state/);
    assert.doesNotMatch(shell, /Android\.openCitation/);
    assert.doesNotMatch(shell, /pdf_viewer\.html\?manual_id/);
    const speech = fs.readFileSync(
        path.join(__dirname, '../../main/java/com/photometrytools/GrokSpeech.java'),
        'utf8'
    );
    assert.match(speech, /functions\/v1\/grok-tts/);
    assert.match(speech, /Grok voice limit reached today/);
    assert.match(speech, /Grok voice unavailable — using device voice/);
    assert.match(speech, /usage_unavailable/);
    assert.match(speech, /daily_limit_reached/);
    assert.match(speech, /rate_limited/);
    assert.match(speech, /invalid_voice_id/);
    assert.match(speech, /return "eve"/);
    assert.match(speech, /return "invalid_voice"/);
    assert.doesNotMatch(speech, /["']sage["']/);
    assert.match(shell, /omitVoice/);
    assert.match(shell, /"invalid_voice"\.equals\(kind\) && !omitVoice/);
    assert.match(shell, /if \(!omitVoice\) payload\.put\("voice_id", GrokSpeech\.normalizeVoiceId\(voiceId\)\)/);
    const viewer = fs.readFileSync(path.join(__dirname, '../../main/assets/pdf_viewer.html'), 'utf8');
    assert.match(viewer, /Back to answer/);
    assert.match(viewer, /openedFromAssistant/);
    assert.match(viewer, /params\.get\('page'\)/);
    const settings = fs.readFileSync(path.join(__dirname, '../../main/assets/settings.html'), 'utf8');
    assert.match(settings, /id="zappVoiceEngine"/);
    assert.match(settings, /Grok voice/);
    assert.match(settings, /Device voice/);
    assert.match(settings, /autoOpenCitedManual/);
    assert.match(settings, /grok-tts/);
    assert.match(settings, /zappVoice:\s*'eve'/);
    assert.match(settings, /migrateStoredVoice/);
    assert.doesNotMatch(settings, /["']sage["']/i);
    const onlineSrc = fs.readFileSync(path.join(__dirname, '../../main/assets/online-voice.js'), 'utf8');
    assert.match(onlineSrc, /migrateStoredVoice/);
    assert.doesNotMatch(onlineSrc, /["']sage["']/i);
});
