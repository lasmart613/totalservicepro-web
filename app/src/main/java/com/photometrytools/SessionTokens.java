package com.photometrytools;

import org.json.JSONObject;

/**
 * Supabase session JSON used by the Android shell.
 * Access tokens are short-lived. The refresh token is what keeps a sign-in
 * alive. This project does not set auth.sessions.not_after, so the client
 * does not invent a shorter logout. {@link #KEY_AUTH_VALIDITY_SECONDS} is how
 * long the Keystore key stays usable after the user unlocks it.
 */
public final class SessionTokens {
    public static final int KEY_AUTH_VALIDITY_SECONDS = 30 * 24 * 60 * 60;
    public static final long REFRESH_LEAD_MS = 120_000L;

    private SessionTokens() {}

    public static String accessToken(String json) {
        JSONObject sess = sessionObject(json);
        return sess == null ? "" : sess.optString("access_token", "");
    }

    public static String refreshToken(String json) {
        JSONObject sess = sessionObject(json);
        return sess == null ? "" : sess.optString("refresh_token", "");
    }

    public static String userId(String json) {
        return CardScanContract.userIdFromAccessToken(accessToken(json));
    }

    /** Epoch milliseconds, or 0 when the session does not say when it expires. */
    public static long expiresAtMillis(String json) {
        JSONObject sess = sessionObject(json);
        if (sess == null) return 0L;
        long raw = longField(sess, "expires_at");
        if (raw <= 0L && sess.has("expires_in")) {
            raw = 0L;
        }
        if (raw <= 0L) raw = jwtExpSeconds(accessToken(json));
        if (raw <= 0L) return 0L;
        if (raw > 10_000_000_000L) return raw;
        return raw * 1000L;
    }

    public static boolean hasRefresh(String json) {
        return !refreshToken(json).isEmpty();
    }

    /** True when the access token is missing an expiry or is inside the lead window. */
    public static boolean needsRefresh(String json, long nowMillis) {
        if (!hasRefresh(json)) return false;
        long exp = expiresAtMillis(json);
        if (exp <= 0L) return true;
        return exp - nowMillis <= REFRESH_LEAD_MS;
    }

    /**
     * Delay until a refresh should run. Zero means now.
     * The schedule is capped at one day; resume checks again.
     */
    public static long millisUntilRefresh(String json, long nowMillis) {
        if (!hasRefresh(json)) return -1L;
        long exp = expiresAtMillis(json);
        if (exp <= 0L) return 0L;
        long delay = (exp - REFRESH_LEAD_MS) - nowMillis;
        if (delay <= 0L) return 0L;
        long day = 24L * 60L * 60L * 1000L;
        return delay > day ? day : delay;
    }

    /**
     * Fold a GoTrue refresh response into the stored session.
     * A rotated refresh token replaces the previous one. Null when the body is not a session.
     */
    public static String mergeRefresh(String previousJson, int status, String body, long nowEpochSeconds) {
        if (status < 200 || status >= 300 || body == null || body.isEmpty()) return null;
        try {
            JSONObject resp = new JSONObject(body);
            String access = resp.optString("access_token", "");
            String refresh = resp.optString("refresh_token", "");
            if (access.isEmpty() || refresh.isEmpty()) return null;
            JSONObject root;
            try {
                root = previousJson == null || previousJson.isEmpty()
                        ? new JSONObject()
                        : new JSONObject(previousJson);
            } catch (Exception e) {
                root = new JSONObject();
            }
            JSONObject sess = root.has("currentSession") && root.optJSONObject("currentSession") != null
                    ? root.getJSONObject("currentSession")
                    : root;
            if (sess.has("currentSession")) sess = new JSONObject();
            sess.put("access_token", access);
            sess.put("refresh_token", refresh);
            if (resp.has("expires_at")) {
                sess.put("expires_at", resp.get("expires_at"));
            } else if (resp.has("expires_in")) {
                long seconds = resp.optLong("expires_in", 0L);
                if (seconds > 0L) sess.put("expires_at", nowEpochSeconds + seconds);
            }
            if (resp.has("token_type")) sess.put("token_type", resp.get("token_type"));
            if (resp.has("user")) sess.put("user", resp.get("user"));
            JSONObject stored = new JSONObject();
            stored.put("currentSession", sess);
            if (sess.has("expires_at")) stored.put("expiresAt", sess.get("expires_at"));
            return stored.toString();
        } catch (Exception e) {
            return null;
        }
    }

    public static String requestJson(String refreshToken) {
        try {
            JSONObject body = new JSONObject();
            body.put("refresh_token", refreshToken == null ? "" : refreshToken);
            return body.toString();
        } catch (Exception e) {
            return "{\"refresh_token\":\"\"}";
        }
    }

    private static JSONObject sessionObject(String json) {
        if (json == null || json.isEmpty()) return null;
        try {
            JSONObject root = new JSONObject(json);
            if (root.has("currentSession") && root.optJSONObject("currentSession") != null) {
                return root.getJSONObject("currentSession");
            }
            return root;
        } catch (Exception e) {
            return null;
        }
    }

    private static long longField(JSONObject obj, String name) {
        if (obj == null || !obj.has(name)) return 0L;
        Object raw = obj.opt(name);
        if (raw instanceof Number) return ((Number) raw).longValue();
        try {
            String text = String.valueOf(raw).trim();
            if (text.isEmpty()) return 0L;
            if (text.indexOf('.') >= 0) return (long) Double.parseDouble(text);
            return Long.parseLong(text);
        } catch (Exception e) {
            return 0L;
        }
    }

    private static long jwtExpSeconds(String accessToken) {
        if (accessToken == null) return 0L;
        String[] parts = accessToken.split("\\.");
        if (parts.length < 2) return 0L;
        byte[] data = decodeBase64Url(parts[1]);
        if (data == null) return 0L;
        try {
            JSONObject payload = new JSONObject(new String(data, java.nio.charset.StandardCharsets.UTF_8));
            return longField(payload, "exp");
        } catch (Exception e) {
            return 0L;
        }
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
