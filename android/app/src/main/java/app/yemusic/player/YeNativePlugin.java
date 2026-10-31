package app.yemusic.player;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.ContentResolver;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 桌面版 preload 暴露的 window.ye 在 Android 上的原生实现（页面侧见 src/lib/androidHost.ts）。
 * 网络请求 / 文件 / 下载 / 本地音频代理 / 媒体会话都在这里，规则与桌面版主进程保持一致。
 */
@CapacitorPlugin(name = "YeNative")
public class YeNativePlugin extends Plugin {
    private static volatile WeakReference<YeNativePlugin> instance = new WeakReference<>(null);

    private final ExecutorService io = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "ye-native-io");
        t.setDaemon(true);
        return t;
    });
    private AudioProxy proxy;
    private Downloader downloader;
    private List<String> allowedHosts = new ArrayList<>();

    /** 播放服务 / 媒体按键 → 页面 */
    static void emitCommand(String command) {
        YeNativePlugin plugin = instance.get();
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("command", command);
        plugin.notifyListeners("mediaCommand", data);
    }

    @Override
    public void load() {
        instance = new WeakReference<>(this);
        final Context ctx = getContext();
        proxy = new AudioProxy(path -> LocalFiles.source(ctx, path));
        try {
            proxy.start();
        } catch (IOException ignored) {
            // 本地代理启动失败时 localAudioUrl / proxyAudioUrl 返回 null，页面会回退到直连
        }
        downloader = new Downloader(ctx, event -> {
            try {
                notifyListeners("downloadProgress", JSObject.fromJSONObject(event));
            } catch (JSONException ignored) { }
        });
        try (InputStream in = ctx.getAssets().open("proxy-hosts.json")) {
            JSONArray hosts = new JSONObject(new String(LocalFiles.drain(in), StandardCharsets.UTF_8)).optJSONArray("hosts");
            allowedHosts = LocalFiles.toList(hosts);
        } catch (Exception ignored) { }
    }

    @Override
    protected void handleOnDestroy() {
        if (proxy != null) proxy.stop();
        PlaybackService.stop(getContext());
    }

    // ---------------------------------------------------------------- 基础

    @PluginMethod
    public void version(PluginCall call) {
        String name = "android";
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            if (info.versionName != null) name = info.versionName;
        } catch (PackageManager.NameNotFoundException ignored) { }
        JSObject out = new JSObject();
        out.put("value", name);
        call.resolve(out);
    }

    @PluginMethod
    public void quit(PluginCall call) {
        PlaybackService.stop(getContext());
        Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(activity::finishAffinity);
        call.resolve();
    }

    @PluginMethod
    public void defaultPaths(PluginCall call) {
        File downloads = Downloader.defaultDir(getContext());
        // 应用内更新的安装包目录（cacheDir/updates，installApk 只接受这里面的文件）
        File updates = new File(getContext().getCacheDir(), "updates");
        //noinspection ResultOfMethodCallIgnored
        updates.mkdirs();
        JSObject out = new JSObject();
        out.put("downloads", downloads.getAbsolutePath());
        out.put("music", downloads.getParentFile() == null ? downloads.getAbsolutePath() : downloads.getParentFile().getAbsolutePath());
        out.put("userData", getContext().getFilesDir().getAbsolutePath());
        out.put("cache", updates.getAbsolutePath());
        call.resolve(out);
    }

    // ---------------------------------------------------------------- 网络

    private static Map<String, String> headersOf(JSONObject json) {
        Map<String, String> map = new LinkedHashMap<>();
        if (json == null) return map;
        Iterator<String> keys = json.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object value = json.opt(key);
            if (value != null && value != JSONObject.NULL) map.put(key, String.valueOf(value));
        }
        return map;
    }

    private static boolean looksLikeImage(byte[] b) {
        if (b == null || b.length < 4) return false;
        return ((b[0] & 0xff) == 0xff && (b[1] & 0xff) == 0xd8) || ((b[0] & 0xff) == 0x89 && b[1] == 0x50) || (b[0] == 0x47 && b[1] == 0x49)
                || (b.length > 8 && b[0] == 0x52 && b[1] == 0x49 && b[8] == 0x57);
    }

    private JSObject resultToJs(Net.Result res, boolean withBody) {
        JSObject o = new JSObject();
        o.put("ok", res.ok);
        o.put("status", res.status);
        o.put("statusMessage", res.statusMessage == null ? "" : res.statusMessage);
        if (res.error != null) o.put("error", res.error);
        if (res.url != null) o.put("url", res.url);
        JSObject headers = new JSObject();
        for (Map.Entry<String, String> e : res.headers.entrySet()) headers.put(e.getKey(), e.getValue());
        o.put("headers", headers);
        if (withBody && res.bytes != null) o.put("bodyBase64", Base64.encodeToString(res.bytes, Base64.NO_WRAP));
        return o;
    }

    private JSObject doRequest(String kind, JSONObject data) {
        Net.Req req = new Net.Req();
        req.url = data.optString("url", "");
        req.method = data.optString("method", "GET");
        req.headers = headersOf(data.optJSONObject("headers"));
        long timeout = data.optLong("timeoutMs", 0);
        req.timeoutMs = timeout > 0 ? timeout : 20000;
        req.followRedirects = data.optBoolean("followRedirects", true);
        String b64 = data.optString("bodyBase64", "");
        String text = data.has("bodyText") && !data.isNull("bodyText") ? data.optString("bodyText") : null;
        if (!b64.isEmpty()) req.body = Base64.decode(b64, Base64.DEFAULT);
        else if (text != null) req.body = text.getBytes(StandardCharsets.UTF_8);
        switch (kind) {
            case "image":
                req.headers.keySet().removeIf(k -> k.equalsIgnoreCase("content-length"));
                req.method = "GET";
                req.body = null;
                req.timeoutMs = 15000;
                req.maxBytes = 8L * 1024 * 1024;
                req.validator = Net.PUBLIC_ONLY;
                break;
            case "probe":
                req.method = "GET";
                req.body = null;
                req.range = 2;
                if (timeout <= 0) req.timeoutMs = 8000;
                req.validator = Net.PUBLIC_ONLY;
                break;
            case "plugin": {
                final List<String> blocked = LocalFiles.toList(data.optJSONArray("blockedHosts"));
                req.maxBytes = 24L * 1024 * 1024;
                req.validator = url -> {
                    if (!Net.isPublicHost(url.host())) return "host not allowed: " + url.host();
                    if (Net.hostMatches(url.host(), blocked)) return "blocked host: " + url.host();
                    return null;
                };
                break;
            }
            default: {
                final List<String> allowed = allowedHosts;
                req.maxBytes = 16L * 1024 * 1024;
                req.validator = url -> Net.hostMatches(url.host(), allowed) ? null : "host not allowed: " + url.host();
            }
        }
        Net.Result res = Net.request(req);
        if ("image".equals(kind) && res.ok) {
            String type = res.headers.get("content-type");
            if ((type == null || !type.toLowerCase(Locale.ROOT).startsWith("image/")) && !looksLikeImage(res.bytes)) {
                JSObject o = new JSObject();
                o.put("ok", false);
                o.put("status", res.status);
                o.put("error", "not an image");
                return o;
            }
        }
        if ("probe".equals(kind)) {
            JSObject o = new JSObject();
            o.put("ok", res.ok);
            o.put("status", res.status);
            if (res.error != null) o.put("error", res.error);
            o.put("contentType", res.headers.containsKey("content-type") ? res.headers.get("content-type") : "");
            if (res.url != null) o.put("url", res.url);
            return o;
        }
        return resultToJs(res, true);
    }

    @PluginMethod
    public void request(PluginCall call) {
        final String kind = call.getString("kind", "api");
        final JSONObject data = call.getData();
        io.execute(() -> {
            try {
                call.resolve(doRequest(kind, data));
            } catch (Exception e) {
                JSObject o = new JSObject();
                o.put("ok", false);
                o.put("status", 0);
                o.put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                call.resolve(o);
            }
        });
    }

    @PluginMethod
    public void proxyAudioUrl(PluginCall call) {
        String url = proxy == null ? null : proxy.proxyRemoteUrl(call.getString("url"), headersOf(call.getObject("headers")));
        JSObject out = new JSObject();
        out.put("url", url == null ? JSONObject.NULL : url);
        call.resolve(out);
    }

    @PluginMethod
    public void localAudioUrl(PluginCall call) {
        String url = proxy == null ? null : proxy.proxyLocalFile(call.getString("path"));
        JSObject out = new JSObject();
        out.put("url", url == null ? JSONObject.NULL : url);
        call.resolve(out);
    }

    // ---------------------------------------------------------------- 文件选择

    private void persist(Uri uri, boolean write) {
        int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | (write ? Intent.FLAG_GRANT_WRITE_URI_PERMISSION : 0);
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
        } catch (RuntimeException e) {
            if (write) {
                try { getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (RuntimeException ignored) { }
            }
        }
    }

    private static JSObject picked(boolean cancelled, List<String> paths) {
        JSObject out = new JSObject();
        out.put("cancelled", cancelled);
        JSArray array = new JSArray();
        for (String p : paths) array.put(p);
        out.put("paths", array);
        return out;
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "onFolderPicked");
    }

    @ActivityCallback
    private void onFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(picked(true, new ArrayList<>()));
            return;
        }
        Uri uri = data.getData();
        persist(uri, true);
        List<String> paths = new ArrayList<>();
        paths.add(uri.toString());
        call.resolve(picked(false, paths));
    }

    @PluginMethod
    public void pickFiles(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, call.getBoolean("multiple", false));
        List<String> exts = LocalFiles.toList(call.getArray("extensions"));
        List<String> mimes = new ArrayList<>();
        if (exts.contains("json")) {
            mimes.add("application/json");
            mimes.add("text/plain");
        }
        if (exts.contains("mp3") || exts.contains("flac")) {
            mimes.add("audio/*");
            mimes.add("application/ogg");
            mimes.add("application/x-flac");
        }
        if (!mimes.isEmpty()) {
            mimes.add("application/octet-stream"); // 部分文件管理器不认识 .flac / .json 的类型
            intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "onFilesPicked");
    }

    @ActivityCallback
    private void onFilesPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.resolve(picked(true, new ArrayList<>()));
            return;
        }
        List<Uri> uris = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        final List<String> paths = new ArrayList<>();
        io.execute(() -> {
            for (Uri uri : uris) {
                persist(uri, false);
                // 路径末尾带上真实文件名：页面按扩展名过滤、按末段取文件名
                paths.add(uri + "#/" + LocalFiles.displayNameOf(getContext(), uri));
            }
            call.resolve(picked(paths.isEmpty(), paths));
        });
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "YEmusic");
        String mime = name.toLowerCase(Locale.ROOT).endsWith(".json") ? "application/json" : "application/octet-stream";
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "onFileSaved");
    }

    @ActivityCallback
    private void onFileSaved(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        JSObject out = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            out.put("cancelled", true);
        } else {
            out.put("cancelled", false);
            out.put("filePath", data.getData().toString());
        }
        call.resolve(out);
    }

    // ---------------------------------------------------------------- 本地曲库

    @PluginMethod
    public void scanAudio(PluginCall call) {
        final List<String> dirs = LocalFiles.toList(call.getArray("dirs"));
        io.execute(() -> {
            try {
                JSObject out = new JSObject();
                out.put("files", LocalFiles.scanAudio(getContext(), dirs));
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "scan failed" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void readTags(PluginCall call) {
        final String path = call.getString("path", "");
        final boolean withCover = call.getBoolean("withCover", true);
        io.execute(() -> {
            try {
                call.resolve(JSObject.fromJSONObject(LocalFiles.readTags(getContext(), path, withCover)));
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "read tags failed" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void readSidecarLyric(PluginCall call) {
        final String path = call.getString("path", "");
        io.execute(() -> {
            try {
                JSONObject found = LocalFiles.readSidecarLyric(getContext(), path);
                JSObject out = new JSObject();
                out.put("found", found != null);
                if (found != null) {
                    out.put("encoding", found.getString("encoding"));
                    out.put("data", found.getString("data"));
                }
                call.resolve(out);
            } catch (Exception e) {
                JSObject out = new JSObject();
                out.put("found", false);
                call.resolve(out);
            }
        });
    }

    @PluginMethod
    public void exists(PluginCall call) {
        final String path = call.getString("path", "");
        io.execute(() -> {
            JSObject out = new JSObject();
            out.put("value", LocalFiles.exists(getContext(), path));
            call.resolve(out);
        });
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        final String path = call.getString("path", "");
        io.execute(() -> {
            try {
                JSObject out = new JSObject();
                out.put("data", Base64.encodeToString(LocalFiles.readAll(getContext(), path, 64L * 1024 * 1024), Base64.NO_WRAP));
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "read failed" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        final String path = call.getString("path", "");
        final String text = call.getString("dataText");
        final String b64 = call.getString("dataBase64");
        io.execute(() -> {
            try {
                byte[] bytes = b64 != null ? Base64.decode(b64, Base64.DEFAULT) : (text == null ? new byte[0] : text.getBytes(StandardCharsets.UTF_8));
                JSObject out = new JSObject();
                out.put("path", LocalFiles.write(getContext(), path, bytes));
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "write failed" : e.getMessage());
            }
        });
    }

    // ---------------------------------------------------------------- 下载

    @PluginMethod
    public void download(PluginCall call) {
        final JSONObject data = call.getData();
        io.execute(() -> {
            try {
                Downloader.Meta meta = null;
                JSONObject tags = data.optJSONObject("tags");
                if (tags != null) {
                    meta = new Downloader.Meta();
                    meta.title = tags.optString("title", "");
                    meta.artist = tags.optString("artist", "");
                    meta.album = tags.optString("album", "");
                    meta.lyric = tags.optString("lyric", "");
                    meta.cover = tags.optString("cover", "");
                }
                JSONObject started = downloader.start(data.optString("url", ""), data.optString("fileName", ""),
                        headersOf(data.optJSONObject("headers")), data.optString("saveDir", ""), meta);
                call.resolve(JSObject.fromJSONObject(started));
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "download failed" : e.getMessage());
            }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        JSObject out = new JSObject();
        out.put("value", downloader != null && downloader.cancel(call.getString("id", "")));
        call.resolve(out);
    }

    // ---------------------------------------------------------------- 系统

    private String viewIntent(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            getContext().startActivity(intent);
            return "";
        } catch (ActivityNotFoundException e) {
            return "没有可以打开该位置的应用";
        } catch (RuntimeException e) {
            return e.getMessage() == null ? "无法打开" : e.getMessage();
        }
    }

    @PluginMethod
    public void openPath(PluginCall call) {
        String path = call.getString("path", "");
        String error;
        if (LocalFiles.isContent(path)) {
            Uri uri = LocalFiles.uriOf(path);
            try {
                if (uri.getPathSegments().size() == 2 && "tree".equals(uri.getPathSegments().get(0))) {
                    uri = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri));
                }
            } catch (RuntimeException ignored) { }
            error = viewIntent(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, DocumentsContract.Document.MIME_TYPE_DIR));
        } else {
            error = "此位置位于应用专属目录，请在应用内的“本地音乐”中管理";
        }
        JSObject out = new JSObject();
        out.put("value", error);
        call.resolve(out);
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.toLowerCase(Locale.ROOT).matches("^https?:.*")) {
            call.reject("only http(s) URLs may be opened externally");
            return;
        }
        String error = viewIntent(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        if (error.isEmpty()) call.resolve();
        else call.reject(error);
    }

    // ---------------------------------------------------------------- 剪贴板 / 相册 / 其他应用

    /** 读取剪贴板里的文字（WebView 里的 navigator.clipboard.readText 经常被系统拒绝）。应用在前台时才读得到 */
    @PluginMethod
    public void readClipboard(PluginCall call) {
        String text = "";
        try {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null && cm.hasPrimaryClip()) {
                ClipData clip = cm.getPrimaryClip();
                if (clip != null && clip.getItemCount() > 0) {
                    CharSequence value = clip.getItemAt(0).coerceToText(getContext());
                    if (value != null) text = value.toString();
                }
            }
        } catch (RuntimeException ignored) { }
        JSObject out = new JSObject();
        out.put("text", text.length() > 20000 ? text.substring(0, 20000) : text);
        call.resolve(out);
    }

    /**
     * 把一张 PNG 存进系统相册（Pictures/YEmusic）。用于“同一台手机上登录”：保存登录二维码后，
     * 到 QQ / 微信 / 酷狗 / 网易云的“扫一扫”里选相册里的这张图。
     */
    @PluginMethod
    public void saveImage(PluginCall call) {
        final String b64 = call.getString("dataBase64", "");
        final String name = call.getString("name", "YEmusic.png").replaceAll("[^A-Za-z0-9._-]", "_");
        io.execute(() -> {
            try {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                if (bytes.length == 0) throw new IOException("图片为空");
                Context ctx = getContext();
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                    values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                    values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/YEmusic");
                    values.put(MediaStore.Images.Media.IS_PENDING, 1);
                    ContentResolver resolver = ctx.getContentResolver();
                    Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new IOException("无法在相册里创建文件");
                    try (OutputStream os = resolver.openOutputStream(uri)) {
                        if (os == null) throw new IOException("无法写入相册");
                        os.write(bytes);
                    }
                    values.clear();
                    values.put(MediaStore.Images.Media.IS_PENDING, 0);
                    resolver.update(uri, values, null, null);
                } else {
                    // Android 9 及以下写公共目录需要存储权限
                    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        Activity activity = getActivity();
                        if (activity != null) ActivityCompat.requestPermissions(activity, new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, 7301);
                        call.reject("需要存储权限：请在弹出的系统提示里允许，然后再点一次“保存二维码”");
                        return;
                    }
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "YEmusic");
                    if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("无法创建相册目录");
                    File file = new File(dir, name);
                    try (OutputStream os = new java.io.FileOutputStream(file)) {
                        os.write(bytes);
                    }
                    MediaScannerConnection.scanFile(ctx, new String[] { file.getAbsolutePath() }, new String[] { "image/png" }, null);
                }
                JSObject out = new JSObject();
                out.put("where", "相册 / Pictures / YEmusic");
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "保存失败" : e.getMessage());
            }
        });
    }

    /**
     * 打开另一个 App（登录时用它的“扫一扫”）。只接受下面这几个固定名字，不接收任意 URI。
     * 先试扫一扫的深链，不行再按包名启动；都没有返回 launched=false。
     */
    @PluginMethod
    public void launchApp(PluginCall call) {
        String app = call.getString("app", "");
        String scheme = null;
        String pkg;
        switch (app) {
            case "qq": pkg = "com.tencent.mobileqq"; scheme = "mqqapi://qrcode/scan_qrcode?version=1&src_type=app"; break;
            case "wechat": pkg = "com.tencent.mm"; scheme = "weixin://scanqrcode"; break;
            case "kugou": pkg = "com.kugou.android"; break;
            case "netease": pkg = "com.netease.cloudmusic"; break;
            case "qqmusic": pkg = "com.tencent.qqmusic"; break;
            default:
                call.reject("unknown app");
                return;
        }
        boolean launched = false;
        if (scheme != null) {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(scheme));
            intent.setPackage(pkg);
            launched = viewIntent(intent).isEmpty();
        }
        if (!launched) {
            Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
            if (intent != null) launched = viewIntent(intent).isEmpty();
        }
        JSObject out = new JSObject();
        out.put("launched", launched);
        call.resolve(out);
    }

    /**
     * 安装已下载好的 APK（应用内更新）。
     * 只接受 cacheDir/updates 下由本应用下载的文件；通过 FileProvider 以 content:// 共享给系统安装器
     * （Android 7+ 禁止跨应用传 file://）。用户在系统安装界面确认后才会真正安装，
     * 首次使用需要在系统设置里允许本应用“安装未知应用”。
     */
    @PluginMethod
    public void installApk(PluginCall call) {
        final String path = call.getString("path", "");
        io.execute(() -> {
            JSObject out = new JSObject();
            try {
                if (path.isEmpty()) {
                    out.put("value", false);
                    call.resolve(out);
                    return;
                }
                File apk = new File(path);
                // 限定在应用自己的缓存目录里，避免被拿来安装任意位置的文件
                File cache = getContext().getCacheDir();
                if (!apk.isFile() || !apk.getAbsolutePath().startsWith(cache.getAbsolutePath())) {
                    out.put("value", false);
                    call.resolve(out);
                    return;
                }
                Uri uri;
                if (Build.VERSION.SDK_INT >= 24) {
                    uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".apkprovider", apk);
                } else {
                    uri = Uri.fromFile(apk);
                }
                Intent intent = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getContext().startActivity(intent);
                out.put("value", true);
            } catch (Exception e) {
                out.put("value", false);
            }
            call.resolve(out);
        });
    }

    // ---------------------------------------------------------------- 媒体会话

    private static Bitmap decodeCover(String base64) {
        if (base64 == null || base64.isEmpty()) return null;
        try {
            byte[] raw = Base64.decode(base64, Base64.DEFAULT);
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(raw, 0, raw.length, bounds);
            int sample = 1;
            while (bounds.outWidth / sample > 1024 || bounds.outHeight / sample > 1024) sample *= 2;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            return BitmapFactory.decodeByteArray(raw, 0, raw.length, opts);
        } catch (Exception e) {
            return null;
        }
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        final Activity activity = getActivity();
        if (activity == null || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        SharedPreferences prefs = getContext().getSharedPreferences("ye", Context.MODE_PRIVATE);
        if (prefs.getBoolean("askedNotification", false)) return;
        prefs.edit().putBoolean("askedNotification", true).apply();
        activity.runOnUiThread(() -> ActivityCompat.requestPermissions(activity, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7001));
    }

    @PluginMethod
    public void setNowPlaying(PluginCall call) {
        final JSONObject data = call.getData();
        io.execute(() -> {
            PlaybackService.State s = new PlaybackService.State();
            s.hasTrack = data.optBoolean("hasTrack", true);
            s.title = data.optString("title", "");
            s.artist = data.optString("artist", "");
            s.album = data.optString("album", "");
            s.durationMs = Math.round(data.optDouble("duration", 0) * 1000);
            s.positionMs = Math.round(data.optDouble("position", 0) * 1000);
            s.playing = data.optBoolean("playing", false);
            s.keepCover = data.optBoolean("coverUnchanged", false);
            s.cover = s.keepCover ? null : decodeCover(data.optString("cover", ""));
            if (s.playing) askNotificationPermission();
            PlaybackService.update(getContext(), s);
            call.resolve();
        });
    }

    @PluginMethod
    public void clearNowPlaying(PluginCall call) {
        PlaybackService.stop(getContext());
        call.resolve();
    }
}
