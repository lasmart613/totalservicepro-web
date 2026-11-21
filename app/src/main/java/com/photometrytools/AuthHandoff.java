package com.photometrytools;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Locale;

/**
 * A custom-scheme or https auth callback is accepted only when it carries the
 * nonce or OAuth state stored at the moment this app opened the Custom Tab.
 * The record is single-use and expires after {@link #TTL_MS}.
 */
public final class AuthHandoff {
    public static final long TTL_MS = 5L * 60L * 1000L;

    private AuthHandoff() {}

    public static final class Pending {
        public final String nonce;
        public final String state;
        public final long expiresAtMs;

        public Pending(String nonce, String state, long expiresAtMs) {
            this.nonce = nonce;
            this.state = state == null || state.isEmpty() ? null : state;
            this.expiresAtMs = expiresAtMs;
        }
    }

    public static boolean matches(Pending pending, String nonce, String state, long nowMs) {
        if (pending == null || nowMs > pending.expiresAtMs) return false;
        if (pending.nonce != null && !pending.nonce.isEmpty() && pending.nonce.equals(nonce)) return true;
        return pending.state != null && pending.state.equals(state);
    }

    /** 16 random bytes, lowercase hex. The web handoff accepts only this shape. */
    public static boolean isAppNonce(String nonce) {
        return nonce != null && nonce.matches("^[0-9a-f]{32}$");
    }

    public static final String ISSUE_PATH = "/api/auth/android-nonce";
    public static final String BIND_PATH = "/api/auth/android-bind";

    /**
     * Nonce the site issued. The app stores {@code nonce} and opens {@link #bindUrl}
     * so the Custom Tab receives the matching httpOnly cookie.
     */
    public static final class Issued {
        public final String nonce;
        public final String proof;
        public final long exp;

        public Issued(String nonce, String proof, long exp) {
            this.nonce = nonce;
            this.proof = proof;
            this.exp = exp;
        }
    }

    /** Flat JSON from GET /api/auth/android-nonce. Null when the body is not one we issued. */
    public static Issued parseIssued(String json) {
        if (json == null || json.isEmpty()) return null;
        String nonce = stringField(json, "nonce");
        String proof = stringField(json, "proof");
        Long exp = longField(json, "exp");
        if (!isAppNonce(nonce) || proof == null || !proof.matches("^[0-9a-f]{64}$") || exp == null || exp <= 0) {
            return null;
        }
        return new Issued(nonce, proof, exp);
    }

    /**
     * Custom Tab URL that binds {@code issued} to the browser session and then
     * continues to the authorize URL the app was about to open.
     */
    public static String bindUrl(String origin, Issued issued, String continueUrl) {
        if (origin == null || issued == null || continueUrl == null) return null;
        String base = origin.endsWith("/") ? origin.substring(0, origin.length() - 1) : origin;
        return base + BIND_PATH
                + "?nonce=" + encode(issued.nonce)
                + "&proof=" + encode(issued.proof)
                + "&exp=" + issued.exp
                + "&continue_url=" + encode(continueUrl);
    }

    private static String stringField(String json, String key) {
        String needle = "\"" + key + "\"";
        int at = json.indexOf(needle);
        if (at < 0) return null;
        int colon = json.indexOf(':', at + needle.length());
        if (colon < 0) return null;
        int quote = json.indexOf('"', colon + 1);
        if (quote < 0) return null;
        int end = json.indexOf('"', quote + 1);
        if (end < 0) return null;
        return json.substring(quote + 1, end);
    }

