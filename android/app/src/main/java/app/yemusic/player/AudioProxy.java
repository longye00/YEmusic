package app.yemusic.player;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * 本地音频代理（仅监听 127.0.0.1），对应桌面版 electron/audioProxy.cjs：
 * 1. 在线音频：为 CDN 流补上 CORS 头（WebAudio 均衡器 / 频谱需要），并附加 Referer / UA 等 CDN 要求的请求头；
 * 2. 本地文件：以支持 Range 的方式提供本地音频（含 SAF 的 content:// 文档），拖动进度条不会重新读取整个文件。
 * 页面只拿到带随机令牌的地址，令牌之外的路径 / 地址一律拒绝，因此它不是任意转发器。
 */
final class AudioProxy {
    /** 本地音频来源（文件或 content:// 文档） */
    interface LocalSource {
        /** 总字节数，未知返回 -1 */
        long length() throws IOException;

        InputStream open(long offset) throws IOException;

        String mime();
    }

    interface LocalOpener {
        LocalSource open(String path) throws IOException;
    }

    private static final class Grant {
        final boolean remote;
        final String url;
        final Map<String, String> headers;
        final String path;

        Grant(boolean remote, String url, Map<String, String> headers, String path) {
            this.remote = remote;
            this.url = url;
            this.headers = headers;
            this.path = path;
        }
    }

    private static final Pattern RANGE = Pattern.compile("^bytes=(\\d*)-(\\d*)$");

