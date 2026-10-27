/**
 * 音源管理：安装 / 启停 / 排序洛雪自定义源脚本，并负责与 Worker 通信。
 *
 * 修复 0.1.x 的问题：脚本只执行一次（不再先当作原生插件试跑）、在真实全局作用域运行、
 * 请求二进制安全、初始化超时与错误可见、每个请求都有超时。
 */
import { create } from 'zustand';
import { host } from '@/lib/host';
import * as db from '@/lib/idb';
import { md5 } from '@/lib/md5';
import { AGGREGATE_MARK, PRESET_SCRIPTS, RETIRED_PRESET_NAMES } from '@/plugins/presets';
import { parseScriptMeta } from '@/plugins/meta';
export { parseScriptMeta };
import type { Platform, Quality } from '@/sdk/types';
import { toast } from './toast';

export interface SourceRecord {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    homepage: string;
    script: string;
    enabled: boolean;
    builtin?: boolean;
    addedAt: number;
    order: number;
}

export interface SourceCapability { type: string; actions: string[]; qualitys: Quality[] }

export interface SourceRuntime {
    status: 'stopped' | 'loading' | 'ready' | 'error';
    error?: string;
    sources?: Partial<Record<Platform | 'local', SourceCapability>>;
    updateAlert?: { log: string; updateUrl?: string };
    /** 最近一次成功取链的时间，用于排序 */
    lastSuccess?: number;
    failures: number;
    /** 按平台统计的连续失败次数（成功后清零），用于自动把失效音源排到后面 */
    platformFailures?: Record<string, number>;
}

export interface LogEntry { time: number; sourceId: string; level: string; text: string }

interface SourcesState {
    records: SourceRecord[];
    runtime: Record<string, SourceRuntime>;
    logs: LogEntry[];
    blockedHosts: string[];
    loaded: boolean;
}

export const useSources = create<SourcesState>(() => ({ records: [], runtime: {}, logs: [], blockedHosts: [], loaded: false }));

const workers = new Map<string, Worker>();
const pendingCalls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const startPromises = new Map<string, Promise<void>>();
let callSeq = 0;

function setRuntime(id: string, patch: Partial<SourceRuntime>) {
    useSources.setState(state => ({
        runtime: { ...state.runtime, [id]: { failures: 0, status: 'stopped', ...(state.runtime[id] as SourceRuntime | undefined), ...patch } },
    }));
}

function addLog(sourceId: string, level: string, text: string) {
    useSources.setState(state => ({ logs: [...state.logs.slice(-499), { time: Date.now(), sourceId, level, text }] }));
}

async function persist(record: SourceRecord) {
    await db.put('sources', record);
}

function spawn(record: SourceRecord, onInit: (ok: boolean, error?: string, sources?: SourceRuntime['sources']) => void): Worker {
    const worker = new Worker(new URL('../plugins/worker.ts', import.meta.url), { name: `source-${record.name}` });
    worker.onmessage = async (event: MessageEvent) => {
        const message = event.data || {};
        switch (message.type) {
            case 'fetch': {
                let res;
                try {
                    // 屏蔽列表以主线程为准，脚本无法通过伪造消息绕过
                    res = await host.pluginFetch({ ...message.req, blockedHosts: useSources.getState().blockedHosts });
                } catch (error) {
                    res = { ok: false, status: 0, error: (error as Error).message };
                }
                const bytes = res.bytes ? new Uint8Array(res.bytes) : undefined;
                worker.postMessage({ type: 'fetchResult', id: message.id, res: { ...res, bytes } }, bytes ? [bytes.buffer] : []);
                break;
            }
            case 'init':
                onInit(Boolean(message.ok), message.error, message.sources);
                break;
            case 'log':
                addLog(record.id, message.level, message.text);
                break;
            case 'updateAlert':
                setRuntime(record.id, { updateAlert: { log: message.log, updateUrl: message.updateUrl } });
                addLog(record.id, 'info', `更新提示：${message.log}`);
                break;
            case 'result': {
                const pending = pendingCalls.get(message.id);
                if (!pending) break;
                pendingCalls.delete(message.id);
                clearTimeout(pending.timer);
                if (message.ok) pending.resolve(message.result);
                else pending.reject(new Error(message.error || 'failed'));
                break;
            }
        }
    };
    worker.onerror = event => {
        addLog(record.id, 'error', event.message || 'Worker 错误');
    };
    worker.postMessage({
        type: 'load',
        script: record.script,
        blockedHosts: useSources.getState().blockedHosts,
        info: { name: record.name, description: record.description, version: record.version, author: record.author, homepage: record.homepage },
    });
    return worker;
}

