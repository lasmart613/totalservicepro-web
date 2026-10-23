package com.photometrytools;

import org.junit.Test;

import java.nio.charset.StandardCharsets;

import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

public class SessionSealedTest {
    @Test
    public void roundTripHidesThePlaintext() throws Exception {
        KeyGenerator gen = KeyGenerator.getInstance("AES");
        gen.init(256);
        SecretKey key = gen.generateKey();
        String json = "{\"refresh_token\":\"secret-refresh\",\"access_token\":\"secret-access\"}";
        byte[] sealed = SessionSealed.seal(key, json.getBytes(StandardCharsets.UTF_8));
        String raw = new String(sealed, StandardCharsets.ISO_8859_1);
        assertFalse(raw.contains("secret-refresh"));
        String opened = new String(SessionSealed.open(key, sealed), StandardCharsets.UTF_8);
        assertEquals(json, opened);
    }
}
