/**
 * 为下载的音频写入标签：标题 / 歌手 / 专辑 / 封面 / 歌词。
 * MP3 写 ID3v2.3（Windows 资源管理器与绝大多数播放器兼容），FLAC 写 Vorbis Comment + PICTURE。
 * 其他容器（m4a/ogg 等）保持原样。任何解析失败都返回 false，不影响下载本身。
 */
const fsp = require('node:fs/promises');

const OWN_ID3 = new Set(['TIT2', 'TPE1', 'TALB', 'USLT', 'APIC']);
const OWN_VORBIS = new Set(['TITLE', 'ARTIST', 'ALBUM', 'LYRICS', 'UNSYNCEDLYRICS']);

const synchsafe = n => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const readSynchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const utf16 = text => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(String(text), 'utf16le')]);
const u32be = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u32le = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

function imageMime(bytes) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return 'image/webp';
    return 'image/jpeg';
}

function id3Frame(id, body) {
    const header = Buffer.alloc(10);
    header.write(id, 0, 'latin1');
    header.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, body]);
}

/** 解析已有 ID3v2.3 标签中我们不覆盖的帧（v2.2/v2.4、带非同步化或扩展头的标签直接丢弃） */
function existingId3Frames(buf, tagEnd) {
    const version = buf[3];
    const flags = buf[5];
    if (version !== 3 || flags & 0xc0) return [];
    const frames = [];
    let o = 10;
    while (o + 10 <= tagEnd) {
        const id = buf.toString('latin1', o, o + 4);
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const size = buf.readUInt32BE(o + 4);
        if (size <= 0 || o + 10 + size > tagEnd) break;
        frames.push({ id, raw: buf.subarray(o, o + 10 + size) });
        o += 10 + size;
    }
    return frames;
}

function writeMp3(buf, tags, cover) {
    let audioStart = 0;
    let kept = [];
    if (buf.toString('latin1', 0, 3) === 'ID3') {
        const size = readSynchsafe(buf, 6);
        const footer = buf[5] & 0x10 ? 10 : 0;
        audioStart = Math.min(buf.length, 10 + size + footer);
        kept = existingId3Frames(buf, Math.min(buf.length, 10 + size));
    } else if (!(buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
        return null; // 不是 MP3
    }
    // 只替换本次确实要写入的帧；例如没拿到新封面时保留原有封面
    const replacing = { TIT2: tags.title, TPE1: tags.artist, TALB: tags.album, USLT: tags.lyric, APIC: cover };
    kept = kept.filter(f => !OWN_ID3.has(f.id) || !replacing[f.id]);
    const frames = kept.map(f => f.raw);
    if (tags.title) frames.push(id3Frame('TIT2', Buffer.concat([Buffer.from([1]), utf16(tags.title)])));
    if (tags.artist) frames.push(id3Frame('TPE1', Buffer.concat([Buffer.from([1]), utf16(tags.artist)])));
    if (tags.album) frames.push(id3Frame('TALB', Buffer.concat([Buffer.from([1]), utf16(tags.album)])));
    if (tags.lyric) frames.push(id3Frame('USLT', Buffer.concat([Buffer.from([1]), Buffer.from('XXX', 'latin1'), utf16(''), Buffer.from([0, 0]), utf16(tags.lyric)])));
    if (cover) frames.push(id3Frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from(imageMime(cover), 'latin1'), Buffer.from([0, 3, 0]), cover])));
    const body = Buffer.concat([...frames, Buffer.alloc(1024)]);
    const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0]), synchsafe(body.length)]);
    return Buffer.concat([header, body, buf.subarray(audioStart)]);
}

function parseVorbis(data) {
    try {
        let o = 0;
        const vendorLength = data.readUInt32LE(o); o += 4 + vendorLength;
        const count = data.readUInt32LE(o); o += 4;
        const list = [];
        for (let i = 0; i < count && o + 4 <= data.length; i++) {
            const length = data.readUInt32LE(o); o += 4;
            list.push(data.toString('utf8', o, o + length));
            o += length;
        }
        return list;
    } catch {
        return [];
    }
}

function writeFlac(buf, tags, cover) {
    if (buf.toString('latin1', 0, 4) !== 'fLaC') return null;
    const blocks = [];
    let o = 4;
    let last = false;
    while (!last && o + 4 <= buf.length) {
        const head = buf[o];
        last = (head & 0x80) !== 0;
        const length = buf.readUIntBE(o + 1, 3);
        if (o + 4 + length > buf.length) return null;
        blocks.push({ type: head & 0x7f, data: buf.subarray(o + 4, o + 4 + length) });
        o += 4 + length;
    }
    if (!blocks.length || blocks[0].type !== 0) return null; // 第一个块必须是 STREAMINFO
    const audio = buf.subarray(o);
    const replacing = { TITLE: tags.title, ARTIST: tags.artist, ALBUM: tags.album, LYRICS: tags.lyric, UNSYNCEDLYRICS: tags.lyric };
    const oldComments = parseVorbis(blocks.find(b => b.type === 4)?.data || Buffer.alloc(0))
        .filter(c => { const key = c.split('=')[0].toUpperCase(); return !OWN_VORBIS.has(key) || !replacing[key]; });
    const comments = [...oldComments];
    if (tags.title) comments.push(`TITLE=${tags.title}`);
    if (tags.artist) comments.push(`ARTIST=${tags.artist}`);
    if (tags.album) comments.push(`ALBUM=${tags.album}`);
    if (tags.lyric) comments.push(`LYRICS=${tags.lyric}`);
    const vendor = Buffer.from('YEmusic', 'utf8');
    const vorbis = Buffer.concat([u32le(vendor.length), vendor, u32le(comments.length), ...comments.flatMap(c => { const b = Buffer.from(c, 'utf8'); return [u32le(b.length), b]; })]);
    const out = blocks.filter(b => b.type !== 4 && b.type !== 1 && !(b.type === 6 && cover));
    out.push({ type: 4, data: vorbis });
    if (cover && cover.length < 0xffffff - 64) {
        const mime = Buffer.from(imageMime(cover), 'latin1');
        out.push({ type: 6, data: Buffer.concat([u32be(3), u32be(mime.length), mime, u32be(0), u32be(0), u32be(0), u32be(0), u32be(0), u32be(cover.length), cover]) });
    }
    out.push({ type: 1, data: Buffer.alloc(1024) });
    if (out.some(b => b.data.length > 0xffffff)) return null;
    const parts = [Buffer.from('fLaC', 'latin1')];
    out.forEach((block, index) => {
        const head = Buffer.alloc(4);
        head[0] = (index === out.length - 1 ? 0x80 : 0) | block.type;
        head.writeUIntBE(block.data.length, 1, 3);
        parts.push(head, block.data);
    });
    parts.push(audio);
    return Buffer.concat(parts);
}

/**
 * @param {string} filePath 待写入的文件
 * @param {{ title?: string; artist?: string; album?: string; lyric?: string }} tags
 * @param {Buffer | null} cover 封面图片字节
 */
async function writeTags(filePath, tags, cover) {
    const buf = await fsp.readFile(filePath);
    const clean = {
        title: String(tags?.title || '').slice(0, 500),
        artist: String(tags?.artist || '').slice(0, 500),
        album: String(tags?.album || '').slice(0, 500),
        lyric: String(tags?.lyric || '').slice(0, 200000),
    };
    const output = writeFlac(buf, clean, cover) || writeMp3(buf, clean, cover);
    if (!output) return false;
    await fsp.writeFile(filePath, output);
    return true;
}

module.exports = { writeTags };
