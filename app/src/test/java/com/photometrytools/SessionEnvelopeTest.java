package com.photometrytools;

import org.junit.Test;

import java.nio.charset.StandardCharsets;

import javax.crypto.SecretKey;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

public class SessionEnvelopeTest {
    @Test
    public void rotationWhileUnlockedReencryptsWithTheDataKey() throws Exception {
        String first = session("rt-1");
        String second = session("rt-2");
        SessionEnvelope.Lock lock = SessionEnvelope.Lock.sealNew(first);
        byte[] before = lock.ciphertext();
        assertFalse(asText(before).contains("rt-1"));

        String rotated = lock.rotate(second);
        assertEquals(second, rotated);
        assertEquals(second, lock.session());
        assertFalse(asText(lock.ciphertext()).contains("rt-2"));
        assertFalse(java.util.Arrays.equals(before, lock.ciphertext()));

        lock.dropDataKey();
        assertNull(lock.session());
        assertNull(lock.rotate(session("rt-3")));
        assertNull(lock.recover(null, second));
        assertFalse(asText(lock.ciphertext()).contains("rt-2"));
    }

    @Test
    public void invalidatedKeyDoesNotFallBackToPlain() throws Exception {
        String json = session("rt-1");
        SessionEnvelope.Lock lock = SessionEnvelope.Lock.sealNew(json);
        SecretKey dataKey = SessionEnvelope.unpackDataKey(lock.exportPackedDataKey());
        assertNotNull(dataKey);
        assertEquals(json, lock.session());

        lock.dropDataKey();
        assertNull(lock.recover(null, json));
        assertNotNull(lock.ciphertext());

        lock.invalidate();
        assertNull(lock.recover(dataKey, json));
        assertNull(lock.session());
        assertNull(lock.ciphertext());
        assertNull(lock.rotate(session("rt-2")));
    }

    @Test
    public void unpackZerosThePackedDataKey() throws Exception {
        String json = session("rt-9");
        SessionEnvelope.Lock lock = SessionEnvelope.Lock.sealNew(json);
        byte[] packed = lock.exportPackedDataKey();
        javax.crypto.SecretKey key = SessionEnvelope.unpackDataKey(packed);
        for (byte b : packed) assertEquals(0, b);
        assertEquals(json, SessionEnvelope.open(key, lock.ciphertext()));
    }

    private static String session(String refresh) {
        return "{\"refresh_token\":\"" + refresh + "\",\"access_token\":\"access\"}";
    }

    private static String asText(byte[] raw) {
        return new String(raw, StandardCharsets.ISO_8859_1);
    }
}