/** 启动一个音源，等待它调用 send('inited')。 */
export function startSource(id: string): Promise<void> {
    const existing = startPromises.get(id);
    if (existing) return existing;
    const record = useSources.getState().records.find(r => r.id === id);
    if (!record) return Promise.reject(new Error('音源不存在'));
    stopSource(id);
    setRuntime(id, { status: 'loading', error: undefined });
    const promise = new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => finish(false, '初始化超时（20 秒内脚本没有完成初始化）'), 20000);
        const finish = (ok: boolean, error?: string, sources?: SourceRuntime['sources']) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (ok) {
                setRuntime(id, { status: 'ready', sources, error: undefined, failures: 0 });
                addLog(id, 'info', `初始化完成，支持：${Object.keys(sources || {}).join(', ') || '无'}`);
                resolve();
            } else {
                setRuntime(id, { status: 'error', error: error || '初始化失败' });
                addLog(id, 'error', `初始化失败：${error}`);
                workers.get(id)?.terminate();
                workers.delete(id);
                reject(new Error(error || '初始化失败'));
            }
        };
        workers.set(id, spawn(record, finish));
    }).finally(() => startPromises.delete(id));
    startPromises.set(id, promise);
    return promise;
}

export function stopSource(id: string) {
    workers.get(id)?.terminate();
    workers.delete(id);
    setRuntime(id, { status: 'stopped', sources: undefined });
}

/** 调用音源脚本的 request 事件。 */
export async function callSource(id: string, source: string, action: 'musicUrl' | 'lyric' | 'pic', info: unknown, timeoutMs = 20000): Promise<unknown> {
    const runtime = useSources.getState().runtime[id];
    if (runtime?.status !== 'ready' || !workers.has(id)) await startSource(id);
    const worker = workers.get(id);
    if (!worker) throw new Error('音源未运行');
    const callId = ++callSeq;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingCalls.delete(callId);
            reject(new Error('音源响应超时'));
        }, timeoutMs);
        pendingCalls.set(callId, { resolve, reject, timer });
        worker.postMessage({ type: 'call', id: callId, source, action, info });
    });
}

const aggregateCache = new Map<string, boolean>();
/** 是否为聚合音源（内部包含多个子源，一个链接失效后可以再次请求它换用其他子源） */
export function isAggregateSource(id: string): boolean {
    let value = aggregateCache.get(id);
    if (value === undefined) {
        const record = useSources.getState().records.find(r => r.id === id);
        if (!record) return false;
        value = record.script.includes(AGGREGATE_MARK);
        aggregateCache.set(id, value);
    }
    return value;
}

export function markSourceResult(id: string, ok: boolean, platform?: string) {
    const runtime = useSources.getState().runtime[id];
    if (!runtime) return;
    const platformFailures = { ...(runtime.platformFailures || {}) };
    if (platform) platformFailures[platform] = ok ? 0 : (platformFailures[platform] || 0) + 1;
    setRuntime(id, ok ? { lastSuccess: Date.now(), failures: 0, platformFailures } : { failures: (runtime.failures || 0) + 1, platformFailures });
}

/** 按“启用 + 该平台连续失败次数 + 用户排序”排序的可用音源 */
export function sourcesFor(platform: Platform): { record: SourceRecord; qualitys: Quality[] }[] {
    const { records, runtime } = useSources.getState();
    const fails = (rt?: SourceRuntime) => Math.min(3, rt?.platformFailures?.[platform] || 0);
    return records
        .filter(r => r.enabled)
        .map(record => ({ record, cap: runtime[record.id]?.sources?.[platform], rt: runtime[record.id] }))
        .filter(item => item.rt?.status !== 'error' && (item.rt?.status !== 'ready' || item.cap?.actions.includes('musicUrl')))
        .sort((a, b) => fails(a.rt) - fails(b.rt) || a.record.order - b.record.order)
        .map(item => ({ record: item.record, qualitys: (item.cap?.qualitys as Quality[]) || [] }));
}

/** 支持某平台歌词的音源 */
export function lyricSourcesFor(platform: Platform) {
    const { records, runtime } = useSources.getState();
    return records.filter(r => r.enabled && runtime[r.id]?.status === 'ready' && runtime[r.id]?.sources?.[platform]?.actions.includes('lyric'));
}

