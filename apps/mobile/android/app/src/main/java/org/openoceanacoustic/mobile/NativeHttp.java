// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only

package org.openoceanacoustic.mobile;

import java.io.*;
import java.net.*;
import java.util.*;

/** Authenticated HTTP with explicit redirect handling and a private cookie jar. */
public final class NativeHttp {
    public interface Body {
        void write(OutputStream output) throws IOException;
        default long contentLength() { return -1; }
    }
    public static final class Result {
        public int status;
        public byte[] body;
        public final Map<String, String> headers = new HashMap<>();
    }
    private NativeHttp() {}

    public static Result execute(String server, String path, String method, Map<String, String> headers,
                                 Body body, CookieSession cookies, boolean signed, OutputStream download) throws IOException {
        String origin = OriginPolicy.origin(server);
        URI target = OriginPolicy.target(origin, path, signed);
        boolean credentials = !signed;
        Map<String, String> currentHeaders = new HashMap<>(headers);
        if (signed) currentHeaders.entrySet().removeIf(entry -> isSensitive(entry.getKey()));
        for (int redirect = 0; redirect < 8; redirect++) {
            HttpURLConnection connection = (HttpURLConnection) target.toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(download == null ? 30000 : 120000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "OpenOceanAcoustic-Android/1.0.0");
            for (Map.Entry<String, String> header : currentHeaders.entrySet()) {
                String key = header.getKey().toLowerCase(Locale.ROOT);
                if (!key.equals("cookie") && !key.equals("set-cookie") && !key.equals("host") && !key.equals("origin")) {
                    connection.setRequestProperty(header.getKey(), header.getValue());
                }
            }
            boolean authenticated = credentials && OriginPolicy.same(origin, target);
            if (authenticated) {
                String cookie = cookies.header(target);
                if (!cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
                if (!method.equals("GET") && !method.equals("HEAD")) connection.setRequestProperty("Origin", origin);
            }
            try {
                if (body != null) {
                    connection.setDoOutput(true);
                    if (body.contentLength() >= 0) connection.setFixedLengthStreamingMode(body.contentLength());
                    else connection.setChunkedStreamingMode(65536);
                    try (OutputStream output = connection.getOutputStream()) { body.write(output); }
                }
                int status = connection.getResponseCode();
                if (authenticated) {
                    for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                        if (header.getKey() != null && header.getKey().equalsIgnoreCase("Set-Cookie")) cookies.accept(target, header.getValue());
                    }
                }
                String location = connection.getHeaderField("Location");
                if (location != null && (status == 301 || status == 302 || status == 303 || status == 307 || status == 308)) {
                    URI next = OriginPolicy.target(origin, target.resolve(location).toString(), true);
                    if (!OriginPolicy.same(origin, next)) {
                        if (!method.equals("GET") && !method.equals("HEAD")) throw new IOException("拒绝跨服务器重定向写入");
                        credentials = false;
                        currentHeaders.entrySet().removeIf(entry -> isSensitive(entry.getKey()) || entry.getKey().equalsIgnoreCase("Referer"));
                    }
                    if (status == 303 || ((status == 301 || status == 302) && method.equals("POST"))) { method = "GET"; body = null; }
                    target = next;
                    continue;
                }
                Result result = new Result();
                result.status = status;
                for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                    if (header.getKey() != null && !isSensitive(header.getKey())) {
                        StringBuilder value = new StringBuilder();
                        for (String part : header.getValue()) { if (value.length() > 0) value.append(", "); value.append(part); }
                        result.headers.put(header.getKey().toLowerCase(Locale.ROOT), value.toString());
                    }
                }
                InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                ByteArrayOutputStream buffer = download == null || status >= 400 ? new ByteArrayOutputStream() : null;
                OutputStream sink = buffer == null ? download : buffer;
                if (input != null) {
                    try (InputStream readable = input) {
                        byte[] chunk = new byte[65536];
                        int read;
                        long total = 0;
                        while ((read = readable.read(chunk)) != -1) {
                            total += read;
                            if (buffer != null && total > 16 * 1024 * 1024) throw new IOException("响应过大，请使用附件下载");
                            sink.write(chunk, 0, read);
                        }
                    }
                }
                result.body = buffer == null ? new byte[0] : buffer.toByteArray();
                return result;
            } finally { connection.disconnect(); }
        }
        throw new IOException("重定向次数过多");
    }

    private static boolean isSensitive(String key) {
        String lower = key.toLowerCase(Locale.ROOT);
        return lower.equals("cookie") || lower.equals("set-cookie") || lower.equals("authorization") || lower.equals("proxy-authorization") ||
            lower.equals("x-csrftoken") || lower.equals("x-csrf-token") || lower.equals("origin") || lower.equals("x-session-id");
    }
}
