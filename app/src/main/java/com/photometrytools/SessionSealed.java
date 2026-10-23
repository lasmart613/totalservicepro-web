package com.photometrytools;

import java.security.GeneralSecurityException;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** AES-GCM blob: 12-byte IV followed by ciphertext and tag. */
public final class SessionSealed {
    private static final int IV_LEN = 12;
    private static final int TAG_BITS = 128;

    private SessionSealed() {}

    public static byte[] seal(SecretKey key, byte[] plain) throws GeneralSecurityException {
        if (key == null || plain == null) throw new GeneralSecurityException("missing session");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != IV_LEN) throw new GeneralSecurityException("unexpected iv");
        byte[] enc = cipher.doFinal(plain);
        byte[] out = new byte[iv.length + enc.length];
        System.arraycopy(iv, 0, out, 0, iv.length);
        System.arraycopy(enc, 0, out, iv.length, enc.length);
        return out;
    }

    public static byte[] open(SecretKey key, byte[] sealed) throws GeneralSecurityException {
        if (key == null || sealed == null || sealed.length <= IV_LEN) {
            throw new GeneralSecurityException("missing session");
        }
        byte[] iv = new byte[IV_LEN];
        byte[] enc = new byte[sealed.length - IV_LEN];
        System.arraycopy(sealed, 0, iv, 0, IV_LEN);
        System.arraycopy(sealed, IV_LEN, enc, 0, enc.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        return cipher.doFinal(enc);
    }
}
