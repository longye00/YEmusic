package app.yemusic.player;

import android.content.Context;
import android.net.Uri;
import android.os.Environment;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.Response;
import okhttp3.ResponseBody;

import org.json.JSONException;
import org.json.JSONObject;

/** 下载：流式写盘（.part 保护）→ 嵌入标签 → 落到目标位置，对应桌面版主进程的 ye:download。 */
final class Downloader {
    interface Sink {
        void emit(JSONObject event);
    }

    static final class Meta {
        String title = "";
        String artist = "";
        String album = "";
        String lyric = "";
        String cover = "";
    }

    private static final class Job {
        volatile boolean cancelled;
        volatile Response response;
    }

    private final Context ctx;
    private final Sink sink;
    private final ExecutorService pool = Executors.newFixedThreadPool(3, r -> {
        Thread t = new Thread(r, "ye-download");
        t.setDaemon(true);
        return t;
    });
    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    Downloader(Context ctx, Sink sink) {
        this.ctx = ctx.getApplicationContext();
        this.sink = sink;
    }

    static File defaultDir(Context ctx) {
        File base = ctx.getExternalFilesDir(Environment.DIRECTORY_MUSIC);
        if (base == null) base = new File(ctx.getFilesDir(), "Music");
        return new File(base, "YEmusic");
    }

    private String newId() {
        return "dl_" + Long.toString(System.currentTimeMillis(), 36) + "_" + Long.toString(random.nextInt(Integer.MAX_VALUE), 36);
    }

    /** 同步阶段：校验参数并确定目标位置；真正的下载在后台线程里进行 */
    JSONObject start(String url, String fileName, Map<String, String> headers, String saveDir, Meta meta) throws IOException, JSONException {
        if (url == null || !url.toLowerCase(Locale.ROOT).matches("^https?:.*")) throw new IOException("only http(s) downloads are allowed");
        if (fileName == null || fileName.isEmpty() || fileName.matches(".*[\\\\/].*") || fileName.contains("..")) throw new IOException("invalid file name");
        final String id = newId();
        final File plainTarget;
        final Uri safTarget;
        final String savePath;
        if (saveDir != null && LocalFiles.isContent(saveDir)) {
            safTarget = LocalFiles.createInTree(ctx, Uri.parse(saveDir), fileName);
            if (safTarget == null) throw new IOException("无法在所选文件夹中创建文件，请重新选择下载目录");
            plainTarget = null;
            savePath = safTarget + "#/" + fileName;
        } else {
            File dir = saveDir == null || saveDir.isEmpty() ? defaultDir(ctx) : new File(saveDir);
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建下载目录：" + dir);
            if (!dir.canWrite()) throw new IOException("下载目录不可写：" + dir);
            plainTarget = new File(dir, fileName);
            safTarget = null;
            savePath = plainTarget.getAbsolutePath();
        }
        final Job job = new Job();
        jobs.put(id, job);
        pool.execute(() -> run(id, job, url, headers, plainTarget, safTarget, savePath, meta));
        JSONObject out = new JSONObject();
        out.put("id", id);
        out.put("savePath", savePath);
        return out;
    }

    boolean cancel(String id) {
        Job job = jobs.remove(id);
        if (job == null) return false;
        job.cancelled = true;
        Response r = job.response;
        if (r != null) {
            try { r.close(); } catch (RuntimeException ignored) { }
        }
        return true;
    }

    private void emit(String id, String state, long received, long total, String savePath, String error) {
        try {
            JSONObject e = new JSONObject();
            e.put("id", id);
            e.put("state", state);
            if (!"error".equals(state)) {
                e.put("received", received);
                e.put("total", total);
            }
            if (savePath != null) e.put("savePath", savePath);
            if (error != null) e.put("error", error);
            sink.emit(e);
        } catch (JSONException ignored) { }
    }

