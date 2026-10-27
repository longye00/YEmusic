/** RSA 公钥加密（无填充，对应 Node 的 RSA_NO_PADDING），用于洛雪脚本的 rsaEncrypt。 */
import { base64Decode } from './bytes';

interface Tlv { tag: number; start: number; end: number; next: number }

function readTlv(bytes: Uint8Array, offset: number): Tlv {
    const tag = bytes[offset];
    let length = bytes[offset + 1];
    let start = offset + 2;
    if (length & 0x80) {
        const count = length & 0x7f;
        length = 0;
        for (let i = 0; i < count; i++) length = length * 256 + bytes[start + i];
        start += count;
    }
    return { tag, start, end: start + length, next: start + length };
}

function bytesToBigInt(bytes: Uint8Array): bigint {
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return hex ? BigInt(`0x${hex}`) : 0n;
}

export function parsePublicKey(pem: string): { n: bigint; e: bigint; size: number } {
    const body = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const der = base64Decode(body);
    let seq = readTlv(der, 0);
    let first = readTlv(der, seq.start);
    if (first.tag === 0x30) {
        // SubjectPublicKeyInfo：跳过算法标识，进入 BIT STRING
        const bitString = readTlv(der, first.next);
        seq = readTlv(der, bitString.start + 1);
        first = readTlv(der, seq.start);
    }
    const nTlv = first;
    const eTlv = readTlv(der, nTlv.next);
    let nBytes = der.subarray(nTlv.start, nTlv.end);
    while (nBytes.length > 1 && nBytes[0] === 0) nBytes = nBytes.subarray(1);
    return { n: bytesToBigInt(nBytes), e: bytesToBigInt(der.subarray(eTlv.start, eTlv.end)), size: nBytes.length };
}

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = 1n;
    base %= mod;
    while (exp > 0n) {
        if (exp & 1n) result = (result * base) % mod;
        base = (base * base) % mod;
        exp >>= 1n;
    }
    return result;
}

export function rsaEncryptNoPadding(data: Uint8Array, pem: string): Uint8Array {
    const { n, e, size } = parsePublicKey(pem);
    const c = modPow(bytesToBigInt(data), e, n);
    let hex = c.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    const out = new Uint8Array(size);
    const raw = new Uint8Array(hex.length / 2);
    for (let i = 0; i < raw.length; i++) raw[i] = parseInt(hex.substr(i * 2, 2), 16);
    out.set(raw.subarray(Math.max(0, raw.length - size)), Math.max(0, size - raw.length));
    return out;
}
