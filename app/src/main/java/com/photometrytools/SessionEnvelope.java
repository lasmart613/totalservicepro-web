package com.photometrytools;

import java.security.GeneralSecurityException;
import java.util.Arrays;

import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/**
 * Envelope for a biometric session. A random AES data key encrypts the
 * refresh-token JSON. That data key is what the per-use biometric key wraps.
 * While the app is unlocked the data key stays in memory, so a rotation can
 * re-encrypt without another prompt. Invalidation destroys the ciphertext.
 * A plaintext copy is never read.
 */
public final class SessionEnvelope {
    private static final byte PACKED_MARK = 1;
    private static final int DK_LEN = 32;

    private SessionEnvelope() {}

    public static SecretKey newDataKey() throws GeneralSecurityException {
        KeyGenerator gen = KeyGenerator.getInstance("AES");
        gen.init(256);
        return gen.generateKey();
    }

    /** One marker byte plus the raw AES key. This is what the biometric cipher wraps. */
    public static byte[] packDataKey(SecretKey key) throws GeneralSecurityException {
        byte[] raw = key == null ? null : key.getEncoded();
        if (raw == null || raw.length != DK_LEN) throw new GeneralSecurityException("missing data key");
        byte[] packed = new byte[DK_LEN + 1];
        packed[0] = PACKED_MARK;
        System.arraycopy(raw, 0, packed, 1, DK_LEN);
        return packed;
    }

    /** Null when the blob is not a packed data key. */
    public static SecretKey unpackDataKey(byte[] packed) {
        if (packed == null || packed.length != DK_LEN + 1 || packed[0] != PACKED_MARK) return null;
        byte[] raw = new byte[DK_LEN];
        System.arraycopy(packed, 1, raw, 0, DK_LEN);
        return new SecretKeySpec(raw, "AES");
    }

    public static byte[] seal(SecretKey dataKey, String json) throws GeneralSecurityException {
        if (json == null || json.isEmpty()) throw new GeneralSecurityException("missing session");
        return SessionSealed.seal(dataKey, json.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    public static String open(SecretKey dataKey, byte[] sealed) throws GeneralSecurityException {
        byte[] plain = SessionSealed.open(dataKey, sealed);
        if (plain == null || plain.length == 0) return null;
        String json = new String(plain, java.nio.charset.StandardCharsets.UTF_8);
        return json.isEmpty() ? null : json;
    }

    /**
     * In-memory holder. The data key is required for {@link #session()} and
     * {@link #rotate(String)}. {@link #invalidate()} drops the ciphertext so a
     * lost biometric key cannot fall back to a plaintext session.
     */
    public static final class Lock {
        private SecretKey dataKey;
        private byte[] ciphertext;
        private boolean invalidated;

        private Lock() {}

        public static Lock sealNew(String json) throws GeneralSecurityException {
            SecretKey key = newDataKey();
            Lock lock = new Lock();
            lock.dataKey = key;
            lock.ciphertext = seal(key, json);
            return lock;
        }

        public static Lock restore(byte[] ciphertext, SecretKey dataKey) {
            Lock lock = new Lock();
            lock.ciphertext = copy(ciphertext);
            lock.dataKey = dataKey;
            return lock;
        }

        public static Lock locked(byte[] ciphertext) {
            return restore(ciphertext, null);
        }

        public boolean isLocked() {
            return invalidated || dataKey == null;
        }

        public boolean isInvalidated() {
            return invalidated;
        }

        public byte[] ciphertext() {
            if (invalidated) return null;
            return copy(ciphertext);
        }

        public byte[] exportPackedDataKey() throws GeneralSecurityException {
            if (invalidated || dataKey == null) throw new GeneralSecurityException("locked");
            return packDataKey(dataKey);
        }

        public String session() {
            if (invalidated || dataKey == null || ciphertext == null) return null;
            try {
                return open(dataKey, ciphertext);
            } catch (GeneralSecurityException e) {
                return null;
            }
        }

        /**
         * Re-encrypt with the in-memory data key. Null when the key was dropped
         * or the lock was invalidated. Does not accept a plaintext fallback.
         */
        public String rotate(String json) {
            if (invalidated || dataKey == null) return null;
            if (json == null || json.isEmpty()) return null;
            try {
                ciphertext = seal(dataKey, json);
                return json;
            } catch (GeneralSecurityException e) {
                return null;
            }
        }

        public void dropDataKey() {
            dataKey = null;
        }

        /** Forget the ciphertext. Later unlock and rotate stay empty. */
        public void invalidate() {
            invalidated = true;
            dataKey = null;
            ciphertext = null;
        }

        /**
         * Install {@code dataKey} and open the ciphertext. {@code plainCopy} is
         * ignored: a non-auth copy is not a fallback.
         */
        public String recover(SecretKey key, String plainCopy) {
            if (invalidated || key == null || ciphertext == null) return null;
            try {
                String json = open(key, ciphertext);
                if (json == null || json.isEmpty()) return null;
                dataKey = key;
                return json;
            } catch (GeneralSecurityException e) {
                return null;
            }
        }
    }

    private static byte[] copy(byte[] raw) {
        if (raw == null) return null;
        return Arrays.copyOf(raw, raw.length);
    }
}
