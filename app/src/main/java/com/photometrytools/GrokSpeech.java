package com.photometrytools;

/**
 * grok-tts request rules shared by the Android online voice path.
 * Keep the status checks aligned with app/src/main/assets/grok-voice.js.
 */
final class GrokSpeech {

    static final String TTS_URL = "https://yljztfajyvjzqikxdddf.supabase.co/functions/v1/grok-tts";
    static final String LIMIT_NOTICE = "Grok voice limit reached today";
    static final String FALLBACK_NOTICE = "Grok voice unavailable — using device voice";
    static final String SHORTENED_NOTICE = "Shortened the answer for Grok voice";
    static final int MAX_CHARS = 4000;

    private static final String[] ALLOWED = {"eve", "ara", "rex", "sal", "leo", "sage"};

    private GrokSpeech() {}

    static String normalizeVoiceId(String id) {
        String v = id == null ? "" : id.trim();
        for (String allowed : ALLOWED) {
            if (allowed.equals(v)) return v;
        }
        return "sage";
    }

    static boolean isDeviceEngine(String engine) {
        return "device".equals(engine == null ? "" : engine.trim());
    }

    /** Sentence-boundary clip. maxChars above 4000 is capped. */
    static String clipSpeechText(String text, int maxChars) {
        int max = maxChars;
        if (max < 1 || max > MAX_CHARS) max = MAX_CHARS;
        String t = text == null ? "" : text.trim();
        if (t.length() <= max) return t;
        int cut = t.lastIndexOf('.', max);
        if (cut < Math.min(200, max)) return t.substring(0, max).trim();
        return t.substring(0, cut + 1).trim();
    }

    /**
     * audio: play the body.
     * limited: 429 daily_limit_reached or rate_limited (the limit notice).
     * too_long: 400/413 text_too_long, retry once.
     * failed: everything else, including 503 usage_unavailable and upstream_rate_limited.
     */
    static String classify(int status, String contentType, byte[] body) {
        if (status >= 200 && status < 300 && looksLikeAudio(contentType, body)) return "audio";
        String code = jsonStringField(body, "error");
        if (code.isEmpty()) code = jsonStringField(body, "code");
        if (status == 429 && ("daily_limit_reached".equals(code) || "rate_limited".equals(code))) {
            return "limited";
        }
        if ((status == 400 || status == 413) && "text_too_long".equals(code)) return "too_long";
        if (status == 413 && code.isEmpty()) return "too_long";
        return "failed";
    }

    static int maxCharacters(byte[] body) {
        String raw = jsonNumberField(body, "max_characters");
        if (raw.isEmpty()) return 0;
        try {
            int n = Integer.parseInt(raw);
            return n > 0 ? n : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    static boolean looksLikeAudio(String contentType, byte[] body) {
        if (body == null || body.length < 64) return false;
        String type = contentType == null ? "" : contentType.toLowerCase(java.util.Locale.US);
        if (type.contains("json")) return false;
        if (body[0] == '{' || body[0] == '[') return false;
        return true;
    }

    static String jsonStringField(byte[] body, String field) {
        if (body == null || body.length == 0 || field == null) return "";
        String json = new String(body, java.nio.charset.StandardCharsets.UTF_8);
        String key = "\"" + field + "\"";
        int i = json.indexOf(key);
        if (i < 0) return "";
        int colon = json.indexOf(':', i + key.length());
        if (colon < 0) return "";
        int q1 = json.indexOf('"', colon + 1);
        if (q1 < 0) return "";
        int q2 = json.indexOf('"', q1 + 1);
        if (q2 < 0) return "";
        return json.substring(q1 + 1, q2);
    }

    private static String jsonNumberField(byte[] body, String field) {
        if (body == null || body.length == 0) return "";
        String json = new String(body, java.nio.charset.StandardCharsets.UTF_8);
        String key = "\"" + field + "\"";
        int i = json.indexOf(key);
        if (i < 0) return "";
        int colon = json.indexOf(':', i + key.length());
        if (colon < 0) return "";
        int start = colon + 1;
        while (start < json.length() && Character.isWhitespace(json.charAt(start))) start++;
        int end = start;
        while (end < json.length() && Character.isDigit(json.charAt(end))) end++;
        return json.substring(start, end);
    }
}
