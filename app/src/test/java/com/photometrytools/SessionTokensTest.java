package com.photometrytools;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class SessionTokensTest {
    @Test
    public void keystoreWindowIsThirtyDays() {
        assertEquals(30 * 24 * 60 * 60, SessionTokens.KEY_AUTH_VALIDITY_SECONDS);
    }

    @Test
    public void refreshLeadUsesExpiryAndDoesNotCapALongSession() {
        long now = 1_700_000_000_000L;
        String fresh = session("access", "refresh", (now / 1000L) + 3600);
        assertFalse(SessionTokens.needsRefresh(fresh, now));
        assertTrue(SessionTokens.millisUntilRefresh(fresh, now) > 120_000L);

        String soon = session("access", "refresh", (now / 1000L) + 30);
        assertTrue(SessionTokens.needsRefresh(soon, now));
        assertEquals(0L, SessionTokens.millisUntilRefresh(soon, now));

        String month = session("access", "refresh", (now / 1000L) + 40L * 24 * 60 * 60);
        assertFalse(SessionTokens.needsRefresh(month, now));
        assertEquals(24L * 60 * 60 * 1000, SessionTokens.millisUntilRefresh(month, now));
    }

    @Test
    public void missingExpiryStillRefreshesWhenARefreshTokenExists() {
        assertTrue(SessionTokens.needsRefresh("{\"access_token\":\"a\",\"refresh_token\":\"r\"}", 10L));
        assertFalse(SessionTokens.needsRefresh("{\"access_token\":\"a\"}", 10L));
        assertEquals("", SessionTokens.refreshToken(null));
    }

    @Test
    public void expiryFallsBackToJwtExp() {
        long exp = 1_800_000_000L;
        String token = jwt("user-9", exp);
        String json = "{\"access_token\":\"" + token + "\",\"refresh_token\":\"r\"}";
        assertEquals("user-9", SessionTokens.userId(json));
        assertEquals(exp * 1000L, SessionTokens.expiresAtMillis(json));
    }

    @Test
    public void refreshReplacesRotatedToken() {
        String previous = session("old-access", "old-refresh", 100);
        String body = "{\"access_token\":\"new-access\",\"refresh_token\":\"new-refresh\",\"expires_in\":3600,\"token_type\":\"bearer\"}";
        String merged = SessionTokens.mergeRefresh(previous, 200, body, 5_000L);
        assertEquals("new-access", SessionTokens.accessToken(merged));
        assertEquals("new-refresh", SessionTokens.refreshToken(merged));
        assertEquals(8_600_000L, SessionTokens.expiresAtMillis(merged));
        assertNull(SessionTokens.mergeRefresh(previous, 401, "{\"error\":\"invalid\"}", 5_000L));
        assertTrue(SessionTokens.requestJson("abc").contains("\"refresh_token\":\"abc\""));
        assertFalse(SessionTokens.requestJson("abc").contains("access_token"));
    }

    private static String session(String access, String refresh, long expiresAtSeconds) {
        return "{\"currentSession\":{\"access_token\":\"" + access + "\",\"refresh_token\":\"" + refresh
                + "\",\"expires_at\":" + expiresAtSeconds + "}}";
    }

    private static String jwt(String sub, long exp) {
        String header = base64("{\"alg\":\"none\"}");
        String payload = base64("{\"sub\":\"" + sub + "\",\"exp\":" + exp + "}");
        return header + "." + payload + ".sig";
    }

    private static String base64(String text) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }
}
