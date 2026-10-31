// 测试替身：平台官方取链。状态挂在 globalThis 上，由测试用例直接改写。
import type { Platform, Quality, Track } from '@/sdk/types';

interface StubState {
    available: boolean;
    hits: Record<string, { url: string; quality: Quality; sourceName: string } | null>;
    calls: { quality: Quality }[];
}
const state = ((globalThis as any).__officialStub ??= { available: true, hits: {}, calls: [] } as StubState) as StubState;
export const __state = state;

export const OFFICIAL_SOURCE_ID = 'official';
export const officialAvailable = (_p: Platform) => state.available;
export const officialLoggedIn = (_p: Platform) => true;
export async function officialUrl(_track: Track, quality: Quality) {
    state.calls.push({ quality });
    const hit = quality in state.hits ? state.hits[quality] : null;
    return hit ? { url: hit.url, quality: hit.quality, sourceName: hit.sourceName } : null;
}
export const wyOfficialUrl = officialUrl;
export const txOfficialUrl = officialUrl;
export const kgOfficialUrl = officialUrl;
