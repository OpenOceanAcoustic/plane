// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only
package org.openoceanacoustic.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Opt-in UI acceptance against the installed APK and an isolated real backend. */
@RunWith(AndroidJUnit4.class)
public class NativeUiInstrumentedTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView webView;
    private MainActivity activeActivity;
    private long deadline;

    // Values and credentials are never returned from JavaScript or included in assertions.
    private static final String DOM =
        "const shown=e=>!!e&&e.getClientRects().length>0;" +
        "const button=(text,root=document)=>Array.from(root.querySelectorAll('button')).find(" +
        "e=>shown(e)&&(e.getAttribute('aria-label')||e.textContent).trim()===text);" +
        "const field=(text,root=document)=>Array.from(root.querySelectorAll('input,textarea,select')).find(" +
        "e=>e.getAttribute('aria-label')===text)||Array.from(root.querySelectorAll('label')).find(" +
        "e=>Array.from(e.querySelectorAll('span')).some(s=>s.textContent.trim()===text))?.querySelector('input,textarea,select');" +
        "const heading=text=>Array.from(document.querySelectorAll('h1,h2')).some(e=>shown(e)&&e.textContent.trim()===text);";

    private long remaining(String step) {
        long milliseconds = deadline - SystemClock.elapsedRealtime();
        assertTrue("Native UI timed out at: " + step, milliseconds > 0);
        return milliseconds;
    }

    private boolean evaluate(String expression, String step) throws Exception {
        CountDownLatch resultReady = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        String script = "(()=>{try{" + DOM + "return Boolean(" + expression + ");}catch(_){return false;}})()";
        main.post(() -> webView.evaluateJavascript(script, value -> {
            result.set(value);
            resultReady.countDown();
        }));
        // A stalled renderer/main thread cannot keep an instrumentation callback pending forever.
        assertTrue("WebView callback timed out at: " + step,
            resultReady.await(Math.min(60000, remaining(step)), TimeUnit.MILLISECONDS));
        return "true".equals(result.get());
    }

    private void status(String step) {
        Bundle progress = new Bundle();
        progress.putString("native_ui_step", step);
        instrumentation.sendStatus(0, progress);
    }

    private void waitForDom(String expression, String step) throws Exception {
        status(step);
        while (!evaluate(expression, step)) {
            SystemClock.sleep(Math.min(500, remaining(step)));
        }
    }

    private void click(String name, String root, String step) throws Exception {
        waitForDom("(()=>{const e=button(" + JSONObject.quote(name) + "," + root + ");" +
            "if(!e||e.disabled)return false;e.scrollIntoView({block:'center'});" +
            "if(e.form&&e.type==='submit')e.form.requestSubmit(e);else e.click();return true;})()", step);
    }

    private void fill(String label, String value, String root, String step) throws Exception {
        waitForDom("(()=>{const e=field(" + JSONObject.quote(label) + "," + root + ");" +
            "if(!shown(e)||e.disabled)return false;e.scrollIntoView({block:'center'});" +
            "const prototype=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;" +
            "Object.getOwnPropertyDescriptor(prototype,'value').set.call(e," + JSONObject.quote(value) + ");" +
            "e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));" +
            "return true;})()", step);
    }

    private void home(String step) throws Exception {
        click("首页", "document.querySelector('.bottom-dock')", step);
        waitForDom("!!button('工作',document.querySelector('main'))", step);
    }

    private void nativeBack(String step) throws Exception {
        CountDownLatch dispatched = new CountDownLatch(1);
        main.post(() -> {
            activeActivity.getOnBackPressedDispatcher().onBackPressed();
            dispatched.countDown();
        });
        assertTrue("Native back dispatch timed out", dispatched.await(Math.min(60000, remaining(step)), TimeUnit.MILLISECONDS));
    }

    private String userAgent() throws Exception {
        CountDownLatch ready = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        main.post(() -> {
            value.set(webView.getSettings().getUserAgentString());
            ready.countDown();
        });
        assertTrue("WebView version callback timed out", ready.await(Math.min(60000, remaining("WebView version")), TimeUnit.MILLISECONDS));
        return value.get();
    }

    private static String accessibilityText(AccessibilityNodeInfo node) {
        if (node == null) return "";
        StringBuilder text = new StringBuilder();
        if (node.getText() != null) text.append(node.getText()).append('\n');
        for (int i = 0; i < node.getChildCount(); i++) text.append(accessibilityText(node.getChild(i)));
        return text.toString();
    }

    private static boolean clickSystemWait(AccessibilityNodeInfo node) {
        if (node == null) return false;
        CharSequence text = node.getText();
        if (text != null && ("Wait".contentEquals(text) || "等待".contentEquals(text)))
            return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        for (int i = 0; i < node.getChildCount(); i++) if (clickSystemWait(node.getChild(i))) return true;
        return false;
    }

    private void dismissSystemUiWait() {
        AccessibilityNodeInfo root = instrumentation.getUiAutomation().getRootInActiveWindow();
        String text = accessibilityText(root);
        // TCG can trigger a System UI watchdog dialog. Never dismiss an application ANR.
        if ((text.contains("System UI") || text.contains("系统界面")) &&
            (text.contains("isn't responding") || text.contains("无响应") || text.contains("没有响应")))
            clickSystemWait(root);
    }

    private void screenshot(Context context, String name) throws Exception {
        // Capture only authenticated home screens, never filled login forms.
        waitForDom("!!button('工作',document.querySelector('main'))", "authenticated screenshot");
        dismissSystemUiWait();
        SystemClock.sleep(Math.min(1000, remaining("authenticated screenshot")));
        Bitmap bitmap = instrumentation.getUiAutomation().takeScreenshot();
        if (bitmap == null) return;
        try {
            File directory = context.getExternalFilesDir("native-ui-evidence");
            if (directory == null || (!directory.isDirectory() && !directory.mkdirs())) return;
            try (OutputStream output = new FileOutputStream(new File(directory, name + ".png"))) {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
            }
        } finally {
            bitmap.recycle();
        }
    }

    private static JSONObject readFixture(File fixture) throws Exception {
        try (InputStream input = new FileInputStream(fixture); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[4096];
            int count;
            while ((count = input.read(chunk)) != -1) {
                bytes.write(chunk, 0, count);
                assertTrue("Native UI fixture is too large", bytes.size() <= 1024 * 1024);
            }
            return new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception invalid) {
            throw new AssertionError("Native UI fixture could not be read");
        }
    }

    private static String code(String secret) throws Exception {
        ByteArrayOutputStream decoded = new ByteArrayOutputStream();
        int bits = 0;
        int buffer = 0;
        for (char ch : secret.toUpperCase(Locale.ROOT).toCharArray()) {
            int value = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch);
            if (value < 0) continue;
            buffer = (buffer << 5) | value;
            bits += 5;
            if (bits >= 8) {
                bits -= 8;
                decoded.write((buffer >> bits) & 255);
            }
        }
        byte[] counter = new byte[8];
        long time = System.currentTimeMillis() / 30000;
        for (int i = 7; i >= 0; i--) {
            counter[i] = (byte) time;
            time >>= 8;
        }
        Mac mac = Mac.getInstance("HmacSHA1");
        mac.init(new SecretKeySpec(decoded.toByteArray(), "HmacSHA1"));
        byte[] hash = mac.doFinal(counter);
        int offset = hash[hash.length - 1] & 15;
        int number = ((hash[offset] & 127) << 24) | ((hash[offset + 1] & 255) << 16) |
            ((hash[offset + 2] & 255) << 8) | (hash[offset + 3] & 255);
        return String.format(Locale.ROOT, "%06d", number % 1000000);
    }

    private static NativeHttp.Result read(Context context, String server, String path) throws Exception {
        CookieSession cookies = new SessionVault(context).get(server);
        return NativeHttp.execute(server, path, "GET", Collections.emptyMap(), null, cookies, false, null);
    }

    private static JSONObject object(NativeHttp.Result response, String step) throws Exception {
        assertEquals("Native API failed at: " + step, 200, response.status);
        try {
            return new JSONObject(new String(response.body, StandardCharsets.UTF_8));
        } catch (Exception invalid) {
            throw new AssertionError("Native API response is invalid at: " + step);
        }
    }

    private static JSONObject project(NativeHttp.Result response, String projectId) throws Exception {
        assertEquals("Native API project list failed", 200, response.status);
        try {
            JSONArray rows = new JSONArray(new String(response.body, StandardCharsets.UTF_8));
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.getJSONObject(i);
                if (projectId.equals(row.optString("id"))) return row;
            }
        } catch (Exception invalid) {
            throw new AssertionError("Native API project list is invalid");
        }
        throw new AssertionError("Isolated project is not accessible to native UI account");
    }

    private static void restoreProfile(Context context, String server, String previous) throws Exception {
        CookieSession cookies = new SessionVault(context).get(server);
        JSONObject csrf = object(NativeHttp.execute(server, "/auth/get-csrf-token/", "GET", Collections.emptyMap(),
            null, cookies, false, null), "profile cleanup CSRF");
        byte[] bytes = new JSONObject().put("first_name", previous).toString().getBytes(StandardCharsets.UTF_8);
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "application/json");
        headers.put("X-CSRFToken", csrf.getString("csrf_token"));
        NativeHttp.Body body = new NativeHttp.Body() {
            @Override public long contentLength() { return bytes.length; }
            @Override public void write(OutputStream output) throws java.io.IOException { output.write(bytes); }
        };
        assertEquals("Isolated profile cleanup failed", 200,
            NativeHttp.execute(server, "/api/users/me/", "PATCH", headers, body, cookies, false, null).status);
    }

    @Test public void actualApkUiSignsInOpensTaskWritesProfileAndAppliesTheme() throws Exception {
        Context context = instrumentation.getTargetContext();
        File fixture = new File(context.getFilesDir(), "native-ui-fixture.json");
        Assume.assumeTrue("Native UI acceptance requires a private isolated fixture", fixture.isFile());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PackageInfo installed = WebView.getCurrentWebViewPackage();
            Assume.assumeTrue("Native UI acceptance requires WebView 95 or newer",
                installed != null && Integer.parseInt(installed.versionName.split("\\.")[0]) >= 95);
        }
        JSONObject config = readFixture(fixture);
        JSONObject account = config.getJSONObject("accounts").getJSONObject("independent");
        String server = config.getString("emulator_server");
        int timeoutSeconds = Integer.parseInt(InstrumentationRegistry.getArguments().getString("timeoutSeconds", "600"));
        assertTrue("Invalid native UI timeout", timeoutSeconds >= 60 && timeoutSeconds <= 1800);
        deadline = SystemClock.elapsedRealtime() + timeoutSeconds * 1000L;
        new SessionVault(context).clear(server);

        MainActivity activity = null;
        String previous = null;
        boolean profileChanged = false;
        try {
            Intent intent = new Intent(context, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            dismissSystemUiWait();
            status("launch MainActivity");
            activity = (MainActivity) instrumentation.startActivitySync(intent);
            activeActivity = activity;
            webView = activity.getBridge().getWebView();
            status("MainActivity ready");
            String userAgent = userAgent();
            java.util.regex.Matcher version = java.util.regex.Pattern.compile("Chrome/(\\d+)").matcher(userAgent);
            Assume.assumeTrue("Native UI acceptance requires WebView 95 or newer",
                version.find() && Integer.parseInt(version.group(1)) >= 95);
            waitForDom("document.getElementById('root')?.children.length>0", "React cold boot");
            // One reset/reload only, after the Capacitor frontend has actually booted.
            assertTrue("Could not reset native UI test preferences",
                evaluate("(()=>{localStorage.clear();setTimeout(()=>location.reload(),0);return true;})()", "test preferences reset"));
            waitForDom("heading('连接服务器')&&!!field('服务器地址')", "server setup");
            fill("服务器地址", server, "document", "server address");
            click("连接", "document", "connect isolated server");
            waitForDom("heading('登录工作区')&&!!field('用户名')&&!!field('六位动态码')", "login form");
            fill("用户名", account.getString("username"), "document", "ordinary account input");
            fill("六位动态码", code(account.getString("totp_secret")), "document", "dynamic code input");
            click("登录", "document", "ordinary account submit");
            waitForDom("!!button('工作',document.querySelector('main'))", "real authenticated home");

            JSONObject session = object(read(context, server, "/api/lab/session/"), "session after UI login");
            assertTrue("UI authenticated a different fixture account",
                account.getString("user_id").equals(session.getJSONObject("user").getString("id")));
            assertTrue("UI login did not create an Android session", "android".equals(session.getString("client_platform")));
            assertTrue("Android session unexpectedly permits export", !session.getJSONObject("capabilities").getBoolean("data_export"));
            previous = object(read(context, server, "/api/users/me/"), "profile before UI edit").optString("first_name", "");

            click("个人设置", "document.querySelector('.topbar')", "open personal settings");
            waitForDom("heading('个人设置')&&!!button('浅色')", "personal preferences");
            click("浅色", "document", "apply light theme");
            waitForDom("document.documentElement.dataset.theme==='light'", "light theme");
            home("home in light theme");
            screenshot(context, "home-light");

            String projectId = config.getString("project_id");
            String base = "/api/workspaces/" + config.getString("workspace_slug") + "/projects/";
            JSONObject selectedProject = project(read(context, server, base), projectId);
            JSONObject issue = object(read(context, server, base + projectId + "/issues/" + config.getString("issue_id") + "/"), "fixture task");
            click("项目", "document.querySelector('main')", "open projects");
            click(selectedProject.getString("name"), "document.querySelector('main')", "open project tasks");
            waitForDom("heading(" + JSONObject.quote(selectedProject.getString("name")) + ")", "project task view");
            click(issue.getString("name"), "document.querySelector('main')", "open task detail");
            waitForDom("heading(" + JSONObject.quote(issue.getString("name")) + ")", "real task detail");
            nativeBack("native back from task detail");
            waitForDom("heading(" + JSONObject.quote(selectedProject.getString("name")) + ")", "native back restores project task view");

            click("个人设置", "document.querySelector('.topbar')", "open profile for write");
            click("编辑个人资料", "document.querySelector('main')", "edit profile form");
            String dialog = "document.querySelector('[role=\"dialog\"][aria-label=\"编辑个人资料\"]')";
            String changed = "Android UI " + System.currentTimeMillis();
            fill("名", changed, dialog, "profile first name input");
            profileChanged = true;
            click("保存", dialog, "save profile through UI");
            waitForDom("!document.querySelector('[role=\"dialog\"]')", "profile save completes");
            assertTrue("UI profile write was not persisted by the real API",
                changed.equals(object(read(context, server, "/api/users/me/"), "profile after UI edit").optString("first_name")));
            click("编辑个人资料", "document.querySelector('main')", "restore profile form");
            fill("名", previous, dialog, "restore original first name input");
            click("保存", dialog, "restore profile through UI");
            waitForDom("!document.querySelector('[role=\"dialog\"]')", "profile restoration completes");
            assertTrue("UI profile restoration was not persisted",
                previous.equals(object(read(context, server, "/api/users/me/"), "profile after UI restoration").optString("first_name", "")));
            profileChanged = false;

            click("深色", "document", "apply dark theme");
            waitForDom("document.documentElement.dataset.theme==='dark'", "dark theme");
            home("home in dark theme");
            screenshot(context, "home-dark");
            waitForDom("document.documentElement.scrollWidth<=innerWidth", "native screen width");
            click("个人设置", "document.querySelector('.topbar')", "restore light preferences");
            click("浅色", "document", "restore light theme");
            home("final authenticated home");
            waitForDom("document.querySelectorAll('[role=\"alert\"]').length===0", "final UI error state");

            // Recreate the real activity/bridge without clearing WebView preferences
            // or the Keystore vault. The next bridge must restore the persisted session.
            CountDownLatch finished = new CountDownLatch(1);
            MainActivity previousActivity = activity;
            main.post(() -> {
                previousActivity.finish();
                finished.countDown();
            });
            assertTrue("Activity restart dispatch timed out",
                finished.await(Math.min(60000, remaining("activity restart")), TimeUnit.MILLISECONDS));
            activity = (MainActivity) instrumentation.startActivitySync(intent);
            activeActivity = activity;
            webView = activity.getBridge().getWebView();
            waitForDom("!!button('工作',document.querySelector('main'))", "authenticated home after activity restart");
            JSONObject restored = object(read(context, server, "/api/lab/session/"), "session after activity restart");
            assertTrue("Activity restart did not restore the original Android account",
                account.getString("user_id").equals(restored.getJSONObject("user").getString("id")) &&
                "android".equals(restored.getString("client_platform")));
        } finally {
            try {
                if (profileChanged && previous != null) restoreProfile(context, server, previous);
            } finally {
                if (activity != null) {
                    MainActivity closing = activity;
                    main.post(closing::finish);
                }
            }
            // This UI fixture is separate from the backend test's disposable fixture.
        }
    }
}