    private static Long longField(String json, String key) {
        String needle = "\"" + key + "\"";
        int at = json.indexOf(needle);
        if (at < 0) return null;
        int colon = json.indexOf(':', at + needle.length());
        if (colon < 0) return null;
        int i = colon + 1;
        while (i < json.length() && Character.isWhitespace(json.charAt(i))) i++;
        int start = i;
        while (i < json.length() && Character.isDigit(json.charAt(i))) i++;
        if (i == start) return null;
        try {
            return Long.parseLong(json.substring(start, i));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public static String newNonce(SecureRandom random) {
        SecureRandom source = random == null ? new SecureRandom() : random;
        byte[] bytes = new byte[16];
        source.nextBytes(bytes);
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format(Locale.US, "%02x", b & 0xff));
        return sb.toString();
    }

    /**
     * Puts {@code app=1} and {@code tsp_nonce} on the authorize URL's
     * {@code redirect_to} so the site can hand the login back to this app.
     * When there is no redirect_to, those two parameters are added directly.
     */
    public static String withNonceOnRedirect(String authorizeUrl, String nonce) {
        if (authorizeUrl == null || nonce == null || nonce.isEmpty()) return authorizeUrl;
        int hash = authorizeUrl.indexOf('#');
        String fragment = hash >= 0 ? authorizeUrl.substring(hash) : "";
        String before = hash >= 0 ? authorizeUrl.substring(0, hash) : authorizeUrl;
        int q = before.indexOf('?');
        String base = q >= 0 ? before.substring(0, q) : before;
        String query = q >= 0 ? before.substring(q + 1) : "";
        String[] parts = query.isEmpty() ? new String[0] : query.split("&", -1);
        StringBuilder rebuilt = new StringBuilder();
        boolean found = false;
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i];
            if (part.isEmpty()) continue;
            if (rebuilt.length() > 0) rebuilt.append('&');
            int eq = part.indexOf('=');
            String key = decode(eq >= 0 ? part.substring(0, eq) : part);
            if ("redirect_to".equals(key)) {
                String value = eq >= 0 ? decode(part.substring(eq + 1)) : "";
                rebuilt.append("redirect_to=").append(encode(stampAppReturn(value, nonce)));
                found = true;
            } else {
                rebuilt.append(part);
            }
        }
        if (!found) {
            if (rebuilt.length() > 0) rebuilt.append('&');
            rebuilt.append("app=1&tsp_nonce=").append(encode(nonce));
        }
        return base + "?" + rebuilt + fragment;
    }

    /**
     * Return URL shape: {@code app=1}, then {@code tsp_nonce}, then the rest
     * ({@code next} and anything else already on the callback URL).
     */
    static String stampAppReturn(String redirect, String nonce) {
        if (redirect == null || redirect.isEmpty()) {
            return "?app=1&tsp_nonce=" + encode(nonce);
        }
        String hash = "";
        int h = redirect.indexOf('#');
        if (h >= 0) {
            hash = redirect.substring(h);
            redirect = redirect.substring(0, h);
        }
        int q = redirect.indexOf('?');
        String base = q >= 0 ? redirect.substring(0, q) : redirect;
        base = apexHost(base);
        String query = q >= 0 ? redirect.substring(q + 1) : "";
        StringBuilder rest = new StringBuilder();
        String[] parts = query.isEmpty() ? new String[0] : query.split("&", -1);
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i];
            if (part.isEmpty()) continue;
            int eq = part.indexOf('=');
            String key = decode(eq >= 0 ? part.substring(0, eq) : part);
            if ("app".equals(key) || "tsp_nonce".equals(key)) continue;
            if (rest.length() > 0) rest.append('&');
            rest.append(part);
        }
        StringBuilder out = new StringBuilder();
        out.append(base).append("?app=1&tsp_nonce=").append(encode(nonce));
        if (rest.length() > 0) out.append('&').append(rest);
        out.append(hash);
        return out.toString();
    }

    /** www 301s to the apex, and only the apex is in the autoVerify filter. */
    static String apexHost(String url) {
        if (url == null) return url;
        String prefix = "https://www.repairplanet.net";
        if (url.regionMatches(true, 0, prefix, 0, prefix.length())) {
            return "https://repairplanet.net" + url.substring(prefix.length());
        }
        prefix = "http://www.repairplanet.net";
        if (url.regionMatches(true, 0, prefix, 0, prefix.length())) {
            return "https://repairplanet.net" + url.substring(prefix.length());
        }
        return url;
    }

    private static String encode(String raw) {
        try {
            return URLEncoder.encode(raw, StandardCharsets.UTF_8.name()).replace("+", "%20");
        } catch (UnsupportedEncodingException e) {
            return raw;
        }
    }

    private static String decode(String raw) {
        try {
            return URLDecoder.decode(raw, StandardCharsets.UTF_8.name());
        } catch (IllegalArgumentException | UnsupportedEncodingException e) {
            return raw;
        }
    }
}
