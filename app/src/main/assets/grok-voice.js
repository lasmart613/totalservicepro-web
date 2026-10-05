/**
 * Grok speech helpers for the Android AI assistant voice layer.
 *
 * Speaks through the Supabase Edge Function grok-tts (same project and
 * Bearer session as grok-assistant). No xAI key lives in the app.
 *
 * POST { text, voice_id, language } → audio/mpeg
 * GET  → { voices: [{ voice_id, name, ... }] }
 *
 * Prod grok-assistant TTS allowlist (unknown ids fall back to sage):
 * eve, ara, rex, sal, leo, sage. Default voice_id is sage.
 */
(function (root) {
    var ALLOWED_VOICE_IDS = ['eve', 'ara', 'rex', 'sal', 'leo', 'sage'];
    /** Picker order. Sage is the prod grok-assistant default, so it leads the list. */
    var DISPLAY_ORDER = ['sage', 'rex', 'sal', 'leo', 'eve', 'ara'];
    var DEFAULT_VOICE_ID = 'sage';
    var MAX_TTS_CHARS = 4000;
    var FEMALE_IDS = { eve: true, ara: true };

    var BUILTIN_LABELS = {
        sage: 'Sage — warm & clear',
        rex: 'Rex — confident',
        sal: 'Sal — versatile',
        leo: 'Leo — authoritative',
        eve: 'Eve — expressive',
        ara: 'Ara — warm & conversational'
    };

    function genderFor(id) {
        return FEMALE_IDS[id] ? 'female' : 'male';
    }

    function builtinVoice(id) {
        return {
            id: id,
            label: BUILTIN_LABELS[id] || id,
            gender: genderFor(id)
        };
    }

    function allowlistVoices() {
        return DISPLAY_ORDER.map(builtinVoice);
    }

    /** Turn the grok-assistant function URL into the sibling grok-tts URL. */
    function ttsUrlFromAssistant(grokAssistantUrl) {
        var raw = String(grokAssistantUrl || '').trim().replace(/\/+$/, '');
        if (!raw) return '';
        return raw.replace(/\/grok-assistant$/, '/grok-tts');
    }

    /** Build grok-tts from the Supabase project URL already used by a page. */
    function ttsUrlFromProject(supabaseUrl) {
        var base = String(supabaseUrl || '').trim().replace(/\/+$/, '');
        if (!base) return '';
        return base + '/functions/v1/grok-tts';
    }

    function normalizeVoiceId(id) {
        var v = String(id || '').trim();
        return ALLOWED_VOICE_IDS.indexOf(v) >= 0 ? v : DEFAULT_VOICE_ID;
    }

    function voiceIdFromItem(item) {
        if (typeof item === 'string') return item.trim();
        if (!item || typeof item !== 'object') return '';
        return String(item.voice_id || item.voiceId || item.id || '').trim();
    }

    /**
     * Settings picker is the prod allowlist (sage first).
     * GET /grok-tts may refresh a label, but voices outside the allowlist are
     * dropped and a partial list does not hide Sage or the other five.
     */
    function parseVoiceList(payload) {
        var raw = [];
        if (Array.isArray(payload)) raw = payload;
        else if (payload && Array.isArray(payload.voices)) raw = payload.voices;
        else if (payload && Array.isArray(payload.data)) raw = payload.data;

        var names = {};
        for (var i = 0; i < raw.length; i++) {
            var item = raw[i];
            var id = voiceIdFromItem(item);
            if (ALLOWED_VOICE_IDS.indexOf(id) < 0 || names[id]) continue;
            if (item && typeof item === 'object') {
                var name = String(item.name || item.label || '').trim();
                if (name) names[id] = name;
            }
        }

        return DISPLAY_ORDER.map(function (id) {
            var voice = builtinVoice(id);
            var name = names[id];
            if (name && name.toLowerCase() !== id.toLowerCase()) {
                voice.label = voice.label.split('—')[0].trim() + ' — ' + name;
            }
            return voice;
        });
    }

    function voicesForGender(list, gender) {
        var src = (list && list.length) ? list : allowlistVoices();
        if (gender !== 'female' && gender !== 'male') return src.slice();
        var filtered = src.filter(function (v) { return v.gender === gender; });
        return filtered.length ? filtered : src.slice();
    }

    function stripForSpeech(text) {
        return String(text || '')
            .replace(/\[\[cite:[^\]]*\]\]/gi, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\n— Source:[\s\S]*$/m, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function clipSpeechText(text, maxChars) {
        var max = Number(maxChars);
        if (!isFinite(max) || max < 1) max = MAX_TTS_CHARS;
        if (max > MAX_TTS_CHARS) max = MAX_TTS_CHARS;
        var t = String(text || '').trim();
        if (t.length <= max) return t;
        var cut = t.lastIndexOf('.', max);
        if (cut < Math.min(200, max)) return t.substring(0, max).trim();
        return t.substring(0, cut + 1).trim();
    }

    function prepareSpeechText(text) {
        return clipSpeechText(stripForSpeech(text), MAX_TTS_CHARS);
    }

    /**
     * grok-tts returns text_too_long as HTTP 400 (text over 4000 chars)
     * and HTTP 413 (body over the function limit). Both use error text_too_long.
     * A 413 with no JSON body is the same case.
     */
    function isTextTooLong(status, body) {
        var code = body && (body.error || body.code);
        if ((status === 400 || status === 413) && code === 'text_too_long') return true;
        if (status === 413 && (body == null || !body.error || body.error === 'text_too_long')) return true;
        return false;
    }

    /**
     * Daily quota or per-minute burst from grok-tts.
     * These still speak: the assistant falls back to device TTS and shows
     * "Grok voice limit reached today". upstream_rate_limited is not this case.
     */
    function isGrokVoiceLimit(status, body) {
        var code = body && (body.error || body.code);
        return status === 429 && (code === 'daily_limit_reached' || code === 'rate_limited');
    }

    /**
     * Quota log could not be written. Same device-TTS fallback as any other
     * non-audio failure (not the daily-limit notice).
     */
    function isUsageUnavailable(status, body) {
        var code = body && (body.error || body.code);
        return status === 503 && code === 'usage_unavailable';
    }

    function asPositivePage(value) {
        var n = Number(String(value == null ? '' : value).trim());
        if (!isFinite(n) || n < 1 || n > 9999) return undefined;
        return Math.floor(n);
    }

    function parseCitationMarkers(content) {
        var out = [];
        var seen = {};
        var re = /\[\[cite:([^\]]+)\]\]/gi;
        var m;
        while ((m = re.exec(String(content || '')))) {
            var qs;
            try { qs = new URLSearchParams(String(m[1] || '').trim()); }
            catch (e) { continue; }
            var id = Number(qs.get('id') || qs.get('manualId') || '');
            if (!isFinite(id) || id < 1) continue;
            var page = asPositivePage(qs.get('p') || qs.get('page'));
            var key = id + '|' + (page || '');
            if (seen[key]) continue;
            seen[key] = true;
            var cite = { manualId: id };
            if (page) cite.page = page;
            var title = qs.get('t') || qs.get('title');
            if (title) cite.title = title;
            out.push(cite);
        }
        return out;
    }

    function mergeCitations(lists) {
        var out = [];
        var seen = {};
        (lists || []).forEach(function (list) {
            (list || []).forEach(function (c) {
                if (!c) return;
                var id = Number(c.manualId != null ? c.manualId : c.manual_id);
                if (!isFinite(id) || id < 1) return;
                var page = asPositivePage(c.page != null ? c.page : c.p);
                var key = id + '|' + (page || '');
                if (seen[key]) return;
                seen[key] = true;
                var cite = { manualId: id };
                if (page) cite.page = page;
                if (c.title) cite.title = String(c.title);
                out.push(cite);
            });
        });
        var located = {};
        out.forEach(function (c) { if (c.page) located[c.manualId] = true; });
        return out.filter(function (c) { return c.page || !located[c.manualId]; });
    }

    /** Both fields are numbers ≥ 1. Missing or invalid page does not open. */
    function normalizeCitationTarget(manualId, page) {
        var id = Number(String(manualId == null ? '' : manualId).trim());
        var p = asPositivePage(page);
        if (!isFinite(id) || id < 1 || !p) return null;
        return { manualId: id, page: p };
    }

    /** Top citation only, and only when it has a physical page. General guidance stays closed. */
    function topCitation(data, content) {
        var meta = data && (data._meta || data.meta);
        if (meta && meta.generalGuidance) return null;
        var lists = [];
        if (meta && Array.isArray(meta.citations)) lists.push(meta.citations);
        if (data && Array.isArray(data.citations)) lists.push(data.citations);
        lists.push(parseCitationMarkers(content));
        var merged = mergeCitations(lists);
        if (!merged.length) return null;
        return normalizeCitationTarget(merged[0].manualId, merged[0].page);
    }

    function isOpenCommand(text) {
        return /^(?:please\s+)?open(?:\s+(?:it|the(?:\s+(?:manual|page|citation|source))?))?[.!?]?$/i
            .test(String(text || '').trim());
    }

    var api = {
        ALLOWED_VOICE_IDS: ALLOWED_VOICE_IDS,
        DEFAULT_VOICE_ID: DEFAULT_VOICE_ID,
        MAX_TTS_CHARS: MAX_TTS_CHARS,
        allowlistVoices: allowlistVoices,
        ttsUrlFromAssistant: ttsUrlFromAssistant,
        ttsUrlFromProject: ttsUrlFromProject,
        normalizeVoiceId: normalizeVoiceId,
        parseVoiceList: parseVoiceList,
        voicesForGender: voicesForGender,
        prepareSpeechText: prepareSpeechText,
        clipSpeechText: clipSpeechText,
        isTextTooLong: isTextTooLong,
        isGrokVoiceLimit: isGrokVoiceLimit,
        isUsageUnavailable: isUsageUnavailable,
        normalizeCitationTarget: normalizeCitationTarget,
        topCitation: topCitation,
        isOpenCommand: isOpenCommand
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.TSPGrokVoice = api;
})(typeof window !== 'undefined' ? window : globalThis);
