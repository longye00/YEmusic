package app.yemusic.player;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.Headers;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.brotli.BrotliInterceptor;
import java.util.Arrays;

/**
 * 原生 HTTP 工具，对应桌面版 electron/net.cjs：手动跟随重定向（每一跳重新校验域名）、自动解压 gzip / br、
 * 限制响应体大小；错误一律以 Result.error 的形式返回而不是抛出。
 */
final class Net {
    static final String DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

    private static volatile OkHttpClient base;

    static OkHttpClient client() {
        OkHttpClient c = base;
        if (c == null) {
            synchronized (Net.class) {
                c = base;
                if (c == null) {
                    c = new OkHttpClient.Builder()
                            .followRedirects(false)
                            .followSslRedirects(false)
                            .retryOnConnectionFailure(true)
                            .protocols(Arrays.asList(Protocol.HTTP_2, Protocol.HTTP_1_1))
                            .addInterceptor(BrotliInterceptor.INSTANCE)
                            .connectTimeout(20, TimeUnit.SECONDS)
                            .readTimeout(30, TimeUnit.SECONDS)
                            .writeTimeout(30, TimeUnit.SECONDS)
                            .build();
                    base = c;
                }
            }
        }
        return c;
    }

    static OkHttpClient client(long timeoutMs) {
        return client().newBuilder()
                .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .build();
    }

    // ---------------------------------------------------------------- 域名校验（与 net.cjs 一致）

