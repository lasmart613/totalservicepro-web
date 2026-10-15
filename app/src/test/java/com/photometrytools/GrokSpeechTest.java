package com.photometrytools;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class GrokSpeechTest {

    @Test
    public void repairAiForbiddenIsItsOwnKind() {
        assertEquals("forbidden", GrokSpeech.classify(403, "application/json",
                json("{\"error\":\"repair_ai_forbidden\"}")));
        assertEquals("forbidden", GrokSpeech.classify(403, "application/json",
                json("{\"code\":\"repair_ai_forbidden\"}")));
        assertEquals(GrokSpeech.FORBIDDEN_ERROR, "repair_ai_forbidden");
        assertEquals(
                "Grok voice is available to service-company accounts; using device voice.",
                GrokSpeech.FORBIDDEN_NOTICE);
    }

    @Test
    public void otherForbiddenAndUnauthorizedStayFailed() {
        assertEquals("failed", GrokSpeech.classify(403, "application/json",
                json("{\"error\":\"Forbidden\"}")));
        assertEquals("failed", GrokSpeech.classify(403, "application/json", new byte[0]));
        assertEquals("failed", GrokSpeech.classify(401, "application/json",
                json("{\"error\":\"Unauthorized\"}")));
        assertEquals("failed", GrokSpeech.classify(401, "application/json",
                json("{\"error\":\"No auth\"}")));
        // A 401 is still the existing failure path even if the body names the new error.
        assertEquals("failed", GrokSpeech.classify(401, "application/json",
                json("{\"error\":\"repair_ai_forbidden\"}")));
        assertEquals("failed", GrokSpeech.classify(503, "application/json",
                json("{\"error\":\"usage_unavailable\"}")));
    }

    @Test
    public void capAndVoiceRetriesAreUnchanged() {
        assertEquals("limited", GrokSpeech.classify(429, "application/json",
                json("{\"error\":\"daily_limit_reached\"}")));
        assertEquals("limited", GrokSpeech.classify(429, "application/json",
                json("{\"error\":\"rate_limited\"}")));
        assertEquals("failed", GrokSpeech.classify(429, "application/json",
                json("{\"error\":\"upstream_rate_limited\"}")));
        assertEquals("invalid_voice", GrokSpeech.classify(400, "application/json",
                json("{\"error\":\"invalid_voice_id\"}")));
        assertEquals("too_long", GrokSpeech.classify(400, "application/json",
                json("{\"error\":\"text_too_long\"}")));
        assertEquals("too_long", GrokSpeech.classify(413, "application/json",
                json("{\"error\":\"text_too_long\",\"max_characters\":4000}")));
        assertEquals(4000, GrokSpeech.maxCharacters(
                json("{\"error\":\"text_too_long\",\"max_characters\":4000}")));
    }

    @Test
    public void subjectReadsJwtSub() {
        assertEquals("user-1", GrokSpeech.subject(jwt("user-1")));
        assertEquals("11111111-2222-3333-4444-555555555555",
                GrokSpeech.subject(jwt("11111111-2222-3333-4444-555555555555")));
        assertEquals("a", GrokSpeech.subject(jwt("a")));
        assertEquals("", GrokSpeech.subject(null));
        assertEquals("", GrokSpeech.subject(""));
        assertEquals("", GrokSpeech.subject("not-a-jwt"));
        assertEquals("", GrokSpeech.subject("a.!!!"));
    }

    @Test
    public void sessionBlockRemembersOneUserUntilSignOut() {
        GrokSpeech.SessionBlock block = new GrokSpeech.SessionBlock();
        String first = jwt("user-a");
        String refreshed = jwt("user-a");
        String other = jwt("user-b");

        assertFalse(first.equals(refreshed));
        assertFalse(block.blocked(first));
        assertTrue(block.remember(first));
        assertFalse(block.remember(refreshed));
        assertTrue(block.blocked(first));
        assertTrue(block.blocked(refreshed));
        assertFalse(block.blocked(other));

        assertTrue(block.remember(other));
        assertTrue(block.blocked(other));
        assertFalse(block.blocked(first));

        block.clear();
        assertFalse(block.blocked(other));
        assertFalse(block.blocked(first));
        assertTrue(block.remember(first));
        assertFalse(block.remember(first));
    }

    @Test
    public void unreadableTokensShareOneSessionKey() {
        GrokSpeech.SessionBlock block = new GrokSpeech.SessionBlock();
        assertTrue(block.remember("not-a-jwt"));
        assertFalse(block.remember(""));
        assertFalse(block.remember(null));
        assertTrue(block.blocked("also-bad"));
        assertFalse(block.blocked(jwt("user-a")));
    }

    private static byte[] json(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    /** Two different encodings of the same sub, so the block is not the raw token. */
    private static int jwtSerial;

    private static String jwt(String sub) {
        jwtSerial++;
        String header = base64Url("{\"alg\":\"none\",\"kid\":\"" + jwtSerial + "\"}");
        String payload = base64Url("{\"sub\":\"" + sub + "\",\"n\":" + jwtSerial + "}");
        return header + "." + payload + ".sig";
    }

    private static String base64Url(String text) {
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }
}
