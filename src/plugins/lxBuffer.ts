/**
 * 洛雪脚本里 `lx.utils.buffer.from()` 返回的是 Node 的 Buffer，脚本常见用法是
 * `.toString('base64' | 'hex' | 'utf8')`、`Buffer.concat`、下标访问等。这里提供一个兼容子集。
 */
import { concatBytes, decodeBytes, encodeString, toBytes } from '@/lib/bytes';

// @ts-ignore —— 与 Node Buffer 一致的 from() 签名，和 Uint8Array.from 不兼容
export class LxBuffer extends Uint8Array {
    static from(value: unknown, encodingOrOffset?: string | number, length?: number): LxBuffer {
        if (typeof value === 'string') return LxBuffer.wrap(encodeString(value, typeof encodingOrOffset === 'string' ? encodingOrOffset : 'utf8'));
        if (value instanceof ArrayBuffer) {
            const offset = typeof encodingOrOffset === 'number' ? encodingOrOffset : 0;
            return LxBuffer.wrap(new Uint8Array(value, offset, length ?? value.byteLength - offset).slice());
        }
        if (value && typeof value === 'object' && (value as any).type === 'Buffer' && Array.isArray((value as any).data)) {
            return LxBuffer.wrap(Uint8Array.from((value as any).data));
        }
        if (ArrayBuffer.isView(value) || Array.isArray(value)) return LxBuffer.wrap(Uint8Array.from(toBytes(value)));
        if (value && typeof value === 'object' && typeof (value as any).length === 'number') return LxBuffer.wrap(Uint8Array.from(value as ArrayLike<number>));
        throw new TypeError('The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array');
    }

    static wrap(bytes: Uint8Array): LxBuffer {
        return new LxBuffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
    }

    static alloc(size: number, fill?: number | string) {
        const buffer = new LxBuffer(size);
        if (typeof fill === 'number') buffer.fill(fill);
        else if (typeof fill === 'string' && fill.length) {
            const pattern = encodeString(fill);
            for (let i = 0; i < size; i++) buffer[i] = pattern[i % pattern.length];
        }
        return buffer;
    }

    static allocUnsafe(size: number) {
        return new LxBuffer(size);
    }

    static concat(list: ArrayLike<number>[], totalLength?: number) {
        const joined = concatBytes(list as Uint8Array[]);
        return LxBuffer.wrap(totalLength != null ? joined.slice(0, totalLength) : joined);
    }

    static isBuffer(value: unknown): value is LxBuffer {
        return value instanceof LxBuffer;
    }

    static byteLength(value: string | ArrayBufferView | ArrayBuffer, encoding?: string) {
        if (typeof value === 'string') return encodeString(value, encoding).length;
        return (value as ArrayBufferView).byteLength;
    }

    static isEncoding(encoding: string) {
        return ['utf8', 'utf-8', 'hex', 'base64', 'base64url', 'binary', 'latin1', 'ascii', 'ucs2', 'utf16le'].includes(String(encoding).toLowerCase());
    }

    toString(encoding = 'utf8', start = 0, end = this.length): string {
        return decodeBytes(this.subarray(start, end), encoding);
    }

    toJSON() {
        return { type: 'Buffer', data: Array.from(this) };
    }

    equals(other: Uint8Array) {
        if (this.length !== other.length) return false;
        for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
        return true;
    }

    // Node 的 slice 返回视图而非拷贝
    slice(start?: number, end?: number): LxBuffer {
        const view = this.subarray(start, end);
        return new LxBuffer(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
    }

    subarray(start?: number, end?: number): LxBuffer {
        const view = Uint8Array.prototype.subarray.call(this, start, end);
        return new LxBuffer(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
    }

    write(text: string, offset = 0, encoding = 'utf8') {
        const bytes = encodeString(text, encoding);
        const count = Math.min(bytes.length, this.length - offset);
        this.set(bytes.subarray(0, count), offset);
        return count;
    }

    copy(target: Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
        const chunk = this.subarray(sourceStart, sourceEnd);
        const count = Math.min(chunk.length, target.length - targetStart);
        target.set(chunk.subarray(0, count), targetStart);
        return count;
    }

    indexOf(value: number | string | Uint8Array, byteOffset = 0): number {
        if (typeof value === 'number') return Uint8Array.prototype.indexOf.call(this, value, byteOffset);
        const needle = typeof value === 'string' ? encodeString(value) : value;
        outer: for (let i = byteOffset; i <= this.length - needle.length; i++) {
            for (let j = 0; j < needle.length; j++) if (this[i + j] !== needle[j]) continue outer;
            return i;
        }
        return -1;
    }

    includes(value: number | string | Uint8Array, byteOffset = 0): boolean {
        return this.indexOf(value, byteOffset) !== -1;
    }

    readUInt8(offset = 0) { return this[offset]; }
    readUInt16BE(offset = 0) { return (this[offset] << 8) | this[offset + 1]; }
    readUInt16LE(offset = 0) { return this[offset] | (this[offset + 1] << 8); }
    readUInt32BE(offset = 0) { return ((this[offset] << 24) >>> 0) + ((this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3]); }
    readUInt32LE(offset = 0) { return ((this[offset + 3] << 24) >>> 0) + ((this[offset + 2] << 16) | (this[offset + 1] << 8) | this[offset]); }
    readInt32BE(offset = 0) { return (this[offset] << 24) | (this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3]; }
    readInt32LE(offset = 0) { return (this[offset + 3] << 24) | (this[offset + 2] << 16) | (this[offset + 1] << 8) | this[offset]; }
    writeUInt8(value: number, offset = 0) { this[offset] = value & 0xff; return offset + 1; }
    writeUInt32BE(value: number, offset = 0) { this[offset] = value >>> 24; this[offset + 1] = value >>> 16; this[offset + 2] = value >>> 8; this[offset + 3] = value; return offset + 4; }
    writeUInt32LE(value: number, offset = 0) { this[offset + 3] = value >>> 24; this[offset + 2] = value >>> 16; this[offset + 1] = value >>> 8; this[offset] = value; return offset + 4; }
}