    private final LocalOpener opener;
    private final ExecutorService pool = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "ye-audio-proxy");
        t.setDaemon(true);
        return t;
    });
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Grant> tokens = Collections.synchronizedMap(new LinkedHashMap<String, Grant>() {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Grant> eldest) {
            return size() > 500;
        }
    });
    private ServerSocket server;
    private int port;

    AudioProxy(LocalOpener opener) {
        this.opener = opener;
    }

    synchronized int start() throws IOException {
        if (server != null) return port;
        server = new ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"));
        port = server.getLocalPort();
        final ServerSocket ss = server;
        Thread acceptor = new Thread(() -> {
            while (!ss.isClosed()) {
                try {
                    final Socket socket = ss.accept();
                    pool.execute(() -> handle(socket));
                } catch (IOException e) {
                    if (ss.isClosed()) break;
                }
            }
        }, "ye-audio-proxy-accept");
        acceptor.setDaemon(true);
        acceptor.start();
        return port;
    }

    synchronized void stop() {
        tokens.clear();
        if (server != null) {
            try { server.close(); } catch (IOException ignored) { }
        }
        server = null;
        port = 0;
    }

    private String newToken() {
        byte[] raw = new byte[12];
        random.nextBytes(raw);
        StringBuilder sb = new StringBuilder();
        for (byte b : raw) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }

    synchronized String proxyRemoteUrl(String url, Map<String, String> headers) {
        if (server == null || url == null || !url.toLowerCase(Locale.ROOT).matches("^https?://.*")) return null;
        String token = newToken();
        tokens.put(token, new Grant(true, url, headers == null ? new HashMap<>() : headers, null));
        return "http://127.0.0.1:" + port + "/stream?t=" + token;
    }

    synchronized String proxyLocalFile(String path) {
        if (server == null || path == null || path.isEmpty()) return null;
        synchronized (tokens) {
            for (Map.Entry<String, Grant> e : tokens.entrySet()) {
                if (!e.getValue().remote && path.equals(e.getValue().path)) return "http://127.0.0.1:" + port + "/local?t=" + e.getKey();
            }
        }
        String token = newToken();
        tokens.put(token, new Grant(false, null, null, path));
        return "http://127.0.0.1:" + port + "/local?t=" + token;
    }

    // ---------------------------------------------------------------- HTTP

    private static final class HttpRequest {
        String method;
        String path;
        String query;
        final Map<String, String> headers = new HashMap<>();
    }

    private static HttpRequest readRequest(InputStream in) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream(512);
        int state = 0;
        int b;
        while ((b = in.read()) != -1) {
            head.write(b);
            if (head.size() > 16 * 1024) return null;
            if (b == '\r' && (state == 0 || state == 2)) state++;
            else if (b == '\n' && (state == 1 || state == 3)) state++;
            else state = 0;
            if (state == 4) break;
        }
        if (state != 4) return null;
        String text = new String(head.toByteArray(), StandardCharsets.ISO_8859_1);
        String[] lines = text.split("\r\n");
        String[] first = lines[0].split(" ");
        if (first.length < 2) return null;
        HttpRequest req = new HttpRequest();
        req.method = first[0].toUpperCase(Locale.ROOT);
        String target = first[1];
        int q = target.indexOf('?');
        req.path = q >= 0 ? target.substring(0, q) : target;
        req.query = q >= 0 ? target.substring(q + 1) : "";
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon > 0) req.headers.put(lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT), lines[i].substring(colon + 1).trim());
        }
        return req;
    }

    private static String queryParam(String query, String key) {
        for (String part : query.split("&")) {
            int eq = part.indexOf('=');
            if (eq > 0 && part.substring(0, eq).equals(key)) return part.substring(eq + 1);
        }
        return "";
    }

    private static void writeHead(OutputStream out, int status, String reason, Map<String, String> extra) throws IOException {
        StringBuilder sb = new StringBuilder("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
        sb.append("Access-Control-Allow-Origin: *\r\n");
        sb.append("Access-Control-Allow-Headers: *\r\n");
        sb.append("Access-Control-Expose-Headers: Content-Length, Content-Range, Content-Type, Accept-Ranges\r\n");
        sb.append("Cross-Origin-Resource-Policy: cross-origin\r\n");
        for (Map.Entry<String, String> e : extra.entrySet()) sb.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
        sb.append("Connection: close\r\n\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
    }

    private static void fail(OutputStream out, int status, String reason, String message) {
        try {
            byte[] body = message.getBytes(StandardCharsets.UTF_8);
            Map<String, String> h = new LinkedHashMap<>();
            h.put("Content-Type", "text/plain; charset=utf-8");
            h.put("Content-Length", String.valueOf(body.length));
            writeHead(out, status, reason, h);
            out.write(body);
            out.flush();
        } catch (IOException ignored) {
            // 对端已断开
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(30000);
            socket.setTcpNoDelay(true);
            InputStream in = new BufferedInputStream(socket.getInputStream());
            OutputStream out = new BufferedOutputStream(socket.getOutputStream(), 32 * 1024);
            HttpRequest req = readRequest(in);
            if (req == null) return;
            if (req.method.equals("OPTIONS")) {
                Map<String, String> h = new LinkedHashMap<>();
                h.put("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
                h.put("Content-Length", "0");
                writeHead(out, 204, "No Content", h);
                out.flush();
                return;
            }
            if (!req.method.equals("GET") && !req.method.equals("HEAD")) {
                fail(out, 405, "Method Not Allowed", "method not allowed");
                return;
            }
            if (req.path.equals("/health")) {
                Map<String, String> h = new LinkedHashMap<>();
                h.put("Content-Length", "2");
                writeHead(out, 200, "OK", h);
                out.write("ok".getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                return;
            }
            Grant entry = tokens.get(queryParam(req.query, "t"));
            if (entry == null) {
                fail(out, 404, "Not Found", "unknown token");
                return;
            }
            boolean head = req.method.equals("HEAD");
            String range = req.headers.get("range");
            if (req.path.equals("/local") && !entry.remote) serveLocal(out, entry.path, range, head);
            else if (req.path.equals("/stream") && entry.remote) serveRemote(out, entry, range, head);
            else fail(out, 404, "Not Found", "not found");
        } catch (IOException ignored) {
            // 对端断开（播放器切歌 / 拖动进度条时很常见）
        } catch (RuntimeException e) {
            // 不让单个连接的异常影响代理
        } finally {
            try { socket.close(); } catch (IOException ignored) { }
        }
    }

    // ---------------------------------------------------------------- 本地文件

    private void serveLocal(OutputStream out, String path, String rangeHeader, boolean head) throws IOException {
        LocalSource source;
        try {
            source = opener.open(path);
        } catch (IOException e) {
            fail(out, 404, "Not Found", "file not found");
            return;
        }
        long total = source.length();
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Accept-Ranges", "bytes");
        h.put("Content-Type", source.mime());
        long start = 0;
        long end = total - 1;
        int status = 200;
        Matcher m = RANGE.matcher(rangeHeader == null ? "" : rangeHeader);
        if (m.matches() && total >= 0) {
            String a = m.group(1);
            String b = m.group(2);
            if (a.isEmpty() && !b.isEmpty()) {
                start = Math.max(0, total - Long.parseLong(b));
            } else {
                start = a.isEmpty() ? 0 : Long.parseLong(a);
                if (!b.isEmpty()) end = Math.min(Long.parseLong(b), total - 1);
            }
            if (start > end || start >= total) {
                h.put("Content-Range", "bytes */" + total);
                h.put("Content-Length", "0");
                writeHead(out, 416, "Range Not Satisfiable", h);
                out.flush();
                return;
            }
            status = 206;
            h.put("Content-Range", "bytes " + start + "-" + end + "/" + total);
        }
        if (total >= 0) h.put("Content-Length", String.valueOf(end - start + 1));
        writeHead(out, status, status == 206 ? "Partial Content" : "OK", h);
        if (head) {
            out.flush();
            return;
        }
        try (InputStream in = source.open(start)) {
            byte[] buf = new byte[64 * 1024];
            long remaining = total >= 0 ? end - start + 1 : Long.MAX_VALUE;
            while (remaining > 0) {
                int n = in.read(buf, 0, (int) Math.min(buf.length, remaining));
                if (n < 0) break;
                out.write(buf, 0, n);
                remaining -= n;
            }
        }
        out.flush();
    }

    // ---------------------------------------------------------------- 在线音频

    private void serveRemote(OutputStream out, Grant entry, String range, boolean head) throws IOException {
        String[] err = new String[1];
        try (Response up = Net.openStream(entry.url, entry.headers, range, head, err)) {
            if (up == null) {
                boolean denied = err[0] != null && err[0].contains("not allowed");
                fail(out, denied ? 403 : 502, denied ? "Forbidden" : "Bad Gateway", denied ? "host not allowed" : "upstream error: " + err[0]);
                return;
            }
            Map<String, String> h = new LinkedHashMap<>();
            for (String key : new String[]{"content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"}) {
                String value = up.header(key);
                if (value != null) h.put(key, value);
            }
            // OkHttp 已经解压过的响应，原始的 Content-Length 就不再可信了：此时直接以连接关闭作为结束
            ResponseBody body = up.body();
            writeHead(out, up.code(), reasonOf(up), h);
            if (head || body == null) {
                out.flush();
                return;
            }
            try (InputStream in = body.byteStream()) {
                byte[] buf = new byte[32 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
            }
            out.flush();
        }
    }

    private static String reasonOf(Response r) {
        String m = r.message();
        return m == null || m.isEmpty() ? "OK" : m.replaceAll("[\r\n]", " ");
    }
}
