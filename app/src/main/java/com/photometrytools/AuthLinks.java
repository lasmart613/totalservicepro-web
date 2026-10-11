package com.photometrytools;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Supabase email confirmation, magic-link, and password-reset links that this
 * app did not start. Those open in the external browser. A return that matches
 * the pending app nonce stays in the app.
 */
public final class AuthLinks {
    private AuthLinks() {}

    public static boolean shouldOpenInBrowser(String url, AuthHandoff.Pending pending, long nowMs) {
        Parsed parsed = parse(url);
        if (parsed == null) return false;
        String nonce = parsed.params.get("tsp_nonce");
        String state = parsed.params.get("state");
        if (AuthHandoff.matches(pending, blankToNull(nonce), blankToNull(state), nowMs)) return false;
        if (present(parsed.params.get("token_hash"))) return true;
        if (isEmailType(parsed.params.get("type"))) return true;
        return present(parsed.params.get("code"));
    }

    private static boolean isEmailType(String type) {
        if (type == null) return false;
        String lower = type.toLowerCase(Locale.US);
        return "recovery".equals(lower) || "signup".equals(lower) || "magiclink".equals(lower)
                || "email".equals(lower) || "invite".equals(lower);
    }

    private static boolean present(String value) {
        return value != null && !value.isEmpty();
    }

    private static String blankToNull(String value) {
        return value == null || value.isEmpty() ? null : value;
    }

    private static Parsed parse(String url) {
        if (url == null || url.isEmpty()) return null;
        int hash = url.indexOf('#');
        String fragment = hash >= 0 ? url.substring(hash + 1) : "";
        String before = hash >= 0 ? url.substring(0, hash) : url;
        int schemeSep = before.indexOf("://");
        if (schemeSep <= 0) return null;
        String scheme = before.substring(0, schemeSep).toLowerCase(Locale.US);
        if (!"https".equals(scheme)) return null;
        String rest = before.substring(schemeSep + 3);
        int slash = rest.indexOf('/');
        int question = rest.indexOf('?');
        int hostEnd = rest.length();
        if (slash >= 0) hostEnd = Math.min(hostEnd, slash);
        if (question >= 0) hostEnd = Math.min(hostEnd, question);
        String hostPort = rest.substring(0, hostEnd);
        int at = hostPort.lastIndexOf('@');
        if (at >= 0) hostPort = hostPort.substring(at + 1);
        int colon = hostPort.indexOf(':');
        String host = (colon >= 0 ? hostPort.substring(0, colon) : hostPort).toLowerCase(Locale.US);
        if (!"repairplanet.net".equals(host) && !"www.repairplanet.net".equals(host)) return null;
        String pathQuery = hostEnd < rest.length() ? rest.substring(hostEnd) : "/";
        if (pathQuery.startsWith("?")) pathQuery = "/" + pathQuery;
        int q = pathQuery.indexOf('?');
        String path = q >= 0 ? pathQuery.substring(0, q) : pathQuery;
        String query = q >= 0 ? pathQuery.substring(q + 1) : "";
        if (path.length() > 1 && path.endsWith("/")) path = path.substring(0, path.length() - 1);
        if (!"/auth/callback".equals(path) && !"/auth/confirm".equals(path) && !path.startsWith("/auth/")) {
            return null;
        }
        Map<String, String> params = new HashMap<>();
        putQuery(params, query);
        putQuery(params, fragment);
        return new Parsed(params);
    }

    private static void putQuery(Map<String, String> into, String raw) {
        if (raw == null || raw.isEmpty()) return;
        String[] parts = raw.split("&", -1);
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i];
            if (part.isEmpty()) continue;
            int eq = part.indexOf('=');
            String key = decode(eq >= 0 ? part.substring(0, eq) : part);
            String value = eq >= 0 ? decode(part.substring(eq + 1)) : "";
            if (!into.containsKey(key)) into.put(key, value);
        }
    }

    private static String decode(String raw) {
        try {
            return URLDecoder.decode(raw, StandardCharsets.UTF_8.name());
        } catch (IllegalArgumentException | UnsupportedEncodingException e) {
            return raw;
        }
    }

    private static final class Parsed {
        final Map<String, String> params;

        Parsed(Map<String, String> params) {
            this.params = params;
        }
    }
}
