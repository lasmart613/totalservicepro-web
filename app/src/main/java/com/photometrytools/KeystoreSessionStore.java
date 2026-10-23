package com.photometrytools;

import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/**
 * Session ciphertext in TSPPrefs, keys in Android Keystore.
 * The plain key does not ask the user. The biometric key requires unlock and
 * stays usable for {@link SessionTokens#KEY_AUTH_VALIDITY_SECONDS} after that.
 */
public final class KeystoreSessionStore {
    static final String PREF_PLAIN = "session_sealed";
    static final String PREF_BIO = "session_bio_sealed";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_PLAIN = "tsp_session_v1";
    private static final String KEY_BIO = "tsp_session_bio_v1";

    private final SharedPreferences prefs;

    public KeystoreSessionStore(SharedPreferences prefs) {
        this.prefs = prefs;
    }

    public String readPlain() {
        return unseal(PREF_PLAIN, plainKey());
    }

    public boolean writePlain(String json) {
        if (json == null || json.isEmpty()) {
            clearPlain();
            return true;
        }
        return seal(PREF_PLAIN, plainKey(), json);
    }

    public void clearPlain() {
        prefs.edit().remove(PREF_PLAIN).apply();
    }

    public boolean hasBiometric() {
        String raw = prefs.getString(PREF_BIO, "");
        return raw != null && !raw.isEmpty();
    }

    public String readBiometric() {
        return unseal(PREF_BIO, bioKey(false));
    }

    public boolean writeBiometric(String json) {
        if (json == null || json.isEmpty()) {
            clearBiometric();
            return true;
        }
        return seal(PREF_BIO, bioKey(true), json);
    }

    public void clearBiometric() {
        prefs.edit().remove(PREF_BIO).apply();
        deleteKey(KEY_BIO);
    }

    public void clearAll() {
        prefs.edit().remove(PREF_PLAIN).remove(PREF_BIO).remove("storedSession").apply();
        deleteKey(KEY_PLAIN);
        deleteKey(KEY_BIO);
    }

    private String unseal(String pref, SecretKey key) {
        if (key == null) return null;
        String raw = prefs.getString(pref, null);
        if (raw == null || raw.isEmpty()) return null;
        try {
            byte[] sealed = Base64.decode(raw, Base64.NO_WRAP);
            byte[] plain = SessionSealed.open(key, sealed);
            String text = new String(plain, StandardCharsets.UTF_8);
            return text.isEmpty() ? null : text;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean seal(String pref, SecretKey key, String json) {
        if (key == null) return false;
        try {
            byte[] sealed = SessionSealed.seal(key, json.getBytes(StandardCharsets.UTF_8));
            prefs.edit().putString(pref, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply();
            return true;
        } catch (Exception e) {
            return false;
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
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    spec.setUserAuthenticationParameters(
                            SessionTokens.KEY_AUTH_VALIDITY_SECONDS,
                            KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
                } else {
                    spec.setUserAuthenticationValidityDurationSeconds(SessionTokens.KEY_AUTH_VALIDITY_SECONDS);
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
