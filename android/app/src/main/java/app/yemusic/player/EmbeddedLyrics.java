package app.yemusic.player;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/**
 * 读取音频文件内嵌的歌词（MediaMetadataRetriever 不提供）：
 * MP3 的 ID3v2 USLT、FLAC 的 Vorbis Comment（LYRICS / UNSYNCEDLYRICS）、M4A 的 ©lyr。
 * 任何解析问题都当作“没有内嵌歌词”处理。
 */
final class EmbeddedLyrics {
    private static final int MAX_BLOCK = 16 * 1024 * 1024;

    private EmbeddedLyrics() {}

    static String read(InputStream in, String ext) throws IOException {
        switch (ext) {
            case ".mp3": return readId3(in);
            case ".flac": return readFlac(in);
            case ".m4a": case ".mp4": return readMp4(in);
            default: return null;
        }
    }

    // ---------------------------------------------------------------- 工具

    static byte[] readFully(InputStream in, int length) throws IOException {
        byte[] buf = new byte[length];
        int off = 0;
        while (off < length) {
            int n = in.read(buf, off, length - off);
            if (n < 0) throw new EOFException();
            off += n;
        }
        return buf;
    }

    static void skipFully(InputStream in, long length) throws IOException {
        long left = length;
        while (left > 0) {
            long n = in.skip(left);
            if (n <= 0) {
                if (in.read() < 0) throw new EOFException();
                n = 1;
            }
            left -= n;
        }
    }

    private static int u32be(byte[] b, int o) {
        return ((b[o] & 0xff) << 24) | ((b[o + 1] & 0xff) << 16) | ((b[o + 2] & 0xff) << 8) | (b[o + 3] & 0xff);
    }

    private static int u32le(byte[] b, int o) {
        return (b[o] & 0xff) | ((b[o + 1] & 0xff) << 8) | ((b[o + 2] & 0xff) << 16) | ((b[o + 3] & 0xff) << 24);
    }

    private static int synchsafe(byte[] b, int o) {
        return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
    }

