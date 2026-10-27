package app.yemusic.player;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 为下载的音频写入标签：标题 / 歌手 / 专辑 / 封面 / 歌词，对应桌面版 electron/tags.cjs（逐行移植）。
 * MP3 写 ID3v2.3，FLAC 写 Vorbis Comment + PICTURE；其他容器保持原样。
 * 只把标签区读进内存，音频数据以流的方式拷贝，避免大文件占满堆内存。
 */
final class TagWriter {
    static final class Meta {
        String title = "";
        String artist = "";
        String album = "";
        String lyric = "";
    }

    private static final Set<String> OWN_ID3 = new HashSet<>(Arrays.asList("TIT2", "TPE1", "TALB", "USLT", "APIC"));
    private static final Set<String> OWN_VORBIS = new HashSet<>(Arrays.asList("TITLE", "ARTIST", "ALBUM", "LYRICS", "UNSYNCEDLYRICS"));
    private static final Pattern FRAME_ID = Pattern.compile("^[A-Z0-9]{4}$");
    private static final int MAX_HEADER = 64 * 1024 * 1024;

    private TagWriter() {}

    // ---------------------------------------------------------------- 字节工具

    private static byte[] synchsafe(int n) {
        return new byte[]{(byte) ((n >> 21) & 0x7f), (byte) ((n >> 14) & 0x7f), (byte) ((n >> 7) & 0x7f), (byte) (n & 0x7f)};
    }

    private static int readSynchsafe(byte[] b, int o) {
        return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
    }

    private static byte[] utf16(String text) {
        byte[] body = text.getBytes(StandardCharsets.UTF_16LE);
        byte[] out = new byte[body.length + 2];
        out[0] = (byte) 0xff;
        out[1] = (byte) 0xfe;
        System.arraycopy(body, 0, out, 2, body.length);
        return out;
    }

    private static byte[] u32be(long n) {
        return new byte[]{(byte) (n >>> 24), (byte) (n >>> 16), (byte) (n >>> 8), (byte) n};
    }

    private static byte[] u32le(long n) {
        return new byte[]{(byte) n, (byte) (n >>> 8), (byte) (n >>> 16), (byte) (n >>> 24)};
    }

    private static byte[] concat(byte[]... parts) {
        int total = 0;
        for (byte[] p : parts) total += p.length;
        byte[] out = new byte[total];
        int o = 0;
        for (byte[] p : parts) {
            System.arraycopy(p, 0, out, o, p.length);
            o += p.length;
        }
        return out;
    }

    private static String imageMime(byte[] b) {
        if (b.length > 1 && (b[0] & 0xff) == 0x89 && b[1] == 0x50) return "image/png";
        if (b.length > 1 && b[0] == 0x47 && b[1] == 0x49) return "image/gif";
        if (b.length > 8 && b[0] == 0x52 && b[1] == 0x49 && b[8] == 0x57) return "image/webp";
        return "image/jpeg";
    }

    private static boolean notEmpty(String s) {
        return s != null && !s.isEmpty();
    }

    // ---------------------------------------------------------------- ID3v2.3

    private static byte[] id3Frame(String id, byte[] body) {
        return concat(id.getBytes(StandardCharsets.ISO_8859_1), u32be(body.length), new byte[]{0, 0}, body);
    }

    private static final class Frame {
        final String id;
        final byte[] raw;

        Frame(String id, byte[] raw) {
            this.id = id;
            this.raw = raw;
        }
    }

    /** 解析已有 ID3v2.3 标签中我们不覆盖的帧（v2.2/v2.4、带非同步化或扩展头的标签直接丢弃） */
    static List<Frame> existingId3Frames(byte[] buf, int tagEnd) {
        List<Frame> frames = new ArrayList<>();
        int version = buf[3] & 0xff;
        int flags = buf[5] & 0xff;
        if (version != 3 || (flags & 0xc0) != 0) return frames;
        int o = 10;
        while (o + 10 <= tagEnd) {
            String id = new String(buf, o, 4, StandardCharsets.ISO_8859_1);
            if (!FRAME_ID.matcher(id).matches()) break;
            long size = ((buf[o + 4] & 0xffL) << 24) | ((buf[o + 5] & 0xff) << 16) | ((buf[o + 6] & 0xff) << 8) | (buf[o + 7] & 0xff);
            if (size <= 0 || o + 10 + size > tagEnd) break;
            frames.add(new Frame(id, Arrays.copyOfRange(buf, o, (int) (o + 10 + size))));
            o += 10 + (int) size;
        }
        return frames;
    }

