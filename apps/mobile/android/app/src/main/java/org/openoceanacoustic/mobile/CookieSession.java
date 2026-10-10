// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only

package org.openoceanacoustic.mobile;

import java.io.*;
import java.net.HttpCookie;
import java.net.URI;
import java.util.*;

/** One cookie jar per selected server origin. Its binary snapshot is encrypted by SessionVault. */
public final class CookieSession {
    private static final class Entry {
        final HttpCookie cookie;
        final long expiresAt;
        Entry(HttpCookie cookie, long expiresAt) { this.cookie = cookie; this.expiresAt = expiresAt; }
    }
    private final List<Entry> entries = new ArrayList<>();

    public synchronized void accept(URI uri, List<String> values) {
        if (values == null) return;
        for (String value : values) {
            for (HttpCookie cookie : HttpCookie.parse(value)) {
                if (cookie.getDomain() != null && !domainMatches(uri.getHost(), cookie.getDomain())) continue;
                if (cookie.getPath() == null || !cookie.getPath().startsWith("/")) {
                    String path = uri.getPath();
                    cookie.setPath(path == null || path.lastIndexOf('/') <= 0 ? "/" : path.substring(0, path.lastIndexOf('/')));
                }
                entries.removeIf(entry -> entry.cookie.getName().equals(cookie.getName()) && Objects.equals(entry.cookie.getPath(), cookie.getPath()));
                long age = cookie.getMaxAge();
                if (age != 0) {
                    long expiresAt = age < 0 ? Long.MAX_VALUE : System.currentTimeMillis() + Math.min(age, 315360000L) * 1000;
                    entries.add(new Entry(cookie, expiresAt));
                }
            }
        }
    }

    public synchronized String header(URI uri) {
        entries.removeIf(entry -> entry.expiresAt <= System.currentTimeMillis());
        List<String> result = new ArrayList<>();
        String path = uri.getPath() == null || uri.getPath().isEmpty() ? "/" : uri.getPath();
        for (Entry entry : entries) {
            HttpCookie cookie = entry.cookie;
            String scope = cookie.getPath();
            boolean pathMatches = path.equals(scope) || (path.startsWith(scope) && (scope.endsWith("/") || path.charAt(scope.length()) == '/'));
            if (pathMatches && (!cookie.getSecure() || uri.getScheme().equalsIgnoreCase("https"))) {
                result.add(cookie.getName() + "=" + cookie.getValue());
            }
        }
        StringBuilder value = new StringBuilder();
        for (String part : result) { if (value.length() > 0) value.append("; "); value.append(part); }
        return value.toString();
    }

    public synchronized byte[] snapshot() throws IOException {
        entries.removeIf(entry -> entry.expiresAt <= System.currentTimeMillis());
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        DataOutputStream output = new DataOutputStream(buffer);
        output.writeInt(entries.size());
        for (Entry entry : entries) {
            output.writeUTF(entry.cookie.getName());
            output.writeUTF(entry.cookie.getValue());
            output.writeUTF(entry.cookie.getPath());
            output.writeBoolean(entry.cookie.getSecure());
            output.writeLong(entry.expiresAt);
        }
        return buffer.toByteArray();
    }

    public static CookieSession restore(byte[] bytes) throws IOException {
        CookieSession result = new CookieSession();
        DataInputStream input = new DataInputStream(new ByteArrayInputStream(bytes));
        int count = input.readInt();
        if (count < 0 || count > 512) throw new IOException("Invalid session snapshot");
        for (int index = 0; index < count; index++) {
            HttpCookie cookie = new HttpCookie(input.readUTF(), input.readUTF());
            cookie.setPath(input.readUTF());
            cookie.setSecure(input.readBoolean());
            long expiresAt = input.readLong();
            if (expiresAt > System.currentTimeMillis()) result.entries.add(new Entry(cookie, expiresAt));
        }
        return result;
    }

    public synchronized void clear() { entries.clear(); }

    private static boolean domainMatches(String host, String domain) {
        String normalized = domain.startsWith(".") ? domain.substring(1) : domain;
        return host.equalsIgnoreCase(normalized) || host.toLowerCase(Locale.ROOT).endsWith("." + normalized.toLowerCase(Locale.ROOT));
    }
}
