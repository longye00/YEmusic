/**
 * 本地曲库：递归扫描文件夹、读取标签（music-metadata）、读取同名 .lrc 歌词。
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.mp4', '.aac', '.webm', '.aiff', '.aif', '.wma', '.ape']);

let mmPromise = null;
function loadMusicMetadata() {
    mmPromise ??= import('music-metadata');
    return mmPromise;
}

async function scanAudioFiles(dirs, limit = 20000) {
    const found = [];
    const seen = new Set();
    const queue = (Array.isArray(dirs) ? dirs : [dirs]).filter(Boolean).map(d => path.resolve(String(d)));
    while (queue.length && found.length < limit) {
        const dir = queue.shift();
        if (seen.has(dir)) continue;
        seen.add(dir);
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                queue.push(full);
            } else if (entry.isFile() && AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) {
                try {
                    const stat = await fsp.stat(full);
                    found.push({ path: full, size: stat.size, mtime: stat.mtimeMs, folder: dir });
                } catch {
                    // 文件在扫描过程中被删除
                }
                if (found.length >= limit) break;
            }
        }
    }
    return found;
}

function pickLyrics(common) {
    const raw = common?.lyrics;
    if (!raw || !raw.length) return '';
    const first = raw[0];
    if (typeof first === 'string') return first;
    if (first?.syncText?.length) {
        return first.syncText
            .map(item => {
                const ms = Number(item.timestamp || 0);
                const m = Math.floor(ms / 60000);
                const s = ((ms % 60000) / 1000).toFixed(2).padStart(5, '0');
                return `[${String(m).padStart(2, '0')}:${s}]${item.text}`;
            })
            .join('\n');
    }
    return typeof first?.text === 'string' ? first.text : '';
}

async function readTags(filePath, withCover = true) {
    const result = { path: filePath, title: '', artist: '', album: '', duration: 0, bitrate: 0, sampleRate: 0, codec: '', lossless: false, lyrics: '', cover: null };
    try {
        const mm = await loadMusicMetadata();
        const meta = await mm.parseFile(filePath, { duration: true, skipCovers: !withCover, skipPostHeaders: false });
        const common = meta.common || {};
        result.title = common.title || '';
        result.artist = common.artists?.join('、') || common.artist || common.albumartist || '';
        result.album = common.album || '';
        result.duration = Number(meta.format?.duration || 0);
        result.bitrate = Number(meta.format?.bitrate || 0);
        result.sampleRate = Number(meta.format?.sampleRate || 0);
        result.codec = meta.format?.codec || meta.format?.container || '';
        result.lossless = Boolean(meta.format?.lossless);
        result.track = common.track?.no || 0;
        result.year = common.year || 0;
        result.lyrics = pickLyrics(common);
        const picture = withCover ? (mm.selectCover ? mm.selectCover(common.picture) : common.picture?.[0]) : null;
        if (picture?.data && picture.data.length < 8 * 1024 * 1024) {
            result.cover = { data: Buffer.from(picture.data), format: picture.format || 'image/jpeg' };
        }
    } catch (error) {
        result.error = error?.message || String(error);
    }
    return result;
}

async function readSidecarLyric(filePath) {
    const base = filePath.slice(0, filePath.length - path.extname(filePath).length);
    for (const ext of ['.lrc', '.LRC', '.Lrc']) {
        const candidate = base + ext;
        if (fs.existsSync(candidate)) {
            const buffer = await fsp.readFile(candidate);
            // 兼容 UTF-8 BOM / UTF-16LE；GBK 编码的歌词交给渲染进程用 TextDecoder('gbk') 处理
            if (buffer[0] === 0xff && buffer[1] === 0xfe) return { encoding: 'utf-16le', data: buffer.subarray(2) };
            if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return { encoding: 'utf-8', data: buffer.subarray(3) };
            return { encoding: 'auto', data: buffer };
        }
    }
    return null;
}

module.exports = { scanAudioFiles, readTags, readSidecarLyric, AUDIO_EXT };
