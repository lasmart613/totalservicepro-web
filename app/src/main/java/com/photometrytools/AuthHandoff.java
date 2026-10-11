package com.photometrytools;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

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

    /**
     * Puts {@code tsp_nonce} on the authorize URL's {@code redirect_to} so the
     * site can hand it back. When there is no redirect_to, the nonce is its own
     * query parameter.
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
                rebuilt.append("redirect_to=").append(encode(appendQuery(value, "tsp_nonce", nonce)));
                found = true;
            } else {
                rebuilt.append(part);
            }
        }
        if (!found) {
            if (rebuilt.length() > 0) rebuilt.append('&');
            rebuilt.append("tsp_nonce=").append(encode(nonce));
        }
        return base + "?" + rebuilt + fragment;
    }

    static String appendQuery(String url, String key, String value) {
        if (url == null || url.isEmpty()) return key + "=" + encode(value);
        String hash = "";
        int h = url.indexOf('#');
        if (h >= 0) {
            hash = url.substring(h);
            url = url.substring(0, h);
        }
        String sep = url.indexOf('?') >= 0 ? "&" : "?";
        return url + sep + encode(key) + "=" + encode(value) + hash;
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
