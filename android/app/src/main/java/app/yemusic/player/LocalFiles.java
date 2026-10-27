package app.yemusic.player;

import android.content.ContentResolver;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 本地文件访问层，对应桌面版 electron/library.cjs。
 *
 * 路径约定（渲染进程把它当作不透明字符串，只会做“按末尾扩展名过滤 / 取最后一段当文件名 / 前缀比较”）：
 *  - 普通文件：绝对路径（应用自己的下载目录等）；
 *  - SAF 文档：`content://…/document/<id>#/<显示名>`。fragment 只是为了让路径以真实文件名结尾，访问时会被去掉；
 *  - SAF 目录树：`content://…/tree/<id>`，其下所有文档地址都以它为前缀，因此 isInside() 前缀比较照常成立。
 */
final class LocalFiles {
    static final Pattern AUDIO_EXT = Pattern.compile("\\.(mp3|flac|wav|ogg|oga|opus|m4a|mp4|aac|webm|aiff|aif|wma|ape)$", Pattern.CASE_INSENSITIVE);
    private static final int SCAN_LIMIT = 20000;

    private LocalFiles() {}

    // ---------------------------------------------------------------- 路径工具

    static boolean isContent(String path) {
        return path != null && path.startsWith("content://");
    }

    static Uri uriOf(String path) {
        int i = path.indexOf("#/");
        return Uri.parse(i >= 0 ? path.substring(0, i) : path);
    }

    /** 路径末段（文件名）：优先取 fragment，其次取 URI 最后一段 */
    static String nameOf(String path) {
        int i = path.indexOf("#/");
        if (i >= 0) return path.substring(i + 2);
        if (isContent(path)) {
            String seg = Uri.parse(path).getLastPathSegment();
            if (seg == null) return "";
            int slash = Math.max(seg.lastIndexOf('/'), seg.lastIndexOf(':'));
            return slash >= 0 ? seg.substring(slash + 1) : seg;
        }
        return new File(path).getName();
    }