    private static boolean writeMp3(RandomAccessFile raf, File out, Meta tags, byte[] cover) throws IOException {
        long length = raf.length();
        if (length < 4) return false;
        byte[] head = new byte[10];
        raf.seek(0);
        int headRead = raf.read(head, 0, (int) Math.min(10, length));
        long audioStart = 0;
        List<Frame> kept = new ArrayList<>();
        if (headRead >= 10 && head[0] == 'I' && head[1] == 'D' && head[2] == '3') {
            int size = readSynchsafe(head, 6);
            int footer = (head[5] & 0x10) != 0 ? 10 : 0;
            if (size < 0 || size > MAX_HEADER) return false;
            audioStart = Math.min(length, 10L + size + footer);
            int tagLen = (int) Math.min(length, 10L + size);
            byte[] tag = new byte[tagLen];
            raf.seek(0);
            raf.readFully(tag);
            kept = existingId3Frames(tag, tagLen);
        } else if (!((head[0] & 0xff) == 0xff && (head[1] & 0xe0) == 0xe0)) {
            return false; // 不是 MP3
        }
        // 只替换本次确实要写入的帧；例如没拿到新封面时保留原有封面
        List<byte[]> frames = new ArrayList<>();
        for (Frame f : kept) {
            boolean replacing = (f.id.equals("TIT2") && notEmpty(tags.title)) || (f.id.equals("TPE1") && notEmpty(tags.artist))
                    || (f.id.equals("TALB") && notEmpty(tags.album)) || (f.id.equals("USLT") && notEmpty(tags.lyric)) || (f.id.equals("APIC") && cover != null);
            if (!OWN_ID3.contains(f.id) || !replacing) frames.add(f.raw);
        }
        if (notEmpty(tags.title)) frames.add(id3Frame("TIT2", concat(new byte[]{1}, utf16(tags.title))));
        if (notEmpty(tags.artist)) frames.add(id3Frame("TPE1", concat(new byte[]{1}, utf16(tags.artist))));
        if (notEmpty(tags.album)) frames.add(id3Frame("TALB", concat(new byte[]{1}, utf16(tags.album))));
        if (notEmpty(tags.lyric)) frames.add(id3Frame("USLT", concat(new byte[]{1}, "XXX".getBytes(StandardCharsets.ISO_8859_1), utf16(""), new byte[]{0, 0}, utf16(tags.lyric))));
        if (cover != null) frames.add(id3Frame("APIC", concat(new byte[]{0}, imageMime(cover).getBytes(StandardCharsets.ISO_8859_1), new byte[]{0, 3, 0}, cover)));
        int bodyLength = 1024;
        for (byte[] f : frames) bodyLength += f.length;
        try (OutputStream os = new BufferedOutputStream(new FileOutputStream(out), 64 * 1024)) {
            os.write(new byte[]{'I', 'D', '3', 3, 0, 0});
            os.write(synchsafe(bodyLength));
            for (byte[] f : frames) os.write(f);
            os.write(new byte[1024]);
            copyRest(raf, audioStart, os);
        }
        return true;
    }

    // ---------------------------------------------------------------- FLAC

    private static final class Block {
        final int type;
        final byte[] data;

        Block(int type, byte[] data) {
            this.type = type;
            this.data = data;
        }
    }

    private static List<String> parseVorbis(byte[] d) {
        List<String> list = new ArrayList<>();
        try {
            int o = 0;
            long vendor = leInt(d, o) & 0xffffffffL;
            o += 4 + (int) vendor;
            long count = leInt(d, o) & 0xffffffffL;
            o += 4;
            for (long i = 0; i < count && o + 4 <= d.length; i++) {
                int len = leInt(d, o);
                o += 4;
                if (len < 0 || o + len > d.length) break;
                list.add(new String(d, o, len, StandardCharsets.UTF_8));
                o += len;
            }
        } catch (RuntimeException e) {
            return new ArrayList<>();
        }
        return list;
    }

    private static int leInt(byte[] b, int o) {
        return (b[o] & 0xff) | ((b[o + 1] & 0xff) << 8) | ((b[o + 2] & 0xff) << 16) | ((b[o + 3] & 0xff) << 24);
    }

