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
    static final String FORBIDDEN_NOTICE =
            "Grok voice is available to service-company accounts; using device voice.";
    static final String FORBIDDEN_ERROR = "repair_ai_forbidden";
    static final int MAX_CHARS = 4000;

    /** xAI TTS voices. Eve is the documented default. */
    private static final String[] ALLOWED = {"eve", "ara", "rex", "sal", "leo"};

    private GrokSpeech() {}

    /** Unknown and retired voice ids read as eve. */
    static String normalizeVoiceId(String id) {
        String v = id == null ? "" : id.trim().toLowerCase(java.util.Locale.US);
        for (String allowed : ALLOWED) {
            if (allowed.equals(v)) return v;
        }
        return "eve";
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
     * too_long: 400/413 text_too_long, retry once shorter.
     * invalid_voice: 400 invalid_voice_id, retry once with voice_id omitted.
     * forbidden: 403 repair_ai_forbidden. One notice, then device TTS. Do not retry.
     * failed: everything else, including 401 and 503 usage_unavailable.
     */
    static String classify(int status, String contentType, byte[] body) {
        if (status >= 200 && status < 300 && looksLikeAudio(contentType, body)) return "audio";
        String code = jsonStringField(body, "error");
        if (code.isEmpty()) code = jsonStringField(body, "code");
        if (status == 403 && FORBIDDEN_ERROR.equals(code)) return "forbidden";
        if (status == 429 && ("daily_limit_reached".equals(code) || "rate_limited".equals(code))) {
            return "limited";
        }
        if (status == 400 && "invalid_voice_id".equals(code)) return "invalid_voice";
        if ((status == 400 || status == 413) && "text_too_long".equals(code)) return "too_long";
        if (status == 413 && code.isEmpty()) return "too_long";
        return "failed";
    }

    /** JWT {@code sub}. Empty when the token is not a readable access token. */
    static String subject(String accessToken) {
        if (accessToken == null) return "";
        String[] parts = accessToken.split("\\.");
        if (parts.length < 2) return "";
        byte[] data = decodeBase64Url(parts[1]);
        if (data == null) return "";
        String sub = jsonStringField(data, "sub");
        return sub == null ? "" : sub;
    }

    /**
     * Remembers a repair_ai_forbidden response for one signed-in user.
     * A later call for that user does not hit grok-tts again. Sign-out clears it.
     */
    static final class SessionBlock {
        private String blockedUserId;

        synchronized void clear() {
            blockedUserId = null;
        }

        synchronized boolean blocked(String accessToken) {
            return blockedUserId != null && blockedUserId.equals(userKey(accessToken));
        }

        /** @return true only the first time this user is blocked, so the notice shows once */
        synchronized boolean remember(String accessToken) {
            String key = userKey(accessToken);
            if (key.equals(blockedUserId)) return false;
            blockedUserId = key;
            return true;
        }

        private static String userKey(String accessToken) {
            String id = subject(accessToken);
            return id.isEmpty() ? "*" : id;
        }
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

    private static byte[] decodeBase64Url(String value) {
        if (value == null || value.isEmpty()) return null;
        StringBuilder alphabet = new StringBuilder(value.length() + 3);
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '-') alphabet.append('+');
            else if (c == '_') alphabet.append('/');
            else alphabet.append(c);
        }
        int remainder = alphabet.length() % 4;
        if (remainder != 0) {
            for (int i = 0; i < 4 - remainder; i++) alphabet.append('=');
        }
        int[] table = new int[128];
        java.util.Arrays.fill(table, -1);
        String digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (int i = 0; i < digits.length(); i++) table[digits.charAt(i)] = i;
        int buffer = 0;
        int bits = 0;
        java.util.ArrayList<Byte> bytes = new java.util.ArrayList<>();
        String data = alphabet.toString();
        for (int i = 0; i < data.length(); i++) {
            char c = data.charAt(i);
            if (c == '=') break;
            if (c >= 128 || table[c] < 0) return null;
            buffer = (buffer << 6) | table[c];
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                bytes.add((byte) ((buffer >> bits) & 0xFF));
            }
        }
        byte[] out = new byte[bytes.size()];
        for (int i = 0; i < bytes.size(); i++) out[i] = bytes.get(i);
        return out;
    }
}