    private void run(String id, Job job, String url, Map<String, String> headers, File plainTarget, Uri safTarget, String savePath, Meta meta) {
        File part = null;
        try {
            String[] err = new String[1];
            Response res = Net.openStream(url, headers, null, false, err);
            if (res == null) {
                emit(id, "error", 0, 0, null, err[0] == null ? "download failed" : err[0]);
                cleanupSaf(safTarget, true);
                return;
            }
            job.response = res;
            if (job.cancelled) { res.close(); cleanupSaf(safTarget, true); return; }
            int code = res.code();
            if (code != 200 && code != 206) {
                res.close();
                emit(id, "error", 0, 0, null, "HTTP " + code);
                cleanupSaf(safTarget, true);
                return;
            }
            ResponseBody body = res.body();
            long total = body == null ? 0 : Math.max(0, body.contentLength());
            if (plainTarget != null) {
                part = new File(plainTarget.getPath() + ".part");
            } else {
                File dir = new File(ctx.getCacheDir(), "downloads");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                part = new File(dir, id + ".part");
            }
            long received = 0;
            long lastEmit = 0;
            try (InputStream in = body.byteStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (job.cancelled) break;
                    out.write(buf, 0, n);
                    received += n;
                    long now = System.currentTimeMillis();
                    if (now - lastEmit > 150) {
                        lastEmit = now;
                        emit(id, "progress", received, total, null, null);
                    }
                }
            } finally {
                res.close();
            }
            if (job.cancelled) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                cleanupSaf(safTarget, true);
                return;
            }
            if (total > 0 && received < total) throw new IOException("连接中断");
            embedTags(part, meta);
            if (job.cancelled) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                cleanupSaf(safTarget, true);
                return;
            }
            if (plainTarget != null) {
                if (plainTarget.exists() && !plainTarget.delete()) throw new IOException("无法覆盖已有文件");
                if (!part.renameTo(plainTarget)) throw new IOException("无法保存文件");
            } else {
                try (InputStream in = new java.io.FileInputStream(part); OutputStream out = ctx.getContentResolver().openOutputStream(safTarget, "wt")) {
                    if (out == null) throw new IOException("无法写入所选文件夹");
                    byte[] buf = new byte[128 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                }
                //noinspection ResultOfMethodCallIgnored
                part.delete();
            }
            jobs.remove(id);
            emit(id, "done", received, total, savePath, null);
        } catch (Exception e) {
            if (part != null) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
            }
            cleanupSaf(safTarget, true);
            if (!job.cancelled) emit(id, "error", 0, 0, null, e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        } finally {
            jobs.remove(id);
        }
    }

    /** 失败 / 取消时清理提前创建的空文档 */
    private void cleanupSaf(Uri target, boolean onlyIfEmpty) {
        if (target == null) return;
        try {
            if (onlyIfEmpty) {
                try (android.content.res.AssetFileDescriptor afd = ctx.getContentResolver().openAssetFileDescriptor(target, "r")) {
                    if (afd != null && afd.getLength() > 0) return;
                }
            }
            android.provider.DocumentsContract.deleteDocument(ctx.getContentResolver(), target);
        } catch (Exception ignored) { }
    }

    private static boolean looksLikeImage(byte[] b) {
        if (b == null || b.length < 4) return false;
        return ((b[0] & 0xff) == 0xff && (b[1] & 0xff) == 0xd8) || ((b[0] & 0xff) == 0x89 && b[1] == 0x50) || (b[0] == 0x47 && b[1] == 0x49)
                || (b.length > 8 && b[0] == 0x52 && b[1] == 0x49 && b[8] == 0x57);
    }

    /** 下载完成后写入标签与封面；失败只忽略，不影响下载结果 */
    private void embedTags(File file, Meta meta) {
        if (meta == null) return;
        try {
            byte[] cover = null;
            if (meta.cover != null && meta.cover.toLowerCase(Locale.ROOT).matches("^https?:.*")) {
                Net.Req req = new Net.Req();
                req.url = meta.cover;
                req.timeoutMs = 10000;
                req.maxBytes = 6L * 1024 * 1024;
                req.validator = Net.PUBLIC_ONLY;
                Net.Result res = Net.request(req);
                if (res.ok && looksLikeImage(res.bytes)) cover = res.bytes;
            }
            TagWriter.Meta tags = new TagWriter.Meta();
            tags.title = meta.title;
            tags.artist = meta.artist;
            tags.album = meta.album;
            tags.lyric = meta.lyric;
            TagWriter.writeTags(file, tags, cover);
        } catch (Exception ignored) {
            // 标签写入失败不影响下载结果
        }
    }
}
