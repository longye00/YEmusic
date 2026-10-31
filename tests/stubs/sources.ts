// 测试替身：洛雪音源脚本层。
import type { Platform, Quality } from '@/sdk/types';

interface StubState {
    hits: Record<string, string>;
    calls: { id: string; platform: Platform; quality: Quality }[];
}
const state = ((globalThis as any).__sourcesStub ??= { hits: {}, calls: [] } as StubState) as StubState;
export const __state = state;

export async function callSource(id: string, platform: Platform, _action: string, info: Record<string, unknown>) {
    const quality = info.type as Quality;
    state.calls.push({ id, platform, quality });
    const url = state.hits[String(quality)];
    if (!url) throw new Error('音源无结果');
    return url;
}
export const isAggregateSource = () => false;
export function markSourceResult() { /* noop */ }
export const sourcesFor = (_platform: Platform) => [{ record: { id: 'stub', name: '桩音源' }, qualitys: [] as Quality[] }];
export const useSources = { getState: () => ({ records: [{ id: 'stub', name: '桩音源', enabled: true, order: 0, script: '', flavor: 'native' }], runtime: {}, loaded: true }) };
