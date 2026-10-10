// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only

package org.openoceanacoustic.mobile;

import android.content.Context;
import android.annotation.SuppressLint;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Session cookies never enter WebView storage or JavaScript. */
@SuppressLint("ApplySharedPref") // Worker-thread commits finish before login/logout is reported to JavaScript.
final class SessionVault {
    private static final String KEY_ALIAS = "ooa.android.sessions.v1";
    private final SharedPreferences preferences;
    private final Map<String, CookieSession> sessions = new HashMap<>();
    SessionVault(Context context) {
        preferences = context.getSharedPreferences("native_sessions_v1", Context.MODE_PRIVATE);
    }

    synchronized CookieSession get(String server) throws Exception {
        String origin = OriginPolicy.origin(server);
        CookieSession existing = sessions.get(origin);
        if (existing != null) return existing;
        CookieSession result = new CookieSession();
        String encrypted = preferences.getString(storageKey(origin), null);
        if (encrypted != null) {
            try {
                byte[] packed = Base64.decode(encrypted, Base64.NO_WRAP);
                if (packed.length < 29) throw new IllegalArgumentException("Invalid session");
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, packed, 0, 12));
                cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
                result = CookieSession.restore(cipher.doFinal(packed, 12, packed.length - 12));
            } catch (Exception invalid) {
                preferences.edit().remove(storageKey(origin)).commit();
            }
        }
        sessions.put(origin, result);
        return result;
    }

    synchronized void save(String server) throws Exception {
        String origin = OriginPolicy.origin(server);
        CookieSession session = sessions.get(origin);
        if (session == null) return;
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
        byte[] ciphertext = cipher.doFinal(session.snapshot());
        byte[] packed = new byte[cipher.getIV().length + ciphertext.length];
        System.arraycopy(cipher.getIV(), 0, packed, 0, cipher.getIV().length);
        System.arraycopy(ciphertext, 0, packed, cipher.getIV().length, ciphertext.length);
        if (!preferences.edit().putString(storageKey(origin), Base64.encodeToString(packed, Base64.NO_WRAP)).commit()) {
            throw new IllegalStateException("无法保存登录状态");
        }
    }

    synchronized void clear(String server) throws Exception {
        if (server == null) {
            for (CookieSession session : sessions.values()) session.clear();
            sessions.clear();
            if (!preferences.edit().clear().commit()) throw new IllegalStateException("无法清除登录状态");
        } else {
            String origin = OriginPolicy.origin(server);
            CookieSession removed = sessions.remove(origin);
            if (removed != null) removed.clear();
            if (!preferences.edit().remove(storageKey(origin)).commit()) throw new IllegalStateException("无法清除登录状态");
        }
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }

    private String storageKey(String origin) throws Exception {
        return Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(origin.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
    }
}
