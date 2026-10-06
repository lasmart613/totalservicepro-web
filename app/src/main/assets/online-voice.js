/**
 * Online Android voice for the live Next.js assistant (repairplanet.net/ai-assistant).
 *
 * That page has no speechSynthesis and does not call Android.speak. This script
 * is injected by the shell. While Voice is on it asks grok-assistant for the
 * short voice reply, then Android.speakAnswer plays it through grok-tts.
 * The page still owns citation auto-open. This script never loads a viewer
 * and never dispatches assistant:citation-open.
 */
(function (root) {
    var TTS_PROJECT = 'https://yljztfajyvjzqikxdddf.supabase.co';

    function isAssistantPath(path) {
        var p = String(path || '').split('?')[0].replace(/\/+$/, '');
        return p === '/ai-assistant';
    }

    function isLiveHost(hostname) {
        return hostname === 'repairplanet.net' || hostname === 'www.repairplanet.net';
    }

    /**
     * When voice mode is on, a grok-assistant chat body is rewritten so
     * voiceMode is true. Usage and other actions are left alone.
     * Returns the new JSON body, or null when the request should pass through.
     */
    function planVoiceChat(voiceOn, url, body) {
        if (!voiceOn) return null;
        if (String(url || '').indexOf('/functions/v1/grok-assistant') < 0) return null;
        if (typeof body !== 'string' || !body) return null;
        var payload;
        try { payload = JSON.parse(body); } catch (e) { return null; }
        if (!payload || payload.action !== 'chat') return null;
        payload.voiceMode = true;
        return JSON.stringify(payload);
    }

    function assistantReplyText(data) {
        var content = data && data.choices && data.choices[0] && data.choices[0].message
            && data.choices[0].message.content;
        return content ? String(content) : '';
    }

    function requestUrl(input) {
        if (typeof input === 'string') return input;
        if (input && typeof input.url === 'string') return input.url;
        return '';
    }

    var api = {
        isAssistantPath: isAssistantPath,
        isLiveHost: isLiveHost,
        planVoiceChat: planVoiceChat,
        assistantReplyText: assistantReplyText
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.TSPOnlineVoice = api;

    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!isLiveHost(location.hostname)) return;
    if (window.__tspOnlineVoiceBoot) return;
    window.__tspOnlineVoiceBoot = true;

    var voiceOn = false;
    var chatGen = 0;
    var lastTop = null;
    var onAssistant = false;

    function readPrefs() {
        var engine = 'grok';
        var voice = 'sage';
        try {
            var raw = localStorage.getItem('tsp_settings');
            var s = raw ? JSON.parse(raw) : {};
            if (s.zappVoiceEngine === 'device') engine = 'device';
            voice = window.TSPGrokVoice
                ? TSPGrokVoice.normalizeVoiceId(s.zappVoice)
                : (s.zappVoice || 'sage');
        } catch (e) {}
        return { engine: engine, voice: voice };
    }

    function writePrefs(engine, voice) {
        try {
            var raw = localStorage.getItem('tsp_settings');
            var s = raw ? JSON.parse(raw) : {};
            s.zappVoiceEngine = engine === 'device' ? 'device' : 'grok';
            s.zappVoice = window.TSPGrokVoice ? TSPGrokVoice.normalizeVoiceId(voice) : (voice || 'sage');
            localStorage.setItem('tsp_settings', JSON.stringify(s));
        } catch (e) {}
    }

    function readVoiceOn() {
        try { return localStorage.getItem('tspAndroidVoiceMode') === '1'; } catch (e) { return false; }
    }

    function writeVoiceOn(on) {
        voiceOn = !!on;
        try { localStorage.setItem('tspAndroidVoiceMode', voiceOn ? '1' : '0'); } catch (e) {}
    }

    function readToken() {
        try {
            var raw = localStorage.getItem('tsp-auth-token');
            if (!raw) return '';
            var parsed = JSON.parse(raw);
            var sess = parsed.currentSession || parsed;
            return (sess && sess.access_token) || '';
        } catch (e) { return ''; }
    }

    function ttsUrl() {
        if (window.TSPGrokVoice) return TSPGrokVoice.ttsUrlFromProject(TTS_PROJECT);
        return TTS_PROJECT + '/functions/v1/grok-tts';
    }

    function markPageSpeaking(speaking) {
        var on = !!speaking;
        window.__tspNativeVoiceSpeaking = on;
        if (!window.TSP) window.TSP = {};
        if (typeof window.TSP.isVoiceSpeaking !== 'function' || window.TSP.isVoiceSpeaking.__tspNative) {
            window.TSP.isVoiceSpeaking = function () { return window.__tspNativeVoiceSpeaking === true; };
            window.TSP.isVoiceSpeaking.__tspNative = true;
        }
        var root = document.documentElement;
        if (on) root.dataset.assistantVoice = 'speaking';
        else if (root.dataset.assistantVoice === 'speaking') delete root.dataset.assistantVoice;
        window.dispatchEvent(new CustomEvent('assistant:voice-state', { detail: { speaking: on } }));
    }

    function installFetch() {
        if (!window.fetch || window.fetch.__tspOnlineVoice) return;
        var orig = window.fetch.bind(window);
        window.__tspOrigFetch = orig;
        function wrapped(input, init) {
            var nextInit = init;
            var generation = 0;
            var speak = false;
            try {
                var url = requestUrl(input);
                var body = init && typeof init.body === 'string' ? init.body : '';
                var rewritten = planVoiceChat(voiceOn && isAssistantPath(location.pathname), url, body);
                if (rewritten) {
                    nextInit = {};
                    if (init) {
                        for (var k in init) {
                            if (Object.prototype.hasOwnProperty.call(init, k)) nextInit[k] = init[k];
                        }
                    }
                    nextInit.body = rewritten;
                    chatGen += 1;
                    generation = chatGen;
                    speak = true;
                    if (window.Android && Android.interruptSpeech) Android.interruptSpeech();
                    markPageSpeaking(true);
                }
            } catch (e) {
                nextInit = init;
                speak = false;
            }
            var pending = orig(input, nextInit);
            if (speak) observeChat(pending, generation);
            return pending;
        }
        wrapped.__tspOnlineVoice = true;
        window.fetch = wrapped;
    }

    function observeChat(pending, generation) {
        function releaseIfCurrent() {
            if (generation !== chatGen) return;
            markPageSpeaking(false);
        }
        pending.then(function (resp) {
            if (generation !== chatGen || !voiceOn) {
                releaseIfCurrent();
                return;
            }
            var copy;
            try { copy = resp.clone(); } catch (e) {
                releaseIfCurrent();
                return;
            }
            copy.json().then(function (data) {
                if (generation !== chatGen || !voiceOn || !resp.ok) {
                    releaseIfCurrent();
                    return;
                }
                var content = assistantReplyText(data);
                if (!content) {
                    releaseIfCurrent();
                    return;
                }
                if (window.TSPGrokVoice) lastTop = TSPGrokVoice.topCitation(data, content);
                var spoken = window.TSPGrokVoice ? TSPGrokVoice.prepareSpeechText(content) : content.trim();
                if (!spoken || !window.Android || !Android.speakAnswer) {
                    releaseIfCurrent();
                    return;
                }
                var prefs = readPrefs();
                Android.speakAnswer(spoken, prefs.voice, prefs.engine, readToken());
            }).catch(function () { releaseIfCurrent(); });
        }, function () { releaseIfCurrent(); });
    }

    function fillVoiceSelect(list) {
        var sel = document.getElementById('tsp-voice-id');
        if (!sel) return;
        var voices = (list && list.length)
            ? list
            : (window.TSPGrokVoice ? TSPGrokVoice.allowlistVoices() : [{ id: 'sage', label: 'Sage' }]);
        var current = readPrefs().voice;
        sel.innerHTML = '';
        voices.forEach(function (v) {
            var opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.label || v.id;
            sel.appendChild(opt);
        });
        sel.value = voices.some(function (v) { return v.id === current; }) ? current : voices[0].id;
    }

    function refreshVoiceLabels() {
        var orig = window.__tspOrigFetch;
        var token = readToken();
        if (!orig || !token) return;
        orig(ttsUrl(), {
            method: 'GET',
            headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
        }).then(function (resp) {
            if (!resp.ok) return null;
            return resp.json();
        }).then(function (data) {
            if (!data || !window.TSPGrokVoice) return;
            fillVoiceSelect(TSPGrokVoice.parseVoiceList(data));
        }).catch(function () {});
    }

    function syncBar() {
        var bar = document.getElementById('tsp-android-voice');
        if (!bar) return;
        var toggle = document.getElementById('tsp-voice-toggle');
        var extras = document.getElementById('tsp-voice-extras');
        if (toggle) toggle.textContent = voiceOn ? '🎙️ Voice on' : '🎙️ Voice';
        if (extras) extras.style.display = voiceOn ? 'flex' : 'none';
    }

    function setReactValue(el, value) {
        var proto = window.HTMLTextAreaElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function submitSpokenQuestion(text) {
        var area = document.querySelector('textarea.input');
        if (!area) return;
        setReactValue(area, text);
        setTimeout(function () {
            var buttons = document.querySelectorAll('button.btn-primary');
            for (var i = 0; i < buttons.length; i++) {
                if ((buttons[i].textContent || '').trim() === 'Send') {
                    buttons[i].click();
                    return;
                }
            }
        }, 30);
    }

    function handleVoiceResult(text) {
        if (!voiceOn || !isAssistantPath(location.pathname)) return false;
        var normalized = String(text || '').trim();
        if (!normalized) return true;
        if (window.TSPGrokVoice && TSPGrokVoice.isOpenCommand(normalized)) {
            if (window.Android && Android.stopSpeaking) Android.stopSpeaking();
            var target = lastTop;
            if (!target) {
                if (window.Android && Android.showToast) Android.showToast('No cited page to open yet');
                return true;
            }
            if (window.TSP && typeof window.TSP.openCitation === 'function') {
                window.TSP.openCitation(target.manualId, target.page);
            } else {
                window.dispatchEvent(new CustomEvent('assistant:open-citation', {
                    detail: { manualId: target.manualId, page: target.page }
                }));
            }
            return true;
        }
        submitSpokenQuestion(normalized);
        return true;
    }

    function installSpeechHooks() {
        if (window.__tspOnlineVoiceHooks) return;
        window.__tspOnlineVoiceHooks = true;
        var prevResult = window.onSpeechResult;
        var prevError = window.onSpeechError;
        window.onSpeechResult = function (text) {
            if (handleVoiceResult(text)) return;
            if (typeof prevResult === 'function') prevResult(text);
        };
        window.onSpeechError = function (err) {
            var mic = document.getElementById('tsp-voice-mic');
            if (mic) mic.textContent = '🎤';
            if (err && err !== 'cancelled' && err !== 'no_match' && window.Android && Android.showToast) {
                Android.showToast('Voice error: ' + err);
            }
            if (typeof prevError === 'function') prevError(err);
        };
        window.addEventListener('assistant:voice-state', function (ev) {
            var speaking = !!(ev && ev.detail && ev.detail.speaking);
            var stop = document.getElementById('tsp-voice-stop');
            if (stop) stop.style.display = speaking ? 'inline-flex' : 'none';
        });
    }

    function mountBar() {
        if (!document.body || document.getElementById('tsp-android-voice')) return;
        var bar = document.createElement('div');
        bar.id = 'tsp-android-voice';
        bar.style.cssText = 'position:fixed;z-index:80;top:68px;right:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-end;background:rgba(20,20,28,.94);color:#f5f0e6;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:6px;max-width:min(92vw,440px);font:12px/1.2 system-ui,sans-serif;';
        bar.innerHTML = ''
            + '<button type="button" id="tsp-voice-toggle" style="background:#6d28d9;color:#fff;border:0;border-radius:999px;padding:6px 10px;font:inherit;">🎙️ Voice</button>'
            + '<span id="tsp-voice-extras" style="display:none;gap:6px;align-items:center;flex-wrap:wrap;">'
            + '<button type="button" id="tsp-voice-mic" style="background:transparent;color:inherit;border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:6px 8px;font:inherit;">🎤</button>'
            + '<button type="button" id="tsp-voice-stop" style="display:none;background:transparent;color:inherit;border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:6px 8px;font:inherit;">Stop</button>'
            + '<select id="tsp-voice-engine" style="background:#111;color:inherit;border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:4px;font:inherit;">'
            + '<option value="grok">Grok voice</option><option value="device">Device voice</option></select>'
            + '<select id="tsp-voice-id" style="background:#111;color:inherit;border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:4px;font:inherit;max-width:150px;"></select>'
            + '</span>';
        document.body.appendChild(bar);
        fillVoiceSelect(window.TSPGrokVoice ? TSPGrokVoice.allowlistVoices() : null);
        var prefs = readPrefs();
        var engine = document.getElementById('tsp-voice-engine');
        var voice = document.getElementById('tsp-voice-id');
        if (engine) engine.value = prefs.engine;
        if (voice && prefs.voice) voice.value = prefs.voice;
        document.getElementById('tsp-voice-toggle').addEventListener('click', function () {
            writeVoiceOn(!voiceOn);
            if (!voiceOn && window.Android && Android.stopSpeaking) Android.stopSpeaking();
            syncBar();
            if (voiceOn) refreshVoiceLabels();
        });
        document.getElementById('tsp-voice-mic').addEventListener('click', function () {
            if (!window.Android || !Android.startVoiceRecognition) return;
            if (window.Android.stopSpeaking) Android.stopSpeaking();
            Android.startVoiceRecognition();
            this.textContent = '🔴';
        });
        document.getElementById('tsp-voice-stop').addEventListener('click', function () {
            if (window.Android && Android.stopSpeaking) Android.stopSpeaking();
        });
        engine.addEventListener('change', function () {
            writePrefs(engine.value, voice.value);
        });
        voice.addEventListener('change', function () {
            writePrefs(engine.value, voice.value);
        });
        voiceOn = readVoiceOn();
        syncBar();
    }

    function syncRoute() {
        var on = isAssistantPath(location.pathname);
        if (!on) {
            if (onAssistant && voiceOn && window.Android && Android.stopSpeaking) Android.stopSpeaking();
            onAssistant = false;
            var bar = document.getElementById('tsp-android-voice');
            if (bar) bar.style.display = 'none';
            return;
        }
        onAssistant = true;
        mountBar();
        var existing = document.getElementById('tsp-android-voice');
        if (existing) existing.style.display = 'flex';
        syncBar();
    }

    function installNav() {
        if (window.__tspOnlineVoiceNav) return;
        window.__tspOnlineVoiceNav = true;
        var push = history.pushState;
        var replace = history.replaceState;
        history.pushState = function () {
            var result = push.apply(this, arguments);
            setTimeout(syncRoute, 0);
            return result;
        };
        history.replaceState = function () {
            var result = replace.apply(this, arguments);
            setTimeout(syncRoute, 0);
            return result;
        };
        window.addEventListener('popstate', function () { setTimeout(syncRoute, 0); });
    }

    installFetch();
    installSpeechHooks();
    installNav();
    if (document.body) syncRoute();
    else document.addEventListener('DOMContentLoaded', syncRoute);
    if (window.MutationObserver && document.documentElement) {
        new MutationObserver(function () {
            if (isAssistantPath(location.pathname) && !document.getElementById('tsp-android-voice')) mountBar();
        }).observe(document.documentElement, { childList: true, subtree: true });
    }
})(typeof window !== 'undefined' ? window : globalThis);
