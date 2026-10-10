// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only

package org.openoceanacoustic.mobile;

import static org.junit.Assert.*;
import java.io.*;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/** Public transport seam: use real HTTP servers to check cookie and origin isolation. */
public class NativeTransportTest {
    /** Tiny real socket fixture; avoids JDK-only HttpServer, which Android's unit compiler excludes. */
    private static final class HttpServer {
        interface Handler { void handle(Exchange exchange) throws IOException; }
        private final ServerSocket socket;
        private final Map<String, Handler> handlers = new HashMap<>();
        private Thread thread;
        private HttpServer(InetSocketAddress address) throws IOException { socket = new ServerSocket(); socket.bind(address); }
        static HttpServer create(InetSocketAddress address, int backlog) throws IOException { return new HttpServer(address); }
        void createContext(String path, Handler handler) { handlers.put(path, handler); }
        InetSocketAddress getAddress() { return (InetSocketAddress) socket.getLocalSocketAddress(); }
        void start() {
            thread = new Thread(() -> {
                while (!socket.isClosed()) {
                    try {
                        Socket accepted = socket.accept();
                        accepted.setSoTimeout(5000);
                        Exchange exchange = new Exchange(accepted);
                        Handler handler = handlers.get(exchange.path);
                        if (handler == null) { exchange.sendResponseHeaders(404, -1); exchange.close(); }
                        else handler.handle(exchange);
                    } catch (IOException ignored) { }
                }
            });
            thread.setDaemon(true); thread.start();
        }
        void stop(int delay) { try { socket.close(); if (thread != null) thread.join(1000); } catch (Exception ignored) { } }
    }
    private static final class Headers extends HashMap<String, List<String>> {
        void add(String key, String value) { computeIfAbsent(key.toLowerCase(), ignored -> new ArrayList<>()).add(value); }
        String getFirst(String key) { List<String> values = get(key.toLowerCase()); return values == null ? null : values.get(0); }
    }
    private static final class Exchange {
        final Socket socket;
        final String path;
        final Headers request = new Headers();
        final Headers response = new Headers();
        Exchange(Socket socket) throws IOException {
            this.socket = socket;
            InputStream input = socket.getInputStream();
            String first = readLine(input);
            path = first.split(" ")[1];
            String line;
            while (!(line = readLine(input)).isEmpty()) { int colon = line.indexOf(':'); request.add(line.substring(0, colon), line.substring(colon + 1).trim()); }
            if ("chunked".equalsIgnoreCase(request.getFirst("Transfer-Encoding"))) {
                int size;
                while ((size = Integer.parseInt(readLine(input).split(";")[0], 16)) > 0) { skip(input, size); readLine(input); }
                readLine(input);
            } else if (request.getFirst("Content-Length") != null) skip(input, Integer.parseInt(request.getFirst("Content-Length")));
        }
        Headers getRequestHeaders() { return request; }
        Headers getResponseHeaders() { return response; }
        void sendResponseHeaders(int status, long size) throws IOException {
            StringBuilder values = new StringBuilder("HTTP/1.1 " + status + " OK\r\nConnection: close\r\nContent-Length: " + Math.max(0, size) + "\r\n");
            response.forEach((key, entries) -> entries.forEach(value -> values.append(key).append(": ").append(value).append("\r\n")));
            values.append("\r\n"); socket.getOutputStream().write(values.toString().getBytes(StandardCharsets.UTF_8));
        }
        OutputStream getResponseBody() throws IOException { return socket.getOutputStream(); }
        void close() throws IOException { socket.getOutputStream().flush(); socket.close(); }
        private static void skip(InputStream input, int count) throws IOException { for (int index = 0; index < count; index++) if (input.read() < 0) throw new EOFException(); }
        private static String readLine(InputStream input) throws IOException {
            ByteArrayOutputStream line = new ByteArrayOutputStream(); int value;
            while ((value = input.read()) != -1 && value != '\n') { if (value != '\r') line.write(value); if (line.size() > 16384) throw new IOException("Header too large"); }
            if (value < 0) throw new EOFException();
            return new String(line.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    @Test public void externalAttachmentRedirectRemovesCredentialsAndCannotOverwriteSession() throws Exception {
        HttpServer originServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        HttpServer attachmentServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        attachmentServer.createContext("/file", exchange -> {
            exchange.getResponseHeaders().add("Set-Cookie", "sessionid=attacker; Path=/");
            String received = String.valueOf(exchange.getRequestHeaders().getFirst("Cookie")) + "|" +
                String.valueOf(exchange.getRequestHeaders().getFirst("X-CSRFToken")) + "|" +
                String.valueOf(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body = received.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        originServer.createContext("/attachment", exchange -> {
            exchange.getResponseHeaders().add("Location", "http://127.0.0.1:" + attachmentServer.getAddress().getPort() + "/file");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        originServer.start(); attachmentServer.start();
        try {
            String origin = "http://127.0.0.1:" + originServer.getAddress().getPort();
            CookieSession cookies = new CookieSession();
            cookies.accept(URI.create(origin), Collections.singletonList("sessionid=secret; Path=/"));
            Map<String, String> headers = new HashMap<>();
            headers.put("X-CSRFToken", "private-csrf"); headers.put("Authorization", "private-token");
            NativeHttp.Result result = NativeHttp.execute(origin, "/attachment", "GET", headers, null, cookies, false, null);
            assertEquals("null|null|null", new String(result.body, StandardCharsets.UTF_8));
            assertEquals("sessionid=secret", cookies.header(URI.create(origin + "/me")));
            try {
                NativeHttp.execute(origin, "/attachment", "POST", headers, null, cookies, false, null);
                fail("Cross-origin writes must fail");
            } catch (java.io.IOException expected) { assertEquals("拒绝跨服务器重定向写入", expected.getMessage()); }
        } finally { originServer.stop(0); attachmentServer.stop(0); }
    }

    @Test public void cookiePathSecureAndDeleteRulesSurviveRestart() throws Exception {
        CookieSession cookies = new CookieSession();
        URI origin = URI.create("https://example.test/login");
        cookies.accept(origin, Collections.singletonList("admin=secret; Path=/api/instances; Secure"));
        CookieSession restored = CookieSession.restore(cookies.snapshot());
        assertEquals("", restored.header(URI.create("https://example.test/api/instances-fake/")));
        assertEquals("", restored.header(URI.create("http://example.test/api/instances/")));
        assertEquals("admin=secret", restored.header(URI.create("https://example.test/api/instances/")));
        restored.accept(origin, Collections.singletonList("admin=gone; Path=/api/instances; Max-Age=0"));
        assertEquals("", restored.header(URI.create("https://example.test/api/instances/")));
    }

    @Test public void serverRootRejectsCredentialsAndForeignRequestOrigins() {
        assertEquals("https://example.test", OriginPolicy.origin("https://EXAMPLE.TEST:443/"));
        for (String invalid : new String[]{"file:///etc/passwd", "https://name:password@example.test", "https://example.test/api/"}) {
            try { OriginPolicy.origin(invalid); fail("Unsafe origin accepted"); } catch (IllegalArgumentException expected) { }
        }
        try { OriginPolicy.target("https://example.test", "//evil.test/path", false); fail("Foreign origin accepted"); }
        catch (IllegalArgumentException expected) { }
    }

    @Test public void signedFileUploadNeverCarriesSessionOrCsrfHeaders() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/upload", exchange -> {
            String received = String.valueOf(exchange.getRequestHeaders().getFirst("Cookie")) + "|" +
                String.valueOf(exchange.getRequestHeaders().getFirst("X-CSRFToken"));
            byte[] body = received.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            String origin = "http://127.0.0.1:" + server.getAddress().getPort();
            CookieSession cookies = new CookieSession();
            cookies.accept(URI.create(origin + "/login"), Collections.singletonList("sessionid=secret; Path=/"));
            Map<String, String> headers = new HashMap<>();
            headers.put("X-CSRFToken", "private-csrf");
            NativeHttp.Result result = NativeHttp.execute(origin, "/upload", "PUT", headers, output -> output.write(new byte[]{1}), cookies, true, null);
            assertEquals("null|null", new String(result.body, StandardCharsets.UTF_8));
        } finally { server.stop(0); }
    }

    @Test public void loginCookieSurvivesRestartWithoutAppearingInResponseHeaders() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/login", exchange -> {
            exchange.getResponseHeaders().add("Set-Cookie", "sessionid=secret; HttpOnly; Path=/");
            exchange.sendResponseHeaders(200, 2);
            exchange.getResponseBody().write("{}".getBytes(StandardCharsets.UTF_8));
            exchange.close();
        });
        server.createContext("/me", exchange -> {
            byte[] body = String.valueOf(exchange.getRequestHeaders().getFirst("Cookie")).getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            String origin = "http://127.0.0.1:" + server.getAddress().getPort();
            CookieSession cookies = new CookieSession();
            NativeHttp.Result login = NativeHttp.execute(origin, "/login", "GET", Collections.emptyMap(), null, cookies, false, null);
            assertFalse(login.headers.containsKey("set-cookie"));
            CookieSession restored = CookieSession.restore(cookies.snapshot());
            NativeHttp.Result me = NativeHttp.execute(origin, "/me", "GET", Collections.emptyMap(), null, restored, false, null);
            assertEquals("sessionid=secret", new String(me.body, StandardCharsets.UTF_8));
            restored.clear();
            assertEquals("", restored.header(URI.create(origin + "/me")));
        } finally { server.stop(0); }
    }
}
