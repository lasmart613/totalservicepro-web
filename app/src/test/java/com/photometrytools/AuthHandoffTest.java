package com.photometrytools;

import org.junit.Test;

import java.net.URLDecoder;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class AuthHandoffTest {
    @Test
    public void nonceOrStateMustMatchAndExpire() {
        AuthHandoff.Pending pending = new AuthHandoff.Pending("nonce-1", "state-1", 1_000L);
        assertTrue(AuthHandoff.matches(pending, "nonce-1", null, 1_000L));
        assertTrue(AuthHandoff.matches(pending, null, "state-1", 500L));
        assertFalse(AuthHandoff.matches(pending, "other", "other", 500L));
        assertFalse(AuthHandoff.matches(pending, "nonce-1", "state-1", 1_001L));
        assertFalse(AuthHandoff.matches(null, "nonce-1", "state-1", 0L));
    }

    @Test
    public void nonceIsAddedToRedirectTo() throws Exception {
        String authorize = "https://yljztfajyvjzqikxdddf.supabase.co/auth/v1/authorize"
                + "?provider=google&redirect_to=https%3A%2F%2Frepairplanet.net%2Fauth%2Fcallback%3Fnext%3D%2F"
                + "&state=abc";
        String rewritten = AuthHandoff.withNonceOnRedirect(authorize, "n-9");
        int start = rewritten.indexOf("redirect_to=") + "redirect_to=".length();
        int end = rewritten.indexOf("&state=");
        String redirect = URLDecoder.decode(rewritten.substring(start, end), "UTF-8");
        assertEquals("https://repairplanet.net/auth/callback?app=1&tsp_nonce=n-9&next=/", redirect);
        assertTrue(rewritten.contains("state=abc"));
    }

    @Test
    public void wwwReturnUrlIsRewrittenToTheApex() {
        assertEquals(
                "https://repairplanet.net/auth/callback?app=1&tsp_nonce=n-9&next=/",
                AuthHandoff.stampAppReturn("https://www.repairplanet.net/auth/callback?next=/", "n-9"));
    }

    @Test
    public void appNonceIsThirtyTwoLowerHexChars() {
        String nonce = AuthHandoff.newNonce(new java.security.SecureRandom());
        assertTrue(AuthHandoff.isAppNonce(nonce));
        assertFalse(AuthHandoff.isAppNonce("n-9"));
        assertFalse(AuthHandoff.isAppNonce("0123456789ABCDEF0123456789ABCDEF"));
        assertFalse(AuthHandoff.isAppNonce(null));
    }
}
