package com.photometrytools;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** GoTrue refresh. The anon key is the public project key already in the app. */
public final class SupabaseSessionRefresh {
    public static final String TOKEN_URL =
            "https://yljztfajyvjzqikxdddf.supabase.co/auth/v1/token?grant_type=refresh_token";

    private SupabaseSessionRefresh() {}

    public static String refreshBlocking(String previousJson, String anonKey) {
        String refresh = SessionTokens.refreshToken(previousJson);
        if (refresh.isEmpty() || anonKey == null || anonKey.isEmpty()) return null;
        HttpURLConnection conn = null;
        try {
            byte[] body = SessionTokens.requestJson(refresh).getBytes(StandardCharsets.UTF_8);
            conn = (HttpURLConnection) new URL(TOKEN_URL).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("apikey", anonKey);
            conn.setRequestProperty("Authorization", "Bearer " + anonKey);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body);
            }
            int status = conn.getResponseCode();
            InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = read(stream);
            return SessionTokens.mergeRefresh(previousJson, status, text, System.currentTimeMillis() / 1000L);
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String read(InputStream in) throws java.io.IOException {
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        int total = 0;
        while ((n = in.read(buf)) >= 0) {
            total += n;
            if (total > 1024 * 1024) break;
            out.write(buf, 0, n);
        }
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
