/** 纯 JS 实现的 AES（128/192/256，ECB/CBC，PKCS#7 填充），供平台接口与洛雪音源脚本使用。 */
const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
(() => {
    let p = 1;
    let q = 1;
    const rotl = (x: number, s: number) => ((x << s) | (x >> (8 - s))) & 0xff;
    do {
        p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
        q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
        if (q & 0x80) q ^= 0x09;
        SBOX[p] = (q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 0x63) & 0xff;
    } while (p !== 1);
    SBOX[0] = 0x63;
    for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
})();

const xtime = (a: number) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
function mul(a: number, b: number) {
    let r = 0;
    while (b) {
        if (b & 1) r ^= a;
        a = xtime(a);
        b >>= 1;
    }
    return r;
}
const MUL = {
    9: new Uint8Array(256), 11: new Uint8Array(256), 13: new Uint8Array(256), 14: new Uint8Array(256),
};
for (let i = 0; i < 256; i++) {
    MUL[9][i] = mul(i, 9); MUL[11][i] = mul(i, 11); MUL[13][i] = mul(i, 13); MUL[14][i] = mul(i, 14);
}

function expandKey(key: Uint8Array) {
    const nk = key.length / 4;
    const nr = nk + 6;
    const w = new Uint8Array(16 * (nr + 1));
    w.set(key);
    let rcon = 1;
    for (let i = nk; i < 4 * (nr + 1); i++) {
        let t0 = w[(i - 1) * 4], t1 = w[(i - 1) * 4 + 1], t2 = w[(i - 1) * 4 + 2], t3 = w[(i - 1) * 4 + 3];
        if (i % nk === 0) {
            const tmp = t0;
            t0 = SBOX[t1] ^ rcon; t1 = SBOX[t2]; t2 = SBOX[t3]; t3 = SBOX[tmp];
            rcon = xtime(rcon);
        } else if (nk > 6 && i % nk === 4) {
            t0 = SBOX[t0]; t1 = SBOX[t1]; t2 = SBOX[t2]; t3 = SBOX[t3];
        }
        w[i * 4] = w[(i - nk) * 4] ^ t0;
        w[i * 4 + 1] = w[(i - nk) * 4 + 1] ^ t1;
        w[i * 4 + 2] = w[(i - nk) * 4 + 2] ^ t2;
        w[i * 4 + 3] = w[(i - nk) * 4 + 3] ^ t3;
    }
    return { w, nr };
}

function encryptBlock(s: Uint8Array, w: Uint8Array, nr: number) {
    for (let i = 0; i < 16; i++) s[i] ^= w[i];
    const t = new Uint8Array(16);
    for (let round = 1; round <= nr; round++) {
        for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[r + 4 * c] = s[r + 4 * ((c + r) % 4)];
        if (round !== nr) {
            for (let c = 0; c < 4; c++) {
                const a0 = t[4 * c], a1 = t[4 * c + 1], a2 = t[4 * c + 2], a3 = t[4 * c + 3];
                s[4 * c] = xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3;
                s[4 * c + 1] = a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3;
                s[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3;
                s[4 * c + 3] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3);
            }
        } else {
            s.set(t);
        }
        const k = round * 16;
        for (let i = 0; i < 16; i++) s[i] ^= w[k + i];
    }
}

function decryptBlock(s: Uint8Array, w: Uint8Array, nr: number) {
    const k0 = nr * 16;
    for (let i = 0; i < 16; i++) s[i] ^= w[k0 + i];
    const t = new Uint8Array(16);
    for (let round = nr - 1; round >= 0; round--) {
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[r + 4 * ((c + r) % 4)] = s[r + 4 * c];
        for (let i = 0; i < 16; i++) s[i] = INV_SBOX[t[i]] ^ w[round * 16 + i];
        if (round !== 0) {
            for (let c = 0; c < 4; c++) {
                const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3];
                s[4 * c] = MUL[14][a0] ^ MUL[11][a1] ^ MUL[13][a2] ^ MUL[9][a3];
                s[4 * c + 1] = MUL[9][a0] ^ MUL[14][a1] ^ MUL[11][a2] ^ MUL[13][a3];
                s[4 * c + 2] = MUL[13][a0] ^ MUL[9][a1] ^ MUL[14][a2] ^ MUL[11][a3];
                s[4 * c + 3] = MUL[11][a0] ^ MUL[13][a1] ^ MUL[9][a2] ^ MUL[14][a3];
            }
        }
    }
}

export type AesMode = 'ecb' | 'cbc';

function normalizeKey(key: Uint8Array, bits?: number) {
    const size = bits ? bits / 8 : key.length <= 16 ? 16 : key.length <= 24 ? 24 : 32;
    if (key.length === size) return key;
    const out = new Uint8Array(size);
    out.set(key.subarray(0, size));
    return out;
}

/** 解析 node 风格的算法名，例如 'aes-128-ecb'。 */
export function parseAesAlgorithm(algorithm: string): { bits?: number; mode: AesMode } {
    const match = /aes-?(128|192|256)?-?(ecb|cbc)?/i.exec(String(algorithm || ''));
    return { bits: match?.[1] ? Number(match[1]) : undefined, mode: (match?.[2]?.toLowerCase() as AesMode) || 'cbc' };
}

export function aesEncrypt(data: Uint8Array, key: Uint8Array, mode: AesMode = 'cbc', iv?: Uint8Array, bits?: number, padding = true) {
    const { w, nr } = expandKey(normalizeKey(key, bits));
    const pad = padding ? 16 - (data.length % 16) : (16 - (data.length % 16)) % 16;
    const out = new Uint8Array(data.length + pad);
    out.set(data);
    if (padding) out.fill(pad, data.length);
    const prev = new Uint8Array(16);
    if (mode === 'cbc' && iv) prev.set(iv.subarray(0, 16));
    for (let offset = 0; offset < out.length; offset += 16) {
        const block = out.subarray(offset, offset + 16);
        if (mode === 'cbc') for (let i = 0; i < 16; i++) block[i] ^= prev[i];
        encryptBlock(block, w, nr);
        if (mode === 'cbc') prev.set(block);
    }
    return out;
}

export function aesDecrypt(data: Uint8Array, key: Uint8Array, mode: AesMode = 'cbc', iv?: Uint8Array, bits?: number, padding = true) {
    const { w, nr } = expandKey(normalizeKey(key, bits));
    const length = data.length - (data.length % 16);
    const out = new Uint8Array(length);
    out.set(data.subarray(0, length));
    let prev = new Uint8Array(16);
    if (mode === 'cbc' && iv) prev.set(iv.subarray(0, 16));
    for (let offset = 0; offset < length; offset += 16) {
        const block = out.subarray(offset, offset + 16);
        const cipher = block.slice();
        decryptBlock(block, w, nr);
        if (mode === 'cbc') {
            for (let i = 0; i < 16; i++) block[i] ^= prev[i];
            prev = cipher;
        }
    }
    if (!padding || !length) return out;
    const pad = out[length - 1];
    return pad > 0 && pad <= 16 ? out.subarray(0, length - pad) : out;
}
