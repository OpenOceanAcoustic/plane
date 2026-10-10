// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only

package org.openoceanacoustic.mobile;

import java.net.URI;
import java.util.Locale;

/** Server selection is an origin, never a URL containing credentials or an API path. */
public final class OriginPolicy {
    private OriginPolicy() {}

    public static String origin(String value) {
        URI uri = URI.create(value.trim());
        requireHttp(uri);
        if (uri.getRawQuery() != null || uri.getRawFragment() != null ||
            (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !uri.getRawPath().equals("/"))) {
            throw new IllegalArgumentException("请输入服务器根地址");
        }
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        if (host.indexOf(':') >= 0 && !host.startsWith("[")) host = "[" + host + "]";
        int port = uri.getPort();
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        boolean standard = port == -1 || (scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80);
        return scheme + "://" + host + (standard ? "" : ":" + port);
    }

    public static URI target(String server, String path, boolean external) {
        String base = origin(server);
        URI result = URI.create(base + "/").resolve(path);
        requireHttp(result);
        if (result.getRawFragment() != null) throw new IllegalArgumentException("请求地址不能包含片段");
        if (!external && !same(base, result)) throw new IllegalArgumentException("请求地址必须属于当前服务器");
        return result;
    }

    public static boolean same(String server, URI uri) {
        return origin(server).equals(origin(uri.getScheme() + "://" + uri.getRawAuthority()));
    }

    private static void requireHttp(URI uri) {
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https")) ||
            uri.getHost() == null || uri.getRawUserInfo() != null || uri.getPort() < -1 || uri.getPort() > 65535) {
            throw new IllegalArgumentException("服务器地址无效");
        }
    }
}
