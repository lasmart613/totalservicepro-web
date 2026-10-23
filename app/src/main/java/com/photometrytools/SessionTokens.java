package com.photometrytools;

import org.json.JSONObject;

/**
 * Supabase session JSON used by the Android shell.
 * Access tokens are short-lived. The refresh token is what keeps a sign-in
 * alive. This project does not set auth.sessions.not_after, so the client
 * does not invent a shorter logout. {@link #KEY_AUTH_VALIDITY_SECONDS} is 0:
 * the biometric key requires authentication on every use.
 */
public final class SessionTokens {
    /** Per-use Keystore auth. Zero means the cipher needs a prompt every time. */
    public static final int KEY_AUTH_VALIDITY_SECONDS = 0;
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
        return needsRefresh(json, nowMillis, -1L);
    }

    /**
     * {@code elapsedNow} is {@code SystemClock.elapsedRealtime()} when the session
     * was anchored with {@code expires_in}. A skewed wall clock does not move that anchor.
     */
    public static boolean needsRefresh(String json, long nowMillis, long elapsedNow) {
        if (!hasRefresh(json)) return false;
        Long left = anchoredLifeLeft(json, elapsedNow);
        if (left != null) return left <= REFRESH_LEAD_MS;
        long exp = expiresAtMillis(json);
        if (exp <= 0L) return true;
        return exp - nowMillis <= REFRESH_LEAD_MS;
    }

    /**
     * Delay until a refresh should run. Zero means now.
     * The schedule is capped at one day; resume checks again.
     */
    public static long millisUntilRefresh(String json, long nowMillis) {
        return millisUntilRefresh(json, nowMillis, -1L);
    }

    public static long millisUntilRefresh(String json, long nowMillis, long elapsedNow) {
        if (!hasRefresh(json)) return -1L;
        Long left = anchoredLifeLeft(json, elapsedNow);
        long delay;
        if (left != null) {
            delay = left - REFRESH_LEAD_MS;
        } else {
            long exp = expiresAtMillis(json);
            if (exp <= 0L) return 0L;
            delay = (exp - REFRESH_LEAD_MS) - nowMillis;
        }
        if (delay <= 0L) return 0L;
        long day = 24L * 60L * 60L * 1000L;
        return delay > day ? day : delay;
    }

    /** 400/401 from the refresh endpoint means this refresh token must not be retried. */
    public static boolean isRevokedRefresh(int status, String body) {
        return status == 400 || status == 401;
    }

    /**
     * Fold a GoTrue refresh response into the stored session.
     * A rotated refresh token replaces the previous one. Null when the body is not a session.
     */
    public static String mergeRefresh(String previousJson, int status, String body, long nowEpochSeconds) {
        return mergeRefresh(previousJson, status, body, nowEpochSeconds, -1L);
    }

    /**
     * Prefer the server {@code expires_at}. When {@code expires_in} is present and
     * {@code elapsedNow} is {@code SystemClock.elapsedRealtime()} at receipt, the
     * refresh schedule follows that lifetime instead of the wall clock.
     */
    public static String mergeRefresh(String previousJson, int status, String body, long nowEpochSeconds, long elapsedNow) {
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
            long expiresIn = resp.optLong("expires_in", 0L);
            if (resp.has("expires_at")) {
                sess.put("expires_at", resp.get("expires_at"));
            } else if (expiresIn > 0L) {
                sess.put("expires_at", nowEpochSeconds + expiresIn);
            }
            if (resp.has("token_type")) sess.put("token_type", resp.get("token_type"));
            if (resp.has("user")) sess.put("user", resp.get("user"));
            JSONObject stored = new JSONObject();
            stored.put("currentSession", sess);
            if (sess.has("expires_at")) stored.put("expiresAt", sess.get("expires_at"));
            if (expiresIn > 0L && elapsedNow >= 0L) {
                stored.put("expiresInSeconds", expiresIn);
                stored.put("receivedElapsed", elapsedNow);
            }
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

    /** Life left from the elapsed anchor, or null when this session has no anchor. */
    static Long anchoredLifeLeft(String json, long elapsedNow) {
        if (elapsedNow < 0L) return null;
        JSONObject root = rootObject(json);
        if (root == null) return null;
        long received = longField(root, "receivedElapsed");
        long expiresIn = longField(root, "expiresInSeconds");
        if (received <= 0L || expiresIn <= 0L) return null;
        if (elapsedNow < received) return 0L;
        return expiresIn * 1000L - (elapsedNow - received);
    }

    private static JSONObject rootObject(String json) {
        if (json == null || json.isEmpty()) return null;
        try {
            return new JSONObject(json);
        } catch (Exception e) {
            return null;
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