    private static String strictUtf8(byte[] data, int off, int len) {
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(data, off, len)).toString();
        } catch (CharacterCodingException e) {
            return null;
        }
    }

    // ---------------------------------------------------------------- ID3v2

    private static String decodeId3Text(byte[] data, int off, int len, int encoding) {
        if (len <= 0) return "";
        switch (encoding) {
            case 1: {
                if (len >= 2 && (data[off] & 0xff) == 0xff && (data[off + 1] & 0xff) == 0xfe) return new String(data, off + 2, len - 2, StandardCharsets.UTF_16LE);
                if (len >= 2 && (data[off] & 0xff) == 0xfe && (data[off + 1] & 0xff) == 0xff) return new String(data, off + 2, len - 2, StandardCharsets.UTF_16BE);
                return new String(data, off, len, StandardCharsets.UTF_16LE);
            }
            case 2: return new String(data, off, len, StandardCharsets.UTF_16BE);
            case 3: return new String(data, off, len, StandardCharsets.UTF_8);
            default: {
                // “ISO-8859-1” 标签在国内实际常常是 UTF-8 或 GBK
                String utf8 = strictUtf8(data, off, len);
                if (utf8 != null) return utf8;
                try { return new String(data, off, len, Charset.forName("GBK")); } catch (Exception e) { return new String(data, off, len, StandardCharsets.ISO_8859_1); }
            }
        }
    }

    private static String parseUslt(byte[] f, int off, int len) {
        if (len < 5) return null;
        int encoding = f[off] & 0xff;
        int o = off + 4; // 编码(1) + 语言(3)
        int end = off + len;
        // 跳过内容描述（以对应编码的终止符结尾）
        if (encoding == 1 || encoding == 2) {
            while (o + 1 < end && !(f[o] == 0 && f[o + 1] == 0)) o += 2;
            o += 2;
        } else {
            while (o < end && f[o] != 0) o++;
            o += 1;
        }
        if (o > end) return null;
        String text = decodeId3Text(f, o, end - o, encoding);
        return text.trim().isEmpty() ? null : text;
    }

    private static byte[] deunsync(byte[] in, int len) {
        byte[] out = new byte[len];
        int n = 0;
        for (int i = 0; i < len; i++) {
            out[n++] = in[i];
            if ((in[i] & 0xff) == 0xff && i + 1 < len && in[i + 1] == 0) i++;
        }
        byte[] trimmed = new byte[n];
        System.arraycopy(out, 0, trimmed, 0, n);
        return trimmed;
    }

    static String readId3(InputStream in) throws IOException {
        byte[] h = readFully(in, 10);
        if (h[0] != 'I' || h[1] != 'D' || h[2] != '3') return null;
        int version = h[3] & 0xff;
        int flags = h[5] & 0xff;
        int size = synchsafe(h, 6);
        if (size <= 0 || size > MAX_BLOCK) return null;
        byte[] tag = readFully(in, size);
        int len = size;
        if ((flags & 0x80) != 0 && version < 4) { // 整个标签做过非同步化
            tag = deunsync(tag, size);
            len = tag.length;
        }
        int o = 0;
        if ((flags & 0x40) != 0 && version >= 3 && len >= 4) {
            o = version == 4 ? synchsafe(tag, 0) : u32be(tag, 0) + 4;
        }
        if (version == 2) {
            while (o + 6 <= len) {
                String id = new String(tag, o, 3, StandardCharsets.ISO_8859_1);
                int fsize = ((tag[o + 3] & 0xff) << 16) | ((tag[o + 4] & 0xff) << 8) | (tag[o + 5] & 0xff);
                if (fsize <= 0 || o + 6 + fsize > len || !id.matches("[A-Z0-9]{3}")) break;
                if ("ULT".equals(id)) return parseUslt(tag, o + 6, fsize);
                o += 6 + fsize;
            }
            return null;
        }
        while (o + 10 <= len) {
            String id = new String(tag, o, 4, StandardCharsets.ISO_8859_1);
            if (!id.matches("[A-Z0-9]{4}")) break;
            int fsize = version == 4 ? synchsafe(tag, o + 4) : u32be(tag, o + 4);
            int fflags = ((tag[o + 8] & 0xff) << 8) | (tag[o + 9] & 0xff);
            if (fsize <= 0 || o + 10 + fsize > len) break;
            if ("USLT".equals(id)) {
                int start = o + 10;
                int flen = fsize;
                boolean compressedOrEncrypted = version == 4 ? (fflags & 0x000c) != 0 : (fflags & 0x00c0) != 0;
                if (!compressedOrEncrypted) {
                    if (version == 4 && (fflags & 0x0001) != 0 && flen > 4) { start += 4; flen -= 4; }
                    byte[] body = tag;
                    int bodyStart = start;
                    int bodyLen = flen;
                    if (version == 4 && (fflags & 0x0002) != 0) {
                        body = deunsync(java.util.Arrays.copyOfRange(tag, start, start + flen), flen);
                        bodyStart = 0;
                        bodyLen = body.length;
                    }
                    return parseUslt(body, bodyStart, bodyLen);
                }
            }
            o += 10 + fsize;
        }
        return null;
    }

    // ---------------------------------------------------------------- FLAC

    static String readFlac(InputStream in) throws IOException {
        byte[] magic = readFully(in, 4);
        if (magic[0] != 'f' || magic[1] != 'L' || magic[2] != 'a' || magic[3] != 'C') return null;
        while (true) {
            byte[] head = readFully(in, 4);
            boolean last = (head[0] & 0x80) != 0;
            int type = head[0] & 0x7f;
            int length = ((head[1] & 0xff) << 16) | ((head[2] & 0xff) << 8) | (head[3] & 0xff);
            if (type == 4) {
                if (length > MAX_BLOCK) return null;
                return parseVorbis(readFully(in, length));
            }
            skipFully(in, length);
            if (last) return null;
        }
    }

    private static String parseVorbis(byte[] d) {
        try {
            int o = 0;
            int vendor = u32le(d, o);
            o += 4 + vendor;
            int count = u32le(d, o);
            o += 4;
            String found = null;
            for (int i = 0; i < count && o + 4 <= d.length; i++) {
                int length = u32le(d, o);
                o += 4;
                if (length < 0 || o + length > d.length) break;
                String entry = new String(d, o, length, StandardCharsets.UTF_8);
                o += length;
                int eq = entry.indexOf('=');
                if (eq <= 0) continue;
                String key = entry.substring(0, eq).toUpperCase(java.util.Locale.ROOT);
                if (key.equals("LYRICS") || key.equals("UNSYNCEDLYRICS")) {
                    String value = entry.substring(eq + 1);
                    if (!value.trim().isEmpty()) {
                        found = value;
                        if (key.equals("LYRICS")) return found;
                    }
                }
            }
            return found;
        } catch (RuntimeException e) {
            return null;
        }
    }

    // ---------------------------------------------------------------- MP4 / M4A

    static String readMp4(InputStream in) throws IOException {
        while (true) {
            byte[] head = readFully(in, 8);
            long size = u32be(head, 0) & 0xffffffffL;
            String type = new String(head, 4, 4, StandardCharsets.ISO_8859_1);
            long headerLen = 8;
            if (size == 1) {
                byte[] ext = readFully(in, 8);
                size = ((long) u32be(ext, 0) << 32) | (u32be(ext, 4) & 0xffffffffL);
                headerLen = 16;
            } else if (size == 0) {
                return null;
            }
            long payload = size - headerLen;
            if (payload < 0) return null;
            if ("moov".equals(type)) {
                if (payload > MAX_BLOCK * 2L) return null;
                byte[] moov = readFully(in, (int) payload);
                return findLyr(moov, 0, moov.length, 0);
            }
            skipFully(in, payload);
        }
    }

    private static final String[] PATH = {"udta", "meta", "ilst", "\u00a9lyr", "data"};

    private static String findLyr(byte[] d, int start, int end, int depth) {
        int o = start;
        while (o + 8 <= end) {
            long size = u32be(d, o) & 0xffffffffL;
            String type = new String(d, o + 4, 4, StandardCharsets.ISO_8859_1);
            int header = 8;
            if (size == 1) {
                if (o + 16 > end) return null;
                size = ((long) u32be(d, o + 8) << 32) | (u32be(d, o + 12) & 0xffffffffL);
                header = 16;
            } else if (size == 0) {
                size = end - o;
            }
            if (size < header || o + size > end) return null;
            int payloadStart = o + header;
            int boxEnd = (int) (o + size);
            if (depth < PATH.length && type.equals(PATH[depth])) {
                if (depth == PATH.length - 1) {
                    // data 盒：类型(4) + 区域(4) + 文本
                    if (boxEnd - payloadStart > 8) {
                        String text = new String(d, payloadStart + 8, boxEnd - payloadStart - 8, StandardCharsets.UTF_8);
                        return text.trim().isEmpty() ? null : text;
                    }
                    return null;
                }
                int childStart = "meta".equals(type) ? payloadStart + 4 : payloadStart;
                String found = findLyr(d, childStart, boxEnd, depth + 1);
                if (found != null) return found;
            } else if (depth == 0 && "udta".equals(PATH[0]) && !type.equals("udta")) {
                // moov 下的其它盒子（trak 等）直接跳过
            }
            o = boxEnd;
        }
        return null;
    }
}