    static boolean isPublicHost(String hostname) {
        String lower = hostname == null ? "" : hostname.toLowerCase(Locale.ROOT);
        if (lower.isEmpty() || lower.equals("localhost") || lower.endsWith(".local") || lower.endsWith(".internal")) return false;
        if (lower.startsWith("[") || lower.indexOf(':') >= 0) return false;
        if (lower.matches("^\\d+\\.\\d+\\.\\d+\\.\\d+$")) {
            String[] parts = lower.split("\\.");
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            return !(a == 10 || a == 127 || a == 0 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31) || (a == 169 && b == 254));
        }
        return lower.contains(".") && lower.length() <= 253;
    }

    static boolean hostMatches(String hostname, Collection<String> list) {
        String lower = hostname == null ? "" : hostname.toLowerCase(Locale.ROOT);
        for (String entry : list) {
            if (lower.equals(entry) || lower.endsWith("." + entry)) return true;
        }
        return false;
    }

    interface Validator {
        /** 返回错误信息表示拒绝，null 表示放行 */
        String check(HttpUrl url);
    }

    static final Validator PUBLIC_ONLY = url -> isPublicHost(url.host()) ? null : "host not allowed";

    // ---------------------------------------------------------------- 请求

    static final class Req {
        String url;
        String method = "GET";
        Map<String, String> headers = new LinkedHashMap<>();
        byte[] body;
        long timeoutMs = 20000;
        long maxBytes = 32L * 1024 * 1024;
        boolean followRedirects = true;
        Validator validator;
        /** 只取前 N 个字节（探测用），0 表示不限制 */
        long range;
    }

    static final class Result {
        boolean ok;
        int status;
        String statusMessage = "";
        String error;
        String url;
        Map<String, String> headers = new LinkedHashMap<>();
        byte[] bytes;

        static Result fail(int status, String error) {
            Result r = new Result();
            r.status = status;
            r.error = error;
            return r;
        }
    }

    private static Headers buildHeaders(Map<String, String> input, long range) {
        Headers.Builder hb = new Headers.Builder();
        boolean hasUa = false;
        boolean hasAccept = false;
        for (Map.Entry<String, String> e : input.entrySet()) {
            if (e.getKey() == null || e.getValue() == null) continue;
            String key = e.getKey().toLowerCase(Locale.ROOT).trim();
            if (key.isEmpty() || key.equals("host") || key.equals("content-length") || key.equals("connection")) continue;
            // 让 OkHttp 自己协商并解压 gzip / br，调用方指定 accept-encoding 会让它放弃自动解压
            if (key.equals("accept-encoding")) continue;
            if (key.equals("range") && range > 0) continue;
            if (key.equals("user-agent")) hasUa = true;
            if (key.equals("accept")) hasAccept = true;
            try {
                hb.addUnsafeNonAscii(key, e.getValue());
            } catch (IllegalArgumentException ignored) {
                // 非法的头名称，跳过
            }
        }
        if (!hasUa) hb.add("user-agent", DEFAULT_UA);
        if (!hasAccept) hb.add("accept", "*/*");
        if (range > 0) hb.add("range", "bytes=0-" + (range - 1));
        return hb.build();
    }

    private static String flatten(List<String> values) {
        StringBuilder sb = new StringBuilder();
        for (String v : values) {
            if (sb.length() > 0) sb.append(", ");
            sb.append(v);
        }
        return sb.toString();
    }

    /** 发出请求并手动跟随重定向；调用方负责关闭返回的 Response */
    static Response open(Req req, HttpUrl first, String method, byte[] body, Headers headers, int hops, String[] errorOut) throws IOException {
        HttpUrl url = first;
        for (int hop = hops; ; hop++) {
            String rejection = req.validator != null ? req.validator.check(url) : null;
            if (rejection != null) {
                errorOut[0] = rejection;
                return null;
            }
            Request.Builder rb = new Request.Builder().url(url).headers(headers);
            RequestBody rbody = null;
            boolean needsBody = method.equals("POST") || method.equals("PUT") || method.equals("PATCH");
            if (needsBody) rbody = RequestBody.create(body != null ? body : new byte[0], (MediaType) null);
            else if (body != null && !method.equals("GET") && !method.equals("HEAD")) rbody = RequestBody.create(body, (MediaType) null);
            rb.method(method, rbody);
            Response res = client(req.timeoutMs).newCall(rb.build()).execute();
            int status = res.code();
            String location = res.header("location");
            if (status >= 300 && status < 400 && location != null && req.followRedirects) {
                res.close();
                if (hop >= 8) {
                    errorOut[0] = "too many redirects";
                    return null;
                }
                HttpUrl next = url.resolve(location);
                if (next == null) {
                    errorOut[0] = "bad redirect location";
                    return null;
                }
                if (!(status == 307 || status == 308)) {
                    method = "GET";
                    body = null;
                }
                url = next;
                continue;
            }
            return res;
        }
    }

    static Result request(Req req) {
        HttpUrl url = HttpUrl.parse(req.url == null ? "" : req.url);
        if (url == null) {
            String lower = req.url == null ? "" : req.url.toLowerCase(Locale.ROOT);
            if (lower.matches("^[a-z][a-z0-9+.-]*:.*") && !lower.startsWith("http")) {
                return Result.fail(0, "blocked protocol: " + lower.substring(0, lower.indexOf(':') + 1));
            }
            return Result.fail(0, "invalid url");
        }
        long timeout = Math.min(Math.max(req.timeoutMs, 1000), 90000);
        req.timeoutMs = timeout;
        long maxBytes = req.maxBytes > 0 ? req.maxBytes : 32L * 1024 * 1024;
        String method = (req.method == null ? "GET" : req.method).toUpperCase(Locale.ROOT);
        byte[] body = (method.equals("GET") || method.equals("HEAD")) ? null : req.body;
        Headers headers = buildHeaders(req.headers, req.range);
        String[] err = new String[1];
        try (Response res = open(req, url, method, body, headers, 0, err)) {
            if (res == null) return Result.fail(0, err[0]);
            Result out = new Result();
            out.status = res.code();
            out.ok = out.status >= 200 && out.status < 300;
            out.statusMessage = res.message() == null ? "" : res.message();
            out.url = res.request().url().toString();
            for (Map.Entry<String, List<String>> h : res.headers().toMultimap().entrySet()) {
                out.headers.put(h.getKey().toLowerCase(Locale.ROOT), flatten(h.getValue()));
            }
            ResponseBody rb = res.body();
            if (rb == null) {
                out.bytes = new byte[0];
                return out;
            }
            ByteArrayOutputStream bos = new ByteArrayOutputStream(16 * 1024);
            byte[] buf = new byte[16 * 1024];
            long total = 0;
            try (InputStream in = rb.byteStream()) {
                int n;
                while ((n = in.read(buf)) != -1) {
                    total += n;
                    if (total > maxBytes) return Result.fail(out.status, "response exceeds size limit");
                    bos.write(buf, 0, n);
                    if (req.range > 0 && total >= req.range) break;
                }
            } catch (IOException e) {
                if (req.range <= 0 || total == 0) throw e;
            }
            out.bytes = bos.toByteArray();
            return out;
        } catch (IOException e) {
            String message = e.getMessage();
            if (e instanceof java.net.SocketTimeoutException) message = "request timed out";
            return Result.fail(0, message == null ? e.getClass().getSimpleName() : message);
        } catch (RuntimeException e) {
            return Result.fail(0, String.valueOf(e.getMessage()));
        }
    }

    /** 打开上游流（音频代理 / 下载用）：只校验公网域名，调用方负责关闭 Response；失败返回 null 并把原因写进 errorOut */
    static Response openStream(String url, Map<String, String> headers, String range, boolean head, String[] errorOut) {
        HttpUrl parsed = HttpUrl.parse(url == null ? "" : url);
        if (parsed == null) {
            errorOut[0] = "bad url";
            return null;
        }
        Req req = new Req();
        req.url = url;
        req.timeoutMs = 30000;
        req.validator = PUBLIC_ONLY;
        Map<String, String> merged = new LinkedHashMap<>();
        if (headers != null) merged.putAll(headers);
        Headers.Builder hb = buildHeaders(merged, 0).newBuilder();
        if (range != null && !range.isEmpty()) hb.set("range", range);
        try {
            return open(req, parsed, head ? "HEAD" : "GET", null, hb.build(), 0, errorOut);
        } catch (IOException e) {
            errorOut[0] = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            return null;
        }
    }

    private Net() {}
}