    private static boolean writeFlac(RandomAccessFile raf, File out, Meta tags, byte[] cover) throws IOException {
        long length = raf.length();
        if (length < 8) return false;
        byte[] magic = new byte[4];
        raf.seek(0);
        raf.readFully(magic);
        if (!(magic[0] == 'f' && magic[1] == 'L' && magic[2] == 'a' && magic[3] == 'C')) return false;
        List<Block> blocks = new ArrayList<>();
        long o = 4;
        boolean last = false;
        long total = 0;
        while (!last && o + 4 <= length) {
            raf.seek(o);
            int head = raf.readUnsignedByte();
            last = (head & 0x80) != 0;
            int len = (raf.readUnsignedByte() << 16) | (raf.readUnsignedByte() << 8) | raf.readUnsignedByte();
            if (o + 4 + len > length) return false;
            total += len;
            if (total > MAX_HEADER) return false;
            byte[] data = new byte[len];
            raf.readFully(data);
            blocks.add(new Block(head & 0x7f, data));
            o += 4 + len;
        }
        if (blocks.isEmpty() || blocks.get(0).type != 0) return false; // 第一个块必须是 STREAMINFO
        Block oldVorbis = null;
        for (Block b : blocks) if (b.type == 4) { oldVorbis = b; break; }
        List<String> comments = new ArrayList<>();
        for (String c : parseVorbis(oldVorbis == null ? new byte[0] : oldVorbis.data)) {
            String key = c.split("=", 2)[0].toUpperCase(Locale.ROOT);
            boolean replacing = (key.equals("TITLE") && notEmpty(tags.title)) || (key.equals("ARTIST") && notEmpty(tags.artist))
                    || (key.equals("ALBUM") && notEmpty(tags.album)) || ((key.equals("LYRICS") || key.equals("UNSYNCEDLYRICS")) && notEmpty(tags.lyric));
            if (!OWN_VORBIS.contains(key) || !replacing) comments.add(c);
        }
        if (notEmpty(tags.title)) comments.add("TITLE=" + tags.title);
        if (notEmpty(tags.artist)) comments.add("ARTIST=" + tags.artist);
        if (notEmpty(tags.album)) comments.add("ALBUM=" + tags.album);
        if (notEmpty(tags.lyric)) comments.add("LYRICS=" + tags.lyric);
        byte[] vendor = "YEmusic".getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream vorbis = new ByteArrayOutputStream();
        vorbis.write(u32le(vendor.length));
        vorbis.write(vendor);
        vorbis.write(u32le(comments.size()));
        for (String c : comments) {
            byte[] b = c.getBytes(StandardCharsets.UTF_8);
            vorbis.write(u32le(b.length));
            vorbis.write(b);
        }
        List<Block> result = new ArrayList<>();
        for (Block b : blocks) {
            if (b.type == 4 || b.type == 1 || (b.type == 6 && cover != null)) continue;
            result.add(b);
        }
        result.add(new Block(4, vorbis.toByteArray()));
        if (cover != null && cover.length < 0xffffff - 64) {
            byte[] mime = imageMime(cover).getBytes(StandardCharsets.ISO_8859_1);
            result.add(new Block(6, concat(u32be(3), u32be(mime.length), mime, u32be(0), u32be(0), u32be(0), u32be(0), u32be(0), u32be(cover.length), cover)));
        }
        result.add(new Block(1, new byte[1024]));
        for (Block b : result) if (b.data.length > 0xffffff) return false;
        try (OutputStream os = new BufferedOutputStream(new FileOutputStream(out), 64 * 1024)) {
            os.write(new byte[]{'f', 'L', 'a', 'C'});
            for (int i = 0; i < result.size(); i++) {
                Block b = result.get(i);
                os.write((i == result.size() - 1 ? 0x80 : 0) | b.type);
                os.write((b.data.length >> 16) & 0xff);
                os.write((b.data.length >> 8) & 0xff);
                os.write(b.data.length & 0xff);
                os.write(b.data);
            }
            copyRest(raf, o, os);
        }
        return true;
    }

    private static void copyRest(RandomAccessFile raf, long from, OutputStream os) throws IOException {
        raf.seek(from);
        byte[] buf = new byte[128 * 1024];
        int n;
        while ((n = raf.read(buf)) != -1) os.write(buf, 0, n);
    }

    // ---------------------------------------------------------------- 入口

    private static String clip(String text, int max) {
        String s = text == null ? "" : text;
        return s.length() > max ? s.substring(0, max) : s;
    }

    /** @return 是否写入成功；不支持的容器 / 解析失败返回 false，原文件保持不变 */
    static boolean writeTags(File file, Meta input, byte[] cover) throws IOException {
        Meta clean = new Meta();
        clean.title = clip(input.title, 500);
        clean.artist = clip(input.artist, 500);
        clean.album = clip(input.album, 500);
        clean.lyric = clip(input.lyric, 200000);
        File tmp = new File(file.getParentFile(), file.getName() + ".tag");
        boolean written;
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            written = writeFlac(raf, tmp, clean, cover) || writeMp3(raf, tmp, clean, cover);
        } catch (IOException | RuntimeException e) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            throw e instanceof IOException ? (IOException) e : new IOException(e);
        }
        if (!written) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            return false;
        }
        if (!tmp.renameTo(file)) {
            if (!file.delete() || !tmp.renameTo(file)) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                throw new IOException("cannot replace " + file.getName());
            }
        }
        return true;
    }
}
