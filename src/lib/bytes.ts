/** 字节与字符串互转工具（不依赖 Node Buffer，渲染进程与 Worker 通用）。 */
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export const utf8Encode = (text: string): Uint8Array => encoder.encode(text);
export const utf8Decode = (bytes: Uint8Array): string => decoder.decode(bytes);

export function latin1Encode(text: string): Uint8Array {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
}

export function latin1Decode(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return out;
}

export function hexEncode(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
}

export function hexDecode(hex: string): Uint8Array {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    const out = new Uint8Array(clean.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Int16Array(256).fill(-1);
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;
B64_LOOKUP['-'.charCodeAt(0)] = 62;
B64_LOOKUP['_'.charCodeAt(0)] = 63;

export function base64Encode(bytes: Uint8Array, urlSafe = false): string {
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    const rest = bytes.length - i;
    if (rest === 1) {
        const n = bytes[i] << 16;
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
    } else if (rest === 2) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
    }
    if (urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return out;
}

/** 宽松的 base64 解码：忽略空白与非法字符，兼容 url-safe 与缺省填充。 */
export function base64Decode(text: string): Uint8Array {
    const out = new Uint8Array(Math.floor((text.length * 3) / 4) + 3);
    let buffer = 0;
    let bits = 0;
    let length = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code === 61) break; // '='
        const value = code < 256 ? B64_LOOKUP[code] : -1;
        if (value < 0) continue;
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[length++] = (buffer >> bits) & 0xff;
        }
    }
    return out.slice(0, length);
}

export function concatBytes(list: ArrayLike<number>[] | Uint8Array[]): Uint8Array {
    const total = list.reduce((sum, item) => sum + item.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const item of list) {
        out.set(item as ArrayLike<number>, offset);
        offset += item.length;
    }
    return out;
}

export function toBytes(value: unknown, encoding = 'utf8'): Uint8Array {
    if (value == null) return new Uint8Array(0);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (Array.isArray(value)) return Uint8Array.from(value as number[]);
    if (typeof value === 'string') return encodeString(value, encoding);
    return utf8Encode(String(value));
}

export function encodeString(text: string, encoding = 'utf8'): Uint8Array {
    switch (String(encoding || 'utf8').toLowerCase()) {
        case 'hex':
            return hexDecode(text);
        case 'base64':
        case 'base64url':
            return base64Decode(text);
        case 'binary':
        case 'latin1':
        case 'ascii':
            return latin1Encode(text);
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le': {
            const out = new Uint8Array(text.length * 2);
            for (let i = 0; i < text.length; i++) {
                const code = text.charCodeAt(i);
                out[i * 2] = code & 0xff;
                out[i * 2 + 1] = code >> 8;
            }
            return out;
        }
        default:
            return utf8Encode(text);
    }
}

export function decodeBytes(bytes: Uint8Array, encoding = 'utf8'): string {
    switch (String(encoding || 'utf8').toLowerCase()) {
        case 'hex':
            return hexEncode(bytes);
        case 'base64':
            return base64Encode(bytes);
        case 'base64url':
            return base64Encode(bytes, true);
        case 'binary':
        case 'latin1':
            return latin1Decode(bytes);
        case 'ascii': {
            let out = '';
            for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i] & 0x7f);
            return out;
        }
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
            return new TextDecoder('utf-16le').decode(bytes);
        default:
            return utf8Decode(bytes);
    }
}
