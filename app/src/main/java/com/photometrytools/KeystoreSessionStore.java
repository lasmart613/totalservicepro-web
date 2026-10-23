package com.photometrytools;

import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.UserNotAuthenticatedException;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Session ciphertext in TSPPrefs, keys in Android Keystore.
 * With biometrics off, {@code tsp_session_v1} holds the session and does not
 * prompt. With biometrics on, that copy is deleted. The session is encrypted
 * with a random data key, and only the data key is wrapped by
 * {@code tsp_session_bio_v1} through a {@code BiometricPrompt} CryptoObject.
 * Device credential cannot be combined with a CryptoObject, so this key is
 * {@code AUTH_BIOMETRIC_STRONG} with a timeout of 0 (per-use on older APIs:
 * validity -1). A lost or invalidated biometric key has no plaintext fallback.
 */
public final class KeystoreSessionStore {
    static final String PREF_PLAIN = "session_sealed";
    static final String PREF_BIO = "session_bio_sealed";
    static final String PREF_ENVELOPE = "session_envelope";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_PLAIN = "tsp_session_v1";
    private static final String KEY_BIO = "tsp_session_bio_v1";
    private static final int IV_LEN = 12;
    private static final int TAG_BITS = 128;

    private final SharedPreferences prefs;
    private byte[] pendingDecryptBody;

    public KeystoreSessionStore(SharedPreferences prefs) {
        this.prefs = prefs;
    }

    public static final class Prepared {
        public final Cipher cipher;
        public final boolean needsAuth;
        public final boolean invalidated;

        Prepared(Cipher cipher, boolean needsAuth, boolean invalidated) {
            this.cipher = cipher;
            this.needsAuth = needsAuth;
            this.invalidated = invalidated;
        }

        static Prepared ready(Cipher cipher, boolean needsAuth) {
            return new Prepared(cipher, needsAuth, false);
        }

        static Prepared invalidated() {
            return new Prepared(null, false, true);
        }
    }

    public String readPlain() {
        String raw = prefs.getString(PREF_PLAIN, null);
        if (raw == null || raw.isEmpty()) return null;
        SecretKey key = plainKey();
        if (key == null) {
            prefs.edit().remove(PREF_PLAIN).apply();
            return null;
        }
        try {
            byte[] sealed = Base64.decode(raw, Base64.NO_WRAP);
            byte[] plain = SessionSealed.open(key, sealed);
            String text = new String(plain, StandardCharsets.UTF_8);
            return text.isEmpty() ? null : text;
        } catch (Exception e) {
            prefs.edit().remove(PREF_PLAIN).apply();
            return null;
        }
    }

