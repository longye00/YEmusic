/** 基于 CompressionStream 的 zlib 封装。 */
async function transform(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
    const output = new Blob([data as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
    return new Uint8Array(await new Response(output).arrayBuffer());
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
    try {
        return await transform(data, new DecompressionStream('deflate'));
    } catch (error) {
        try {
            return await transform(data, new DecompressionStream('deflate-raw'));
        } catch {
            throw error;
        }
    }
}

export const inflateRaw = (data: Uint8Array) => transform(data, new DecompressionStream('deflate-raw'));
export const gunzip = (data: Uint8Array) => transform(data, new DecompressionStream('gzip'));
export const deflate = (data: Uint8Array) => transform(data, new CompressionStream('deflate'));