    static String extOf(String name) {
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot).toLowerCase(Locale.ROOT);
    }

    static String mimeOfName(String name) {
        switch (extOf(name)) {
            case ".mp3": return "audio/mpeg";
            case ".flac": return "audio/flac";
            case ".wav": return "audio/wav";
            case ".ogg": case ".oga": case ".opus": return "audio/ogg";
            case ".m4a": case ".mp4": return "audio/mp4";
            case ".aac": return "audio/aac";
            case ".wma": return "audio/x-ms-wma";
            case ".ape": return "audio/ape";
            case ".webm": return "audio/webm";
            case ".aiff": case ".aif": return "audio/aiff";
            case ".lrc": return "text/plain";
            default: return "application/octet-stream";
        }
    }

    static String stripExt(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    private static String str(Cursor c, int index) {
        return index < 0 || c.isNull(index) ? null : c.getString(index);
    }

    private static long num(Cursor c, int index) {
        return index < 0 || c.isNull(index) ? 0 : c.getLong(index);
    }

    // ---------------------------------------------------------------- 扫描

    static JSONArray scanAudio(Context ctx, List<String> dirs) throws JSONException {
        JSONArray out = new JSONArray();
        Set<String> seen = new HashSet<>();
        for (String dir : dirs) {
            if (dir == null || dir.isEmpty() || out.length() >= SCAN_LIMIT) continue;
            if (!seen.add(dir)) continue;
            try {
                if (isContent(dir)) scanTree(ctx, Uri.parse(dir), out);
                else scanDir(new File(dir), out);
            } catch (RuntimeException | JSONException e) {
                // 没有权限或目录已不存在：跳过，与桌面版一致
            }
        }
        return out;
    }

    private static void scanDir(File root, JSONArray out) throws JSONException {
        ArrayDeque<File> queue = new ArrayDeque<>();
        queue.add(root);
        Set<String> visited = new HashSet<>();
        while (!queue.isEmpty() && out.length() < SCAN_LIMIT) {
            File dir = queue.poll();
            String key;
            try { key = dir.getCanonicalPath(); } catch (IOException e) { key = dir.getAbsolutePath(); }
            if (!visited.add(key)) continue;
            File[] entries = dir.listFiles();
            if (entries == null) continue;
            for (File entry : entries) {
                String name = entry.getName();
                if (name.startsWith(".")) continue;
                if (entry.isDirectory()) {
                    queue.add(entry);
                } else if (entry.isFile() && AUDIO_EXT.matcher(name).find()) {
                    JSONObject item = new JSONObject();
                    item.put("path", entry.getAbsolutePath());
                    item.put("size", entry.length());
                    item.put("mtime", entry.lastModified());
                    item.put("folder", dir.getAbsolutePath());
                    out.put(item);
                    if (out.length() >= SCAN_LIMIT) break;
                }
            }
        }
    }

    private static final class Pending {
        final String docId;
        final String label;

        Pending(String docId, String label) {
            this.docId = docId;
            this.label = label;
        }
    }

    private static void scanTree(Context ctx, Uri tree, JSONArray out) throws JSONException {
        ContentResolver cr = ctx.getContentResolver();
        String rootId = DocumentsContract.isDocumentUri(ctx, tree) && tree.getPathSegments().size() >= 4
                ? DocumentsContract.getDocumentId(tree)
                : DocumentsContract.getTreeDocumentId(tree);
        String rootLabel = queryName(cr, DocumentsContract.buildDocumentUriUsingTree(tree, rootId));
        if (rootLabel == null || rootLabel.isEmpty()) rootLabel = prettyDocId(rootId);
        ArrayDeque<Pending> queue = new ArrayDeque<>();
        queue.add(new Pending(rootId, rootLabel));
        Set<String> visited = new HashSet<>();
        String[] projection = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        };
        while (!queue.isEmpty() && out.length() < SCAN_LIMIT) {
            Pending dir = queue.poll();
            if (!visited.add(dir.docId)) continue;
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dir.docId);
            try (Cursor c = cr.query(children, projection, null, null, null)) {
                if (c == null) continue;
                while (c.moveToNext()) {
                    String id = str(c, 0);
                    String name = str(c, 1);
                    String mime = str(c, 2);
                    if (id == null || name == null || name.startsWith(".")) continue;
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                        queue.add(new Pending(id, dir.label + "/" + name));
                    } else if (AUDIO_EXT.matcher(name).find()) {
                        JSONObject item = new JSONObject();
                        item.put("path", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString() + "#/" + name);
                        item.put("size", num(c, 3));
                        item.put("mtime", num(c, 4));
                        item.put("folder", dir.label);
                        out.put(item);
                        if (out.length() >= SCAN_LIMIT) break;
                    }
                }
            } catch (RuntimeException e) {
                // 子目录读取失败：跳过
            }
        }
    }

    private static String queryName(ContentResolver cr, Uri docUri) {
        try (Cursor c = cr.query(docUri, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return str(c, 0);
        } catch (RuntimeException ignored) { }
        return null;
    }

    /** primary:Music/Album → Music/Album；其余存储卷 1234-ABCD:Music → 1234-ABCD/Music */
    static String prettyDocId(String docId) {
        if (docId == null) return "";
        int colon = docId.indexOf(':');
        if (colon < 0) return docId;
        String volume = docId.substring(0, colon);
        String rest = docId.substring(colon + 1);
        if ("primary".equals(volume) || "home".equals(volume)) return rest.isEmpty() ? "内部存储" : rest;
        return rest.isEmpty() ? volume : volume + "/" + rest;
    }

    // ---------------------------------------------------------------- 打开 / 读写

    /** 打开文件的读取流（调用方负责关闭） */
    static InputStream openInput(Context ctx, String path) throws IOException {
        if (isContent(path)) {
            InputStream in = ctx.getContentResolver().openInputStream(uriOf(path));
            if (in == null) throw new FileNotFoundException(path);
            return in;
        }
        return new FileInputStream(path);
    }

    static byte[] readAll(Context ctx, String path, long limit) throws IOException {
        try (InputStream in = openInput(ctx, path)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream(64 * 1024);
            byte[] buf = new byte[32 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > limit) throw new IOException("file too large");
                bos.write(buf, 0, n);
            }
            return bos.toByteArray();
        }
    }

    static boolean exists(Context ctx, String path) {
        if (path == null || path.isEmpty()) return false;
        if (!isContent(path)) return new File(path).exists();
        try (AssetFileDescriptor afd = ctx.getContentResolver().openAssetFileDescriptor(uriOf(path), "r")) {
            return afd != null;
        } catch (Exception e) {
            return false;
        }
    }

    /** 写入文件；SAF 文档不存在时在同目录创建；返回最终路径 */
    static String write(Context ctx, String path, byte[] data) throws IOException {
        if (!isContent(path)) {
            File file = new File(path);
            File parent = file.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("cannot create directory");
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(data);
            }
            return file.getAbsolutePath();
        }
        ContentResolver cr = ctx.getContentResolver();
        Uri uri = uriOf(path);
        OutputStream out = null;
        try {
            out = cr.openOutputStream(uri, "wt");
        } catch (FileNotFoundException | SecurityException | IllegalArgumentException ignored) { }
        String finalPath = path;
        if (out == null) {
            // 文档还不存在（例如下载完成后写入同名 .lrc）：在同一目录下创建
            String name = nameOf(path);
            Uri created = createSibling(ctx, uri, name);
            if (created == null) throw new IOException("cannot create " + name);
            out = cr.openOutputStream(created, "wt");
            if (out == null) throw new IOException("cannot open " + name);
            finalPath = created + "#/" + name;
        }
        try (OutputStream o = out) {
            o.write(data);
        }
        return finalPath;
    }

    // ---------------------------------------------------------------- SAF 同级文件

    /** 取 SAF 文档所在目录的 docId（仅适用于 ExternalStorage 风格的路径型 docId），无法推断返回 null */
    private static String parentDocId(Uri docUri) {
        try {
            String id = DocumentsContract.getDocumentId(docUri);
            int slash = id.lastIndexOf('/');
            if (slash > 0) return id.substring(0, slash);
            int colon = id.indexOf(':');
            if (colon > 0 && colon < id.length() - 1) return id.substring(0, colon + 1); // 存储卷根目录
        } catch (RuntimeException ignored) { }
        return null;
    }

    private static Uri treeOf(Uri docUri) {
        try {
            String treeId = DocumentsContract.getTreeDocumentId(docUri);
            return DocumentsContract.buildTreeDocumentUri(docUri.getAuthority(), treeId);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** 在同目录中查找名为 name 的文件（忽略大小写） */
    static Uri findSibling(Context ctx, Uri docUri, String name) {
        Uri tree = treeOf(docUri);
        String parent = parentDocId(docUri);
        if (tree == null || parent == null) return null;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent);
        try (Cursor c = ctx.getContentResolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (c == null) return null;
            while (c.moveToNext()) {
                String childName = str(c, 1);
                if (childName != null && childName.equalsIgnoreCase(name)) return DocumentsContract.buildDocumentUriUsingTree(tree, str(c, 0));
            }
        } catch (RuntimeException ignored) { }
        return null;
    }

    static Uri createSibling(Context ctx, Uri docUri, String name) {
        Uri existing = findSibling(ctx, docUri, name);
        if (existing != null) return existing;
        Uri tree = treeOf(docUri);
        String parent = parentDocId(docUri);
        if (tree == null || parent == null) return null;
        try {
            return DocumentsContract.createDocument(ctx.getContentResolver(), DocumentsContract.buildDocumentUriUsingTree(tree, parent), mimeOfName(name), name);
        } catch (Exception e) {
            return null;
        }
    }

    /** 在目录树（或其子目录）中创建 / 复用文件，返回文档地址 */
    static Uri createInTree(Context ctx, Uri tree, String name) {
        ContentResolver cr = ctx.getContentResolver();
        String rootId = DocumentsContract.isDocumentUri(ctx, tree) && tree.getPathSegments().size() >= 4
                ? DocumentsContract.getDocumentId(tree)
                : DocumentsContract.getTreeDocumentId(tree);
        Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, rootId);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootId);
        try (Cursor c = cr.query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            while (c != null && c.moveToNext()) {
                String childName = str(c, 1);
                if (name.equals(childName)) return DocumentsContract.buildDocumentUriUsingTree(tree, str(c, 0));
            }
        } catch (RuntimeException ignored) { }
        try {
            return DocumentsContract.createDocument(cr, parent, mimeOfName(name), name);
        } catch (Exception e) {
            return null;
        }
    }

    // ---------------------------------------------------------------- 同名 .lrc

    /** 读取同名 .lrc；返回 {encoding, data(base64)} 或 null（与桌面版 readSidecarLyric 一致） */
    static JSONObject readSidecarLyric(Context ctx, String path) throws IOException, JSONException {
        byte[] buffer = null;
        String stem = stripExt(nameOf(path));
        if (isContent(path)) {
            Uri doc = uriOf(path);
            for (String ext : new String[]{".lrc", ".LRC", ".Lrc"}) {
                Uri sibling = findSibling(ctx, doc, stem + ext);
                if (sibling != null) {
                    try (InputStream in = ctx.getContentResolver().openInputStream(sibling)) {
                        if (in != null) buffer = drain(in);
                    }
                    break;
                }
            }
        } else {
            String base = path.substring(0, path.length() - extOf(path).length());
            for (String ext : new String[]{".lrc", ".LRC", ".Lrc"}) {
                File candidate = new File(base + ext);
                if (candidate.isFile()) {
                    try (InputStream in = new FileInputStream(candidate)) {
                        buffer = drain(in);
                    }
                    break;
                }
            }
        }
        if (buffer == null) return null;
        String encoding = "auto";
        int skip = 0;
        if (buffer.length >= 2 && (buffer[0] & 0xff) == 0xff && (buffer[1] & 0xff) == 0xfe) { encoding = "utf-16le"; skip = 2; }
        else if (buffer.length >= 3 && (buffer[0] & 0xff) == 0xef && (buffer[1] & 0xff) == 0xbb && (buffer[2] & 0xff) == 0xbf) { encoding = "utf-8"; skip = 3; }
        JSONObject out = new JSONObject();
        out.put("encoding", encoding);
        out.put("data", Base64.encodeToString(buffer, skip, buffer.length - skip, Base64.NO_WRAP));
        return out;
    }

    static byte[] drain(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(16 * 1024);
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) {
            bos.write(buf, 0, n);
            if (bos.size() > 8 * 1024 * 1024) throw new IOException("file too large");
        }
        return bos.toByteArray();
    }

    // ---------------------------------------------------------------- 标签

    private static String codecOf(String mime, String name) {
        String m = mime == null ? "" : mime.toLowerCase(Locale.ROOT);
        String ext = extOf(name);
        if (m.contains("mpeg") || ".mp3".equals(ext)) return "MP3";
        if (m.contains("flac") || ".flac".equals(ext)) return "FLAC";
        if (m.contains("opus") || ".opus".equals(ext)) return "Opus";
        if (m.contains("vorbis") || m.contains("ogg") || ".ogg".equals(ext) || ".oga".equals(ext)) return "Vorbis";
        if (".m4a".equals(ext) || ".mp4".equals(ext) || ".aac".equals(ext) || m.contains("mp4") || m.contains("aac")) return ".aac".equals(ext) ? "AAC" : "AAC / M4A";
        if (m.contains("wav") || ".wav".equals(ext)) return "WAV";
        if (".wma".equals(ext)) return "WMA";
        if (".ape".equals(ext)) return "APE";
        if (".aiff".equals(ext) || ".aif".equals(ext)) return "AIFF";
        if (".webm".equals(ext)) return "WebM";
        return ext.isEmpty() ? "" : ext.substring(1).toUpperCase(Locale.ROOT);
    }

    private static boolean losslessOf(String codec) {
        return "FLAC".equals(codec) || "WAV".equals(codec) || "APE".equals(codec) || "AIFF".equals(codec);
    }

    private static int parseInt(String text) {
        if (text == null) return 0;
        try {
            int slash = text.indexOf('/');
            return Integer.parseInt((slash >= 0 ? text.substring(0, slash) : text).trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String imageFormat(byte[] b) {
        if (b.length > 4 && (b[0] & 0xff) == 0x89 && b[1] == 0x50) return "image/png";
        if (b.length > 4 && b[0] == 0x47 && b[1] == 0x49) return "image/gif";
        if (b.length > 12 && b[0] == 0x52 && b[1] == 0x49 && b[8] == 0x57) return "image/webp";
        return "image/jpeg";
    }

    static JSONObject readTags(Context ctx, String path, boolean withCover) throws JSONException {
        JSONObject result = new JSONObject();
        result.put("path", path);
        result.put("title", "");
        result.put("artist", "");
        result.put("album", "");
        result.put("duration", 0);
        result.put("bitrate", 0);
        result.put("sampleRate", 0);
        result.put("codec", "");
        result.put("lossless", false);
        result.put("lyrics", "");
        result.put("cover", JSONObject.NULL);
        String name = nameOf(path);
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            if (isContent(path)) r.setDataSource(ctx, uriOf(path));
            else r.setDataSource(path);
            String title = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            String artist = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            if (artist == null || artist.isEmpty()) artist = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST);
            if (artist == null || artist.isEmpty()) artist = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_AUTHOR);
            String album = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
            String mime = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE);
            long durationMs = 0;
            try { durationMs = Long.parseLong(String.valueOf(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION))); } catch (NumberFormatException ignored) { }
            long bitrate = 0;
            try { bitrate = Long.parseLong(String.valueOf(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE))); } catch (NumberFormatException ignored) { }
            int sampleRate = 0;
            if (Build.VERSION.SDK_INT >= 31) sampleRate = parseInt(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_SAMPLERATE));
            String codec = codecOf(mime, name);
            result.put("title", title == null ? "" : title);
            result.put("artist", artist == null ? "" : artist);
            result.put("album", album == null ? "" : album);
            result.put("duration", durationMs / 1000.0);
            result.put("bitrate", bitrate);
            result.put("sampleRate", sampleRate);
            result.put("codec", codec);
            result.put("lossless", losslessOf(codec));
            result.put("track", parseInt(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER)));
            result.put("year", parseInt(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR)));
            if (withCover) {
                byte[] picture = r.getEmbeddedPicture();
                if (picture != null && picture.length > 0 && picture.length < 8 * 1024 * 1024) {
                    JSONObject cover = new JSONObject();
                    cover.put("data", Base64.encodeToString(picture, Base64.NO_WRAP));
                    cover.put("format", imageFormat(picture));
                    result.put("cover", cover);
                }
            }
        } catch (Exception e) {
            result.put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        } finally {
            try { r.release(); } catch (Exception ignored) { }
        }
        // 内嵌歌词：MediaMetadataRetriever 不提供，自己解析 ID3 USLT / FLAC Vorbis / MP4 ©lyr
        try (InputStream in = openInput(ctx, path)) {
            String lyrics = EmbeddedLyrics.read(in, extOf(name));
            if (lyrics != null && !lyrics.isEmpty()) result.put("lyrics", lyrics);
        } catch (Exception ignored) { }
        return result;
    }

    // ---------------------------------------------------------------- 音频代理的本地数据源

    static AudioProxy.LocalSource source(Context ctx, String path) throws IOException {
        final String name = nameOf(path);
        final String mime = mimeOfName(name);
        if (!isContent(path)) {
            final File file = new File(path);
            if (!file.isFile()) throw new FileNotFoundException(path);
            return new AudioProxy.LocalSource() {
                @Override public long length() { return file.length(); }
                @Override public InputStream open(long offset) throws IOException {
                    FileInputStream in = new FileInputStream(file);
                    if (offset > 0) in.getChannel().position(offset);
                    return in;
                }
                @Override public String mime() { return mime; }
            };
        }
        final ContentResolver cr = ctx.getContentResolver();
        final Uri uri = uriOf(path);
        final long[] length = {-2};
        return new AudioProxy.LocalSource() {
            @Override public long length() {
                if (length[0] != -2) return length[0];
                long value = -1;
                try (AssetFileDescriptor afd = cr.openAssetFileDescriptor(uri, "r")) {
                    if (afd != null) value = afd.getLength();
                } catch (Exception ignored) { }
                if (value < 0) {
                    try (Cursor c = cr.query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
                        if (c != null && c.moveToFirst() && !c.isNull(0)) value = c.getLong(0);
                    } catch (Exception ignored) { }
                }
                length[0] = value;
                return value;
            }

            @Override public InputStream open(long offset) throws IOException {
                final AssetFileDescriptor afd = cr.openAssetFileDescriptor(uri, "r");
                if (afd == null) throw new FileNotFoundException(path);
                final FileInputStream in = new FileInputStream(afd.getFileDescriptor());
                final long base = afd.getStartOffset();
                boolean positioned = false;
                try {
                    in.getChannel().position(base + offset);
                    positioned = true;
                } catch (IOException ignored) {
                    // 管道类文件不支持随机定位：退化为顺序跳过
                }
                if (!positioned && offset > 0) {
                    long left = offset;
                    while (left > 0) {
                        long skipped = in.skip(left);
                        if (skipped <= 0) break;
                        left -= skipped;
                    }
                }
                return new InputStream() {
                    @Override public int read() throws IOException { return in.read(); }
                    @Override public int read(byte[] b, int off, int len) throws IOException { return in.read(b, off, len); }
                    @Override public int available() throws IOException { return in.available(); }
                    @Override public void close() throws IOException {
                        try { in.close(); } finally { afd.close(); }
                    }
                };
            }

            @Override public String mime() { return mime; }
        };
    }

    /** 应用选择文件 / 目录后查询显示名，用来拼出以真实文件名结尾的路径 */
    static String displayNameOf(Context ctx, Uri uri) {
        try (Cursor c = ctx.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (RuntimeException ignored) { }
        String seg = uri.getLastPathSegment();
        return seg == null ? "audio" : seg.substring(Math.max(seg.lastIndexOf('/'), seg.lastIndexOf(':')) + 1);
    }

    static List<String> toList(JSONArray array) {
        List<String> list = new ArrayList<>();
        if (array == null) return list;
        for (int i = 0; i < array.length(); i++) {
            String value = array.optString(i, "");
            if (!value.isEmpty()) list.add(value);
        }
        return list;
    }
}
