// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only

package org.openoceanacoustic.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

@CapacitorPlugin(name = "MobileTransport")
public class MobileTransport extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Map<String, SelectedFile> files = new HashMap<>();
    private SessionVault vault;

    private static final class SelectedFile {
        final File file;
        final String name;
        final String mimeType;
        SelectedFile(File file, String name, String mimeType) { this.file = file; this.name = name; this.mimeType = mimeType; }
    }

    @Override public void load() { vault = new SessionVault(getContext()); }

    @PluginMethod public void request(PluginCall call) {
        worker.execute(() -> {
            try {
                String server = required(call, "server");
                String path = required(call, "path");
                String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
                Object data = call.getData().opt("data");
                Map<String, String> headers = headers(call);
                NativeHttp.Body body = null;
                if (data != null && data != JSONObject.NULL) {
                    byte[] bytes;
                    if (call.getString("bodyEncoding", "json").equals("base64")) {
                        bytes = Base64.decode(String.valueOf(data), Base64.DEFAULT);
                    } else {
                        String json = data instanceof String ? JSONObject.quote((String) data) : String.valueOf(data);
                        bytes = json.getBytes(StandardCharsets.UTF_8);
                        headers.putIfAbsent("Content-Type", "application/json");
                    }
                    body = new NativeHttp.Body() {
                        public void write(OutputStream output) throws IOException { output.write(bytes); }
                        public long contentLength() { return bytes.length; }
                    };
                }
                NativeHttp.Result result;
                try { result = NativeHttp.execute(server, path, method, headers, body, getSession(server), false, null); }
                finally { saveSession(server); }
                call.resolve(response(result, call.getString("responseType", "json")));
            } catch (Exception error) { reject(call, error); }
        });
    }

    @PluginMethod public void clearSession(PluginCall call) {
        worker.execute(() -> {
            try {
                try { vault.clear(call.getString("server")); }
                catch (IllegalArgumentException invalid) { throw invalid; }
                catch (Exception storage) { throw new TransportFailure.SessionStorageFailure(storage); }
                files.clear();
                deleteContents(new File(getContext().getCacheDir(), "mobile-files"));
                call.resolve();
            } catch (Exception error) { reject(call, error); }
        });
    }

    @PluginMethod public void pickFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "*/*"));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivityForResult(call, intent, "fileChosen"); }
        catch (ActivityNotFoundException missing) { call.reject("没有可用的文件选择器", "NO_FILE_PICKER"); }
    }

    @ActivityCallback private void fileChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("已取消选择", "PICK_CANCELLED");
            return;
        }
        Uri uri = result.getData().getData();
        worker.execute(() -> {
            File target = null;
            try {
                String name = "attachment";
                try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                }
                name = safeName(name);
                String mimeType = getContext().getContentResolver().getType(uri);
                if (mimeType == null) mimeType = "application/octet-stream";
                String id = UUID.randomUUID().toString();
                File directory = new File(getContext().getCacheDir(), "mobile-files/picked");
                if (!directory.exists() && !directory.mkdirs()) throw new IOException("无法准备文件缓存");
                target = new File(directory, id);
                try (InputStream input = getContext().getContentResolver().openInputStream(uri); OutputStream output = new FileOutputStream(target)) {
                    if (input == null) throw new IOException("无法读取文件");
                    copy(input, output);
                }
                files.put(id, new SelectedFile(target, name, mimeType));
                JSObject selected = new JSObject();
                selected.put("fileId", id);
                selected.put("name", name);
                selected.put("mimeType", mimeType);
                selected.put("size", target.length());
                call.resolve(selected);
            } catch (Exception error) {
                if (target != null) target.delete();
                reject(call, error);
            }
        });
    }

    @PluginMethod public void uploadFile(PluginCall call) {
        worker.execute(() -> {
            try {
                String server = required(call, "server");
                String path = required(call, "path");
                SelectedFile selected = files.get(required(call, "fileId"));
                if (selected == null || !selected.file.isFile()) throw new IllegalArgumentException("请重新选择文件");
                JSObject fields = call.getObject("fields");
                boolean signed = call.getBoolean("signed", true);
                String method = call.getString("method", fields == null ? "PUT" : "POST").toUpperCase(Locale.ROOT);
                Map<String, String> headers = headers(call);
                NativeHttp.Body body;
                if (fields != null) {
                    String boundary = "OOA" + UUID.randomUUID().toString().replace("-", "");
                    headers.put("Content-Type", "multipart/form-data; boundary=" + boundary);
                    ByteArrayOutputStream prefix = new ByteArrayOutputStream();
                    Iterator<String> keys = fields.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        write(prefix, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + fieldName(key) + "\"\r\n\r\n" + fields.optString(key) + "\r\n");
                    }
                    write(prefix, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + fieldName(call.getString("fileField", "file")) + "\"; filename=\"" + fieldName(selected.name) + "\"\r\nContent-Type: " + selected.mimeType + "\r\n\r\n");
                    byte[] start = prefix.toByteArray();
                    byte[] end = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
                    body = new NativeHttp.Body() {
                        public void write(OutputStream output) throws IOException {
                            output.write(start);
                            try (InputStream input = new FileInputStream(selected.file)) { copy(input, output); }
                            output.write(end);
                        }
                        public long contentLength() { return start.length + selected.file.length() + end.length; }
                    };
                } else {
                    headers.putIfAbsent("Content-Type", selected.mimeType);
                    body = new NativeHttp.Body() {
                        public void write(OutputStream output) throws IOException { try (InputStream input = new FileInputStream(selected.file)) { copy(input, output); } }
                        public long contentLength() { return selected.file.length(); }
                    };
                }
                NativeHttp.Result result;
                try { result = NativeHttp.execute(server, path, method, headers, body, signed ? new CookieSession() : getSession(server), signed, null); }
                finally { if (!signed) saveSession(server); }
                call.resolve(response(result, "json"));
            } catch (Exception error) { reject(call, error); }
        });
    }

    @PluginMethod public void download(PluginCall call) {
        worker.execute(() -> {
            File target = null;
            try {
                String server = required(call, "server");
                String path = required(call, "path");
                String name = safeName(call.getString("name", "attachment"));
                File directory = new File(getContext().getCacheDir(), "mobile-files/downloads/" + UUID.randomUUID());
                if (!directory.mkdirs()) throw new IOException("无法准备下载目录");
                target = new File(directory, name);
                NativeHttp.Result result;
                try (OutputStream output = new FileOutputStream(target)) {
                    try { result = NativeHttp.execute(server, path, "GET", headers(call), null, getSession(server), false, output); }
                    finally { saveSession(server); }
                }
                if (result.status >= 400) {
                    target.delete();
                    call.resolve(response(result, "json"));
                    return;
                }
                String mimeType = result.headers.getOrDefault("content-type", "application/octet-stream").split(";")[0];
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", target);
                JSObject response = new JSObject();
                response.put("status", result.status);
                response.put("name", name);
                response.put("uri", uri.toString());
                response.put("mimeType", mimeType);
                getActivity().runOnUiThread(() -> {
                    Intent open = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mimeType).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try {
                        getActivity().startActivity(open);
                        response.put("opened", true);
                    } catch (ActivityNotFoundException missing) { response.put("opened", false); }
                    call.resolve(response);
                });
            } catch (Exception error) {
                if (target != null) target.delete();
                reject(call, error);
            }
        });
    }

    @PluginMethod public void insets(PluginCall call) {
        getActivity().runOnUiThread(() -> call.resolve(((MainActivity) getActivity()).insetValues()));
    }

    @PluginMethod public void setAppearance(PluginCall call) {
        getActivity().runOnUiThread(() -> { ((MainActivity) getActivity()).applyAppearance(call.getBoolean("dark", false)); call.resolve(); });
    }

    private JSObject response(NativeHttp.Result result, String type) throws Exception {
        JSObject response = new JSObject();
        response.put("status", result.status);
        response.put("headers", new JSObject(new JSONObject(result.headers).toString()));
        if (type.equals("base64")) response.put("data", Base64.encodeToString(result.body, Base64.NO_WRAP));
        else {
            String text = new String(result.body, StandardCharsets.UTF_8);
            Object data = text;
            if (!type.equals("text") && !text.isEmpty()) {
                try { data = new JSONTokener(text).nextValue(); scrub(data); } catch (org.json.JSONException invalid) { data = text; }
            }
            response.put("data", data);
        }
        return response;
    }

    private void scrub(Object data) throws org.json.JSONException {
        if (data instanceof JSONObject) {
            JSONObject object = (JSONObject) data;
            List<String> keys = new ArrayList<>();
            object.keys().forEachRemaining(keys::add);
            for (String key : keys) {
                String normalized = key.toLowerCase(Locale.ROOT).replace("-", "_");
                if (normalized.equals("cookie") || normalized.equals("cookies") || normalized.equals("set_cookie") || normalized.equals("sessionid") || normalized.equals("session_id")) object.remove(key);
                else scrub(object.opt(key));
            }
        } else if (data instanceof JSONArray) {
            JSONArray array = (JSONArray) data;
            for (int index = 0; index < array.length(); index++) scrub(array.opt(index));
        }
    }

    private Map<String, String> headers(PluginCall call) {
        Map<String, String> result = new HashMap<>();
        JSObject source = call.getObject("headers");
        if (source != null) source.keys().forEachRemaining(key -> result.put(key, source.optString(key)));
        return result;
    }

    private static String required(PluginCall call, String name) {
        String value = call.getString(name);
        if (value == null || value.isEmpty()) throw new IllegalArgumentException("缺少" + name);
        return value;
    }
    private static String safeName(String name) {
        String value = name == null ? "attachment" : name.replaceAll("[\\\\/\\r\\n\\x00]", "_");
        if (value.equals(".") || value.equals("..") || value.isEmpty()) return "attachment";
        return value.length() > 180 ? value.substring(value.length() - 180) : value;
    }
    private static String fieldName(String value) { return value.replace("\r", "").replace("\n", "").replace("\"", "_"); }
    private static void write(OutputStream output, String value) throws IOException { output.write(value.getBytes(StandardCharsets.UTF_8)); }
    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] bytes = new byte[65536]; int count;
        while ((count = input.read(bytes)) != -1) output.write(bytes, 0, count);
    }
    private static void deleteContents(File directory) {
        File[] children = directory.listFiles();
        if (children != null) for (File child : children) { if (child.isDirectory()) deleteContents(child); child.delete(); }
    }
    private CookieSession getSession(String server) throws Exception {
        try { return vault.get(server); }
        catch (IllegalArgumentException invalid) { throw invalid; }
        catch (Exception storage) { throw new TransportFailure.SessionStorageFailure(storage); }
    }
    private void saveSession(String server) throws Exception {
        try { vault.save(server); }
        catch (IllegalArgumentException invalid) { throw invalid; }
        catch (Exception storage) { throw new TransportFailure.SessionStorageFailure(storage); }
    }
    private static void reject(PluginCall call, Exception error) {
        String operation = call.getMethodName();
        String code = TransportFailure.code(operation, error);
        Log.w("OOA.MobileTransport", TransportFailure.diagnostic(operation, error));
        if (error instanceof IllegalArgumentException) call.reject(error.getMessage(), code);
        else if (error instanceof TransportFailure.SessionStorageFailure) call.reject("无法保存安全会话，请重新登录后重试", code);
        else call.reject("网络或文件操作失败，请重试", code);
    }
    @Override protected void handleOnDestroy() { worker.shutdown(); }
}