    public boolean writePlain(String json) {
        if (json == null || json.isEmpty()) {
            clearPlain();
            return true;
        }
        SecretKey key = plainKey();
        if (key == null) {
            prefs.edit().remove(PREF_PLAIN).apply();
            return false;
        }
        try {
            byte[] sealed = SessionSealed.seal(key, json.getBytes(StandardCharsets.UTF_8));
            prefs.edit().putString(PREF_PLAIN, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public void clearPlain() {
        prefs.edit().remove(PREF_PLAIN).apply();
        deleteKey(KEY_PLAIN);
    }

    public boolean hasEnvelope() {
        byte[] raw = readEnvelope();
        return raw != null && raw.length > 0;
    }

    /** Session sealed with the in-memory data key. Not readable by tsp_session_v1. */
    public byte[] readEnvelope() {
        String raw = prefs.getString(PREF_ENVELOPE, null);
        if (raw == null || raw.isEmpty()) return null;
        try {
            byte[] decoded = Base64.decode(raw, Base64.NO_WRAP);
            return decoded.length == 0 ? null : decoded;
        } catch (IllegalArgumentException e) {
            prefs.edit().remove(PREF_ENVELOPE).apply();
            return null;
        }
    }

    /** Stores the data-key ciphertext and deletes the non-auth copy. */
    public void writeEnvelope(byte[] sealed) {
        if (sealed == null || sealed.length == 0) {
            clearEnvelope();
            return;
        }
        prefs.edit()
                .putString(PREF_ENVELOPE, Base64.encodeToString(sealed, Base64.NO_WRAP))
                .remove(PREF_PLAIN)
                .remove("storedSession")
                .apply();
        deleteKey(KEY_PLAIN);
    }

    public void clearEnvelope() {
        prefs.edit().remove(PREF_ENVELOPE).apply();
    }

    public boolean hasBiometric() {
        String raw = prefs.getString(PREF_BIO, "");
        return raw != null && !raw.isEmpty();
    }

    public void clearBiometric() {
        pendingDecryptBody = null;
        prefs.edit().remove(PREF_BIO).apply();
        deleteKey(KEY_BIO);
    }

    public void clearAll() {
        pendingDecryptBody = null;
        prefs.edit().remove(PREF_PLAIN).remove(PREF_BIO).remove(PREF_ENVELOPE).remove("storedSession").apply();
        deleteKey(KEY_PLAIN);
        deleteKey(KEY_BIO);
    }

    /** Cipher for sealing the session. Null when the key cannot be created. */
    public Prepared prepareEncrypt() {
        SecretKey key = bioKey(true);
        if (key == null) return null;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            try {
                cipher.init(Cipher.ENCRYPT_MODE, key);
                return Prepared.ready(cipher, false);
            } catch (UserNotAuthenticatedException expected) {
                return Prepared.ready(cipher, true);
            }
        } catch (KeyPermanentlyInvalidatedException e) {
            return Prepared.invalidated();
        } catch (Exception e) {
            return null;
        }
    }

    /** Cipher for opening the biometric blob. Null when there is nothing to open. */
    public Prepared prepareDecrypt() {
        pendingDecryptBody = null;
        String raw = prefs.getString(PREF_BIO, null);
        if (raw == null || raw.isEmpty()) return null;
        SecretKey key = bioKey(false);
        if (key == null) {
            return Prepared.invalidated();
        }
        try {
            byte[] sealed = Base64.decode(raw, Base64.NO_WRAP);
            byte[] iv = SessionSealed.ivOf(sealed);
            pendingDecryptBody = SessionSealed.bodyOf(sealed);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            try {
                cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
                return Prepared.ready(cipher, false);
            } catch (UserNotAuthenticatedException expected) {
                return Prepared.ready(cipher, true);
            }
        } catch (KeyPermanentlyInvalidatedException e) {
            return Prepared.invalidated();
        } catch (Exception e) {
            pendingDecryptBody = null;
            return Prepared.invalidated();
        }
    }

    /** Wraps the packed data key. The refresh token is not passed to this cipher. */
    public boolean finishEncrypt(Cipher cipher, byte[] packedKey) {
        if (cipher == null || packedKey == null || packedKey.length == 0) return false;
        try {
            byte[] enc = cipher.doFinal(packedKey);
            byte[] iv = cipher.getIV();
            if (iv == null || iv.length != IV_LEN) return false;
            byte[] packed = SessionSealed.join(iv, enc);
            prefs.edit().putString(PREF_BIO, Base64.encodeToString(packed, Base64.NO_WRAP)).apply();
            return true;
        } catch (Exception e) {
            if (e instanceof KeyPermanentlyInvalidatedException) clearBiometric();
            return false;
        }
    }

    public byte[] finishDecrypt(Cipher cipher) {
        byte[] body = pendingDecryptBody;
        pendingDecryptBody = null;
        if (cipher == null || body == null) return null;
        try {
            byte[] plain = cipher.doFinal(body);
            return plain == null || plain.length == 0 ? null : plain;
        } catch (Exception e) {
            if (e instanceof KeyPermanentlyInvalidatedException) clearBiometric();
            return null;
        }
    }

    private SecretKey plainKey() {
        return key(KEY_PLAIN, false, true);
    }

    private SecretKey bioKey(boolean create) {
        return key(KEY_BIO, true, create);
    }

    private SecretKey key(String alias, boolean userAuth, boolean create) {
        try {
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            if (ks.containsAlias(alias)) {
                KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) ks.getEntry(alias, null);
                if (entry != null && entry.getSecretKey() != null) return entry.getSecretKey();
            }
            if (!create) return null;
            KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
            KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
                    alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256);
            if (userAuth) {
                spec.setUserAuthenticationRequired(true);
                spec.setInvalidatedByBiometricEnrollment(true);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
                } else {
                    spec.setUserAuthenticationValidityDurationSeconds(-1);
                }
            }
            gen.init(spec.build());
            return gen.generateKey();
        } catch (Exception e) {
            return null;
        }
    }

    private void deleteKey(String alias) {
        try {
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);
        } catch (Exception ignored) {
        }
    }
}
