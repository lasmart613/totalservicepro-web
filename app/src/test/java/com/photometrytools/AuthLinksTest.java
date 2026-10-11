package com.photometrytools;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class AuthLinksTest {
    private static final String NONCE = "0123456789abcdef0123456789abcdef";
    private static final AuthHandoff.Pending PENDING = new AuthHandoff.Pending(NONCE, "state-1", 5_000L);

    @Test
    public void emailLinksWithoutOurNonceOpenInTheBrowser() {
        assertTrue(browser("https://repairplanet.net/auth/callback?token_hash=abc&type=signup"));
        assertTrue(browser("https://repairplanet.net/auth/callback?token_hash=abc&type=email"));
        assertTrue(browser("https://www.repairplanet.net/auth/confirm?token_hash=abc&type=magiclink"));
        assertTrue(browser("https://repairplanet.net/auth/callback#access_token=tok&refresh_token=r&type=recovery"));
        assertTrue(browser("https://repairplanet.net/auth/callback#access_token=tok&type=signup"));
        assertTrue(browser("https://repairplanet.net/auth/callback#access_token=tok&type=magiclink"));
        assertTrue(browser("https://repairplanet.net/auth/callback?code=pkce-code"));
        assertTrue(browser("https://repairplanet.net/auth/callback?code=pkce-code&type=magiclink"));
    }

    @Test
    public void matchingAppNonceStaysInTheApp() {
        assertFalse(browser(
                "https://repairplanet.net/auth/callback?code=pkce&app=1&tsp_nonce=" + NONCE));
        assertFalse(browser(
                "https://repairplanet.net/auth/callback?app=1&tsp_nonce=" + NONCE
                        + "#access_token=tok&refresh_token=r"));
        assertFalse(AuthLinks.shouldOpenInBrowser(
                "https://repairplanet.net/auth/callback?code=pkce&state=state-1",
                PENDING, 1_000L));
    }

    @Test
    public void forgedTokenDumpIsNotAnEmailLink() {
        assertFalse(browser("https://repairplanet.net/auth/callback#access_token=attacker&refresh_token=r"));
        assertFalse(browser("https://repairplanet.net/auth/callback?app=1"));
        assertFalse(browser("https://evil.example/auth/callback?token_hash=abc&type=signup"));
        assertFalse(browser("http://repairplanet.net/auth/callback?token_hash=abc&type=email"));
        assertFalse(browser("https://repairplanet.net/login?code=nope"));
        assertFalse(AuthLinks.shouldOpenInBrowser(null, PENDING, 1_000L));
    }

    @Test
    public void codeWithSomeoneElsesNonceStillLeavesTheApp() {
        assertTrue(browser(
                "https://repairplanet.net/auth/callback?code=pkce&tsp_nonce=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    }

    private static boolean browser(String url) {
        return AuthLinks.shouldOpenInBrowser(url, PENDING, 1_000L);
    }
}
