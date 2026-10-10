// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only
package org.openoceanacoustic.mobile;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Opt-in isolated backend: fixtures are copied only into the isolated target app's private directory. */
@RunWith(AndroidJUnit4.class)
public class NativeBackendInstrumentedTest {
    private static JSONObject object(NativeHttp.Result response) throws Exception {
        return new JSONObject(new String(response.body, StandardCharsets.UTF_8));
    }
    private static NativeHttp.Body json(JSONObject value) {
        byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        return new NativeHttp.Body() {
            public long contentLength() { return bytes.length; }
            public void write(OutputStream output) throws IOException { output.write(bytes); }
        };
    }
    private static String code(String secret) throws Exception {
        ByteArrayOutputStream decoded = new ByteArrayOutputStream();
        int bits = 0, buffer = 0;
        for (char ch : secret.toUpperCase(Locale.ROOT).toCharArray()) {
            int value = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch);
            if (value < 0) continue;
            buffer = (buffer << 5) | value;
            bits += 5;
            if (bits >= 8) { bits -= 8; decoded.write((buffer >> bits) & 255); }
        }
        byte[] counter = new byte[8];
        long time = System.currentTimeMillis() / 30000;
        for (int i = 7; i >= 0; i--) { counter[i] = (byte) time; time >>= 8; }
        Mac mac = Mac.getInstance("HmacSHA1");
        mac.init(new SecretKeySpec(decoded.toByteArray(), "HmacSHA1"));
        byte[] hash = mac.doFinal(counter);
        int offset = hash[hash.length - 1] & 15;
        int number = ((hash[offset] & 127) << 24) | ((hash[offset + 1] & 255) << 16) | ((hash[offset + 2] & 255) << 8) | (hash[offset + 3] & 255);
        return String.format(Locale.ROOT, "%06d", number % 1000000);
    }

    @Test public void realMobileLoginRestoresSessionSynchronizesProfileAndRejectsExport() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File fixture = new File(context.getFilesDir(), "native-test-fixture.json");
        Assume.assumeTrue("Run tools/mobile/run-device-checks.py with an isolated backend fixture", fixture.isFile());
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InputStream input = new FileInputStream(fixture)) { byte[] part = new byte[4096]; int read; while ((read = input.read(part)) >= 0) bytes.write(part, 0, read); }
        JSONObject config = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        String server = config.getString("emulator_server");
        JSONObject account = config.getJSONObject("accounts").getJSONObject("member");
        SessionVault vault = new SessionVault(context);
        vault.clear(server);
        try {
            CookieSession cookies = vault.get(server);
            String csrf = object(NativeHttp.execute(server, "/auth/get-csrf-token/", "GET", Collections.emptyMap(), null, cookies, false, null)).getString("csrf_token");
            Map<String, String> headers = new HashMap<>(); headers.put("Content-Type", "application/json"); headers.put("X-CSRFToken", csrf);
            JSONObject credentials = new JSONObject().put("username", account.getString("username")).put("code", code(account.getString("totp_secret")));
            assertEquals(200, NativeHttp.execute(server, "/auth/lab/mobile/sign-in/", "POST", headers, json(credentials), cookies, false, null).status);
            vault.save(server);
            SessionVault restored = new SessionVault(context);
            CookieSession resumed = restored.get(server);
            NativeHttp.Result session = NativeHttp.execute(server, "/api/lab/session/", "GET", Collections.emptyMap(), null, resumed, false, null);
            assertEquals(200, session.status);
            assertEquals("android", object(session).getString("client_platform"));
            assertFalse(object(session).getJSONObject("capabilities").getBoolean("data_export"));
            String projects = "/api/workspaces/" + config.getString("workspace_slug") + "/projects/";
            assertEquals(200, NativeHttp.execute(server, projects, "GET", Collections.emptyMap(), null, resumed, false, null).status);
            JSONObject user = object(NativeHttp.execute(server, "/api/users/me/", "GET", Collections.emptyMap(), null, resumed, false, null));
            String previous = user.optString("first_name", "");
            csrf = object(NativeHttp.execute(server, "/auth/get-csrf-token/", "GET", Collections.emptyMap(), null, resumed, false, null)).getString("csrf_token");
            headers.put("X-CSRFToken", csrf);
            try {
                assertEquals(200, NativeHttp.execute(server, "/api/users/me/", "PATCH", headers, json(new JSONObject().put("first_name", "Android integration")), resumed, false, null).status);
                assertEquals("Android integration", object(NativeHttp.execute(server, "/api/users/me/", "GET", Collections.emptyMap(), null, resumed, false, null)).getString("first_name"));
            } finally { NativeHttp.execute(server, "/api/users/me/", "PATCH", headers, json(new JSONObject().put("first_name", previous)), resumed, false, null); }
            String export = "/api/workspaces/" + config.getString("workspace_slug") + "/user-activity/" + account.getString("user_id") + "/export/";
            assertEquals(403, NativeHttp.execute(server, export, "GET", Collections.emptyMap(), null, resumed, false, null).status);
            CookieSession replay = new CookieSession();
            String replayCsrf = object(NativeHttp.execute(server, "/auth/get-csrf-token/", "GET", Collections.emptyMap(), null, replay, false, null)).getString("csrf_token");
            headers.put("X-CSRFToken", replayCsrf);
            assertEquals(401, NativeHttp.execute(server, "/auth/lab/mobile/sign-in/", "POST", headers, json(credentials), replay, false, null).status);
            assertEquals("", new SessionVault(context).get("https://other.invalid").header(URI.create("https://other.invalid/")));
            restored.clear(server);
            assertEquals(401, NativeHttp.execute(server, "/api/lab/session/", "GET", Collections.emptyMap(), null, new SessionVault(context).get(server), false, null).status);
        } finally { vault.clear(server); fixture.delete(); }
    }
}