export async function installSource(script: string, options: { builtin?: boolean; enabled?: boolean } = {}): Promise<SourceRecord> {
    // 与洛雪一致：保存原始脚本（不 trim），rawScript 可能参与脚本自校验
    const text = String(script || '').replace(/^\uFEFF/, '');
    if (!text.trim()) throw new Error('脚本内容为空');
    if (text.length > 2 * 1024 * 1024) throw new Error('脚本过大');
    if (!/lx\b|globalThis/.test(text)) throw new Error('这不像是洛雪音乐的自定义源脚本');
    const meta = parseScriptMeta(text);
    const id = `src_${md5(text).slice(0, 12)}`;
    const state = useSources.getState();
    const existed = state.records.find(r => r.id === id);
    if (existed) return existed;
    // 同名音源视为更新：替换脚本、保留启用状态与排序
    const sameName = state.records.find(r => r.name === meta.name && !r.builtin === !options.builtin);
    const record: SourceRecord = {
        id,
        ...meta,
        script: text,
        enabled: options.enabled ?? sameName?.enabled ?? true,
        builtin: options.builtin,
        addedAt: Date.now(),
        order: sameName?.order ?? (state.records.reduce((max, r) => Math.max(max, r.order), -1) + 1),
    };
    if (sameName) await removeSource(sameName.id, true);
    useSources.setState(s => ({ records: [...s.records.filter(r => r.id !== id), record].sort((a, b) => a.order - b.order) }));
    await persist(record);
    if (record.enabled) startSource(id).catch(() => {});
    return record;
}

export async function removeSource(id: string, silent = false) {
    stopSource(id);
    useSources.setState(state => {
        const runtime = { ...state.runtime };
        delete runtime[id];
        return { records: state.records.filter(r => r.id !== id), runtime };
    });
    await db.del('sources', id);
    if (!silent) toast('已删除音源');
}

export async function setSourceEnabled(id: string, enabled: boolean) {
    const record = useSources.getState().records.find(r => r.id === id);
    if (!record) return;
    const next = { ...record, enabled };
    useSources.setState(state => ({ records: state.records.map(r => (r.id === id ? next : r)) }));
    await persist(next);
    if (enabled) startSource(id).catch(error => toast(`${record.name} 启动失败：${error.message}`, 'error'));
    else stopSource(id);
}

export async function moveSource(id: string, delta: number) {
    const records = [...useSources.getState().records].sort((a, b) => a.order - b.order);
    const index = records.findIndex(r => r.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= records.length) return;
    [records[index], records[target]] = [records[target], records[index]];
    const next = records.map((r, i) => ({ ...r, order: i }));
    useSources.setState({ records: next });
    await db.putMany('sources', next);
}

export function setBlockedHosts(hosts: string[]) {
    useSources.setState({ blockedHosts: hosts });
    for (const worker of workers.values()) worker.postMessage({ type: 'blockedHosts', hosts });
}

export function clearLogs() {
    useSources.setState({ logs: [] });
}

export async function loadSources() {
    let records = await db.getAll<SourceRecord>('sources').catch(() => []);
    const seeded = await db.kvGet('sources.seeded.v2', false);
    useSources.setState({ records: records.sort((a, b) => a.order - b.order), loaded: true });
    if (!seeded) {
        // 先装内置音源（按可用性排序），再迁移 0.1.x 安装的其他音源
        for (const preset of PRESET_SCRIPTS) {
            await installSource(preset.script, { builtin: true }).catch(error => console.warn('[sources] preset failed', preset.key, error));
        }
        const legacy = await db.readLegacyDb();
        for (const old of (legacy?.sources as any[]) || []) {
            if (typeof old?.script === 'string' && old.flavor !== 'native') {
                await installSource(old.script, { enabled: old.enabled !== false }).catch(() => {});
            }
        }
        await db.kvSet('sources.seeded.v2', true);
        await db.kvSet('sources.seeded.v3', true);
        records = useSources.getState().records;
    } else if (!(await db.kvGet('sources.seeded.v3', false))) {
        await upgradePresetsV3().catch(error => console.warn('[sources] preset upgrade failed', error));
        await db.kvSet('sources.seeded.v3', true);
    }
    for (const record of useSources.getState().records) {
        if (record.enabled) startSource(record.id).catch(() => {});
    }
}

/** 0.3.0：加入「YEmusic 聚合音源」并置顶，停用已失效的旧内置音源（不删除） */
async function upgradePresetsV3() {
    const merged = PRESET_SCRIPTS.find(p => p.key === 'merged');
    if (!merged) return;
    const record = await installSource(merged.script, { builtin: true, enabled: true });
    const ordered = [record, ...useSources.getState().records.filter(r => r.id !== record.id).sort((a, b) => a.order - b.order)].map((r, i) => ({ ...r, order: i }));
    useSources.setState({ records: ordered });
    await db.putMany('sources', ordered);
    let retired = 0;
    for (const r of useSources.getState().records) {
        if (r.builtin && r.enabled && RETIRED_PRESET_NAMES.includes(r.name)) {
            await setSourceEnabled(r.id, false);
            retired++;
        }
    }
    toast(retired ? `已加入「${record.name}」，并停用 ${retired} 个已失效的内置音源（可在设置 → 音源中重新启用）` : `已加入「${record.name}」`, 'success', { duration: 6000 });
}
