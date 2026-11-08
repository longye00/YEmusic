/**
 * 设置中心（Folia 式）：左侧分组导航 + 顶部搜索，右侧是带标题的内容页。
 * 搜索不维护单独的索引：搜索时把所有页签一起渲染，Section / Item 按搜索词自己决定显不显示（见 SettingsQuery）。
 */
import { createContext, isValidElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ClipboardPaste, Database, Download, ExternalLink, FileCode2, FolderOpen, FolderPlus, Info, Link2, Palette, Play, Plug, RefreshCw, RotateCcw, ScrollText, Search, Sparkles, Trash2, Type, X } from 'lucide-react';
import appIcon from '@/assets/icon.png';
import { displayPath, host, isAndroid, isDesktop } from '@/lib/host';
import { requestText } from '@/lib/http';
import { chromeMajor, OLD_WEBVIEW } from '@/lib/lite';
import { formatSize } from '@/lib/util';
import { clearUrlCache, resetCircuits } from '@/player/resolver';
import { clearLyricCache } from '@/player/lyrics';
import { PRESET_SCRIPTS } from '@/plugins/presets';
import { PLATFORM_NAMES, QUALITY_NAMES, type Quality } from '@/sdk/types';
import { cancelDownload, clearFinishedDownloads, removeDownload, useDownloads } from '@/store/downloads';
import { addLocalFolder, clearCoverCache, exportBackup, importBackup, removeLocalFolder, rescanLocal, useLibrary } from '@/store/library';
import { EQ_BANDS, EQ_PRESETS, resetSettings, setSetting, useSettings, type Settings } from '@/store/settings';
import { clearLogs, installSource, isAggregateSource, moveSource, removeSource, setBlockedHosts, setSourceEnabled, startSource, useSources, type SourceRecord } from '@/store/sources';
import { toast } from '@/store/toast';
import { ui, useUi, type SettingsTab } from '@/store/ui';
import { checkForUpdateManually } from '@/lib/updater';
import { ACCOUNT_META, ACCOUNT_PLATFORMS, logoutAccount, useAccounts } from '@/store/accounts';
import { PlatformBadge } from '../library/LoginPanel';
import { FOLIA_MODES } from '../player/folia/modes';
import { css, useTheme } from '../theme';
import { Button, EmptyState, IconButton, Segmented, Slider, Spinner, Switch, cx } from '../components/common';
import { Keys, type KeyCombo } from '../components/Kbd';
import { Surface } from '../components/Surface';

const TABS: { id: SettingsTab; label: string; desc: string; icon: typeof Play }[] = [
    { id: 'playback', label: '播放', desc: '音质与容错、输出设备、均衡器与窗口行为', icon: Play },
    { id: 'sources', label: '音源', desc: '洛雪自定义源脚本与网络限制', icon: Plug },
    { id: 'lyrics', label: '歌词', desc: '歌词样式、字体字号与歌词来源', icon: Type },
    { id: 'download', label: '下载', desc: '保存位置、下载音质、文件名与歌曲标签', icon: Download },
    { id: 'appearance', label: '外观', desc: '首页布局、播放页背景与配色', icon: Palette },
    { id: 'library', label: '曲库与数据', desc: '在线平台账号、本地音乐、备份与缓存', icon: Database },
    { id: 'about', label: '关于与帮助', desc: '版本、更新、快捷键与开源许可', icon: Info },
];
const TAB_BY_ID = Object.fromEntries(TABS.map(t => [t.id, t])) as Record<SettingsTab, (typeof TABS)[number]>;

/** 桌面端导航分组；关于固定在导航底部（与 Folia 的「帮助」同位） */
const NAV_GROUPS: { title: string; tabs: SettingsTab[] }[] = [
    { title: '音乐', tabs: ['playback', 'sources', 'lyrics', 'download'] },
    { title: '应用', tabs: ['appearance', 'library'] },
];
const PINNED_TAB: SettingsTab = 'about';

/** 当前搜索词（空串 = 没在搜索）与「所在分区的标题 / 说明已命中，整组显示」 */
const SettingsQuery = createContext('');
const SectionHit = createContext(false);

/** 把标题 / 说明里的 ReactNode 压成纯文字，用来匹配搜索词 */
function textOf(node: ReactNode): string {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
    return '';
}

/** 每个空格分隔的词都要出现（不分大小写） */
const matches = (query: string, text: string) => {
    const hay = text.toLowerCase();
    return query.toLowerCase().split(/\s+/).filter(Boolean).every(word => hay.includes(word));
};

const LYRIC_STYLES: { id: Settings['lyricStyle']; name: string; en: string }[] = [
    { id: 'luminous', name: '光晕', en: 'Luminous' },
    { id: 'flow', name: '滚动', en: 'Flow' },
    ...FOLIA_MODES.map(m => ({ id: m.id as Settings['lyricStyle'], name: m.name, en: m.en })),
];

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
    const query = useContext(SettingsQuery);
    const hit = Boolean(query) && matches(query, `${title} ${desc ?? ''}`);
    return (
        <section className={cx('settings-section mb-7', hit && 'is-hit')}>
            <h3 className="text-[12.5px] font-semibold tracking-wide txt-3">{title}</h3>
            {desc && <p className="mt-1 text-[12px] leading-relaxed txt-4">{desc}</p>}
            <div className="mt-3 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border ln-weak bg-white/[0.03]">
                <SectionHit.Provider value={hit}>{children}</SectionHit.Provider>
            </div>
        </section>
    );
}

function Item({ title, desc, children, column, dense }: { title: ReactNode; desc?: ReactNode; children?: ReactNode; column?: boolean; dense?: boolean }) {
    const query = useContext(SettingsQuery);
    const sectionHit = useContext(SectionHit);
    if (query && !sectionHit && !matches(query, `${textOf(title)} ${textOf(desc)}`)) return null;
    return (
        <div data-item className={cx('flex gap-4 px-4', dense ? 'py-2.5' : 'py-3.5', column ? 'flex-col' : 'items-center max-sm:flex-wrap max-sm:gap-y-2.5 max-sm:[&>:not(:first-child)]:ml-auto')}>
            <div className={cx('min-w-0 flex-1', !column && 'max-sm:min-w-[55%]')}>
                <div className={dense ? 'text-[13px] txt-2' : 'text-[13.5px] font-medium txt-1'}>{title}</div>
                {desc && <div className="mt-0.5 text-[12px] leading-relaxed txt-4">{desc}</div>}
            </div>
            {children}
        </div>
    );
}

function Toggle({ k, title, desc }: { k: keyof Settings; title: string; desc?: string }) {
    const value = useSettings(s => s[k]) as boolean;
    return <Item title={title} desc={desc}><Switch checked={value} label={title} onChange={v => setSetting(k, v as never)} /></Item>;
}

/** 搜索时每个页签的小标题；整组没有命中就由 CSS 隐藏（.settings-group） */
function TabGroup({ id, children }: { id: SettingsTab; children: ReactNode }) {
    const { label, icon: Icon } = TAB_BY_ID[id];
    return (
        <div className="settings-group mb-2">
            <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold tracking-tight txt-1"><Icon className="h-4 w-4 txt-3" />{label}</h2>
            {children}
        </div>
    );
}

const QUALITY_OPTIONS: { value: Quality; label: string }[] = [
    { value: '128k', label: '标准' },
    { value: '320k', label: '高品' },
    { value: 'flac', label: '无损' },
    { value: 'flac24bit', label: 'Hi-Res' },
];

function PlaybackTab() {
    const s = useSettings();
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    useEffect(() => {
        navigator.mediaDevices?.enumerateDevices().then(list => setDevices(list.filter(d => d.kind === 'audiooutput'))).catch(() => {});
    }, []);
    const presetName = Object.entries(EQ_PRESETS).find(([, g]) => g.every((v, i) => v === s.eqGains[i]))?.[0];
    return (
        <>
            <Section title="音质与容错" desc="音质按偏好从高到低尝试；每个链接播放前都会先探测，失效链接（403/404/410、错误页）会被自动跳过，不会再出现无限重试。只给 30 秒 / 1 分钟试听片段的链接会被自动换掉，找不到完整版就跳过这首。">
                <Item title="首选音质" desc="实际音质取决于歌曲与音源支持情况"><Segmented size="sm" value={s.quality} onChange={v => setSetting('quality', v)} options={QUALITY_OPTIONS} /></Item>
                <Toggle k="qualityFallback" title="首选音质不可用时自动切换其他音质" />
                <Toggle k="officialFirst" title="优先用平台官方接口取播放链接" desc="登录网易云 / QQ音乐 / 酷狗后，先用平台自己的接口取链（会员可拿到无损、Hi-Res），拿不到或只给试听片段时再走洛雪音源" />
                <Toggle k="autoSwitchSource" title="当前平台无法播放时自动换源" desc="按歌名、歌手与时长在其他平台匹配同一首歌" />
                <Toggle k="skipOnError" title="播放失败自动跳到下一首" desc="连续多首失败会自动停止并提示" />
                <Toggle k="resumePlayback" title="启动时恢复上次的播放队列与进度" />
            </Section>
            <Section title="输出">
                <Item title="交叉淡入淡出" desc={s.crossfade ? `切歌时前后两首重叠 ${s.crossfade} 秒` : '关闭'}>
                    <div className="flex w-56 items-center gap-3"><Slider value={s.crossfade} min={0} max={10} step={1} onChange={v => setSetting('crossfade', v)} className="flex-1" thumb /><span className="w-8 text-right font-mono text-[12px]">{s.crossfade}s</span></div>
                </Item>
                <Item title="音频输出设备">
                    <select value={s.outputDevice} onChange={e => setSetting('outputDevice', e.target.value)} className="no-drag h-9 max-w-[260px] rounded-xl border ln bg-black/30 px-3 text-[13px] outline-none">
                        <option value="default">系统默认</option>
                        {devices.filter(d => d.deviceId && d.deviceId !== 'default').map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `设备 ${d.deviceId.slice(0, 6)}`}</option>)}
                    </select>
                </Item>
                <Item title="均衡器" desc={s.eqEnabled ? `预设：${presetName || '自定义'}` : '关闭'}><Switch checked={s.eqEnabled} onChange={v => setSetting('eqEnabled', v)} /></Item>
                {s.eqEnabled && (
                    <div className="px-4 pb-4 pt-1">
                        <div className="mb-4 flex flex-wrap gap-1.5">
                            {Object.entries(EQ_PRESETS).map(([name, gains]) => (
                                <button key={name} type="button" onClick={() => setSetting('eqGains', [...gains])} className={cx('h-7 rounded-full px-3 text-[12px]', presetName === name ? 'bg-white text-black' : 'bg-white/[0.08] txt-3 hover:bg-white/15')}>{name}</button>
                            ))}
                        </div>
                        <div className="grid grid-cols-5 gap-4">
                            {EQ_BANDS.map((band, i) => (
                                <div key={band} className="flex flex-col items-center gap-2">
                                    <span className="font-mono text-[11px] txt-3">{s.eqGains[i] > 0 ? '+' : ''}{s.eqGains[i]}dB</span>
                                    <Slider value={s.eqGains[i]} min={-12} max={12} step={1} onChange={v => { const g = [...s.eqGains]; g[i] = v; setSetting('eqGains', g); }} className="w-full" thumb />
                                    <span className="font-mono text-[10px] txt-4">{band >= 1000 ? `${band / 1000}k` : band}Hz</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </Section>
            <Section title="窗口">
                <Item title="关闭窗口时最小化到托盘" desc="托盘菜单可以播放 / 暂停、切歌或退出"><Switch checked={s.closeToTray} onChange={v => { setSetting('closeToTray', v); void host.setCloseToTray(v); }} /></Item>
            </Section>
        </>
    );
}

function SourceCard({ record, index, count }: { record: SourceRecord; index: number; count: number }) {
    const runtime = useSources(s => s.runtime[record.id]);
    const logs = useSources(s => s.logs);
    const [showLogs, setShowLogs] = useState(false);
    const myLogs = useMemo(() => logs.filter(l => l.sourceId === record.id).slice(-40), [logs, record.id]);
    const status = runtime?.status || 'stopped';
    const statusText = { ready: '运行中', loading: '启动中…', error: '启动失败', stopped: record.enabled ? '未启动' : '已停用' }[status];
    return (
        <div className="px-4 py-3.5">
            <div className="flex items-start gap-3 max-sm:flex-wrap">
                <span className={cx('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', status === 'ready' ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.6)]' : status === 'loading' ? 'animate-pulse bg-sky-300' : status === 'error' ? 'bg-red-400' : 'bg-white/25')} />
                <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-22px)]">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[14px] font-semibold">{record.name}</span>
                        {record.version && <span className="font-mono text-[11px] txt-4">{/^v/i.test(record.version) ? record.version : `v${record.version}`}</span>}
                        {record.builtin && <span className="rounded-full bg-white/10 px-1.5 py-px text-[10px] txt-3">内置</span>}
                        {isAggregateSource(record.id) && <span className="rounded-full bg-sky-300/15 px-1.5 py-px text-[10px] text-sky-200/85" title="内含多个子音源，按平台竞速取链、失败自动换用其他子源">聚合</span>}
                        <span className={cx('text-[11px]', status === 'error' ? 'text-red-300' : 'txt-4')}>{statusText}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] txt-4">{[record.author && `作者 ${record.author}`, record.description].filter(Boolean).join(' · ') || '—'}</div>
                    {runtime?.error && <div className="mt-1 text-[12px] text-red-300/90">{runtime.error}</div>}
                    {runtime?.sources && (
                        <div className="mt-2 flex flex-wrap gap-1">
                            {Object.entries(runtime.sources).filter(([p]) => p !== 'local').map(([p, cap]) => (
                                <span key={p} className={cx('rounded-md px-1.5 py-0.5 font-mono text-[10px]', (runtime.platformFailures?.[p] || 0) >= 3 ? 'bg-amber-400/10 text-amber-200/80' : 'bg-white/[0.07] txt-3')} title={(runtime.platformFailures?.[p] || 0) >= 3 ? '最近多次取链失败，已自动降低优先级' : ''}>
                                    {PLATFORM_NAMES[p as keyof typeof PLATFORM_NAMES] || p} {(cap?.qualitys || []).map(q => q.replace('flac24bit', 'HR').replace('flac', 'SQ')).join('/')}
                                </span>
                            ))}
                        </div>
                    )}
                    {runtime?.updateAlert && (
                        <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-3 py-2 text-[12px] text-amber-100/85">
                            <div className="whitespace-pre-line">{runtime.updateAlert.log}</div>
                            {runtime.updateAlert.updateUrl && <button type="button" className="mt-1 inline-flex items-center gap-1 text-amber-200 hover:underline" onClick={() => host.openExternal(runtime.updateAlert!.updateUrl!)}><ExternalLink className="h-3 w-3" />前往更新</button>}
                        </div>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-1 max-sm:w-full max-sm:justify-end">
                    <IconButton size="sm" label="上移" disabled={index === 0} onClick={() => moveSource(record.id, -1)}><ArrowUp className="h-4 w-4" /></IconButton>
                    <IconButton size="sm" label="下移" disabled={index === count - 1} onClick={() => moveSource(record.id, 1)}><ArrowDown className="h-4 w-4" /></IconButton>
                    <IconButton size="sm" label="重新启动" disabled={!record.enabled} onClick={() => { resetCircuits(); clearUrlCache(); startSource(record.id).then(() => toast(`${record.name} 已启动`, 'success'), e => toast(`${record.name}：${e.message}`, 'error')); }}><RefreshCw className="h-4 w-4" /></IconButton>
                    <IconButton size="sm" label="日志" active={showLogs} onClick={() => setShowLogs(v => !v)}><ScrollText className="h-4 w-4" /></IconButton>
                    <IconButton size="sm" label="删除" onClick={() => ui.confirm('删除音源', `确定删除「${record.name}」吗？`, () => removeSource(record.id), { danger: true, confirmText: '删除' })}><Trash2 className="h-4 w-4" /></IconButton>
                    <span className="ml-1"><Switch checked={record.enabled} onChange={v => setSourceEnabled(record.id, v)} /></span>
                </div>
            </div>
            {showLogs && (
                <div className="scroll-thin mt-3 max-h-48 overflow-y-auto rounded-xl bg-black/35 p-3 font-mono text-[10.5px] leading-relaxed txt-3">
                    {myLogs.length ? myLogs.map((l, i) => <div key={i} className={l.level === 'error' ? 'text-red-300/80' : l.level === 'warn' ? 'text-amber-200/80' : ''}>[{new Date(l.time).toLocaleTimeString()}] {l.text}</div>) : '暂无日志'}
                </div>
            )}
        </div>
    );
}

function SourcesTab() {
    const records = useSources(s => s.records);
    const blocked = useSettings(s => s.blockedHosts);
    const [mode, setMode] = useState<'none' | 'url' | 'paste'>('none');
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const [blockText, setBlockText] = useState(blocked.join('\n'));
    const install = async (script: string) => {
        setBusy(true);
        try {
            const record = await installSource(script);
            toast(`已导入音源「${record.name}」`, 'success');
            setMode('none');
            setInput('');
        } catch (error) {
            toast(`导入失败：${(error as Error).message}`, 'error');
        } finally {
            setBusy(false);
        }
    };
    const fromUrl = async () => {
        if (!/^https?:\/\//i.test(input.trim())) return toast('请输入 http(s) 链接', 'error');
        setBusy(true);
        try {
            await install(await requestText(input.trim(), { timeout: 15000 }));
        } catch (error) {
            toast(`下载脚本失败：${(error as Error).message}`, 'error');
            setBusy(false);
        }
    };
    const restorePresets = async () => {
        for (const preset of PRESET_SCRIPTS) await installSource(preset.script, { builtin: true }).catch(() => {});
        toast('已恢复内置音源', 'success');
    };
    return (
        <>
            <Section title="洛雪自定义源" desc="兼容 LX Music 桌面版自定义源脚本（lx.request / send / on / utils 等 API）。脚本在独立的 Worker 中运行，网络请求经主进程转发；多个音源按顺序与可用性自动切换。">
                <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
                    <Button onClick={() => fileRef.current?.click()}><FileCode2 className="h-4 w-4" />导入本地脚本</Button>
                    <Button onClick={() => setMode(mode === 'url' ? 'none' : 'url')}><Link2 className="h-4 w-4" />从链接导入</Button>
                    <Button onClick={() => setMode(mode === 'paste' ? 'none' : 'paste')}><ClipboardPaste className="h-4 w-4" />粘贴脚本</Button>
                    <Button variant="ghost" onClick={restorePresets}><RotateCcw className="h-4 w-4" />恢复内置音源</Button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".js,.txt"
                        multiple
                        className="hidden"
                        onChange={async e => {
                            const files = [...(e.target.files || [])];
                            e.target.value = '';
                            for (const file of files) await install(await file.text());
                        }}
                    />
                </div>
                {mode !== 'none' && (
                    <div className="space-y-2 px-4 pb-4">
                        {mode === 'url' ? (
                            <input value={input} onChange={e => setInput(e.target.value)} placeholder="https://…/source.js" className="h-10 w-full rounded-xl border ln bg-black/30 px-3 text-[13px] outline-none focus:ln-strong" />
                        ) : (
                            <textarea value={input} onChange={e => setInput(e.target.value)} placeholder={'/**\n * @name 音源名称\n * @version 1.0.0\n */\n…'} className="scroll-thin h-40 w-full resize-none rounded-xl border ln bg-black/30 p-3 font-mono text-[12px] outline-none focus:ln-strong" />
                        )}
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setMode('none')}>取消</Button>
                            <Button variant="white" disabled={!input.trim() || busy} onClick={() => (mode === 'url' ? fromUrl() : install(input))}>{busy && <Spinner />}导入</Button>
                        </div>
                    </div>
                )}
            </Section>
            <Section title={`已安装（${records.length}）`} desc="排在前面的音源优先使用；某平台连续取链失败的音源会被临时排到后面。">
                {records.length ? records.map((r, i) => <SourceCard key={r.id} record={r} index={i} count={records.length} />) : <EmptyState dense icon={<FileCode2 className="h-4 w-4" />} title="还没有安装任何音源" desc="用上面的按钮导入洛雪自定义源脚本，或直接「恢复内置音源」" />}
            </Section>
            <Section title="网络限制" desc="禁止音源脚本访问的域名（每行一个，含子域名）。脚本只能访问公网地址，本机与局域网地址始终被拦截。">
                <div className="space-y-2 px-4 py-3.5">
                    <textarea value={blockText} onChange={e => setBlockText(e.target.value)} placeholder="example.com" className="scroll-thin h-24 w-full resize-none rounded-xl border ln bg-black/30 p-3 font-mono text-[12px] outline-none focus:ln-strong" />
                    <div className="flex justify-between">
                        <Button variant="ghost" onClick={clearLogs}>清空全部日志</Button>
                        <Button onClick={() => { const hosts = blockText.split(/\s+/).map(h => h.trim().toLowerCase()).filter(Boolean); setSetting('blockedHosts', hosts); setBlockedHosts(hosts); toast('已保存', 'success'); }}>保存</Button>
                    </div>
                </div>
            </Section>
        </>
    );
}

function LyricsTab() {
    const s = useSettings();
    return (
        <>
            <Section title="显示">
                <Item column title="歌词样式" desc="Luminous：逐字飞入、辉光高亮；Flow：经典滚动歌词；其余 8 种是风格各异的动态歌词。每种动画的细节参数在歌词样式窗口里边看预览边调。">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        {LYRIC_STYLES.map(o => (
                            <button key={o.id} type="button" onClick={() => setSetting('lyricStyle', o.id)} className={cx('flex min-w-0 flex-col items-start rounded-xl px-3 py-2 text-left transition-colors', s.lyricStyle === o.id ? 'bg-[var(--ui-selected)] text-white' : 'bg-[var(--ui-idle)] txt-3 hover:bg-[var(--ui-hover)] hover:text-white')}>
                                <span className="max-w-full truncate text-[13px] font-semibold leading-tight">{o.name}</span>
                                <span className="max-w-full truncate text-[10.5px] leading-tight txt-4">{o.en}</span>
                            </button>
                        ))}
                    </div>
                </Item>
                <Item title="歌词样式窗口" desc="实时预览所有歌词动画，调整动画参数、背景、字体与字幕">
                    <Button onClick={() => ui.openLyricStyle('style')}><Sparkles className="h-4 w-4" />打开歌词样式窗口</Button>
                </Item>
                <Item title="动效强度"><Segmented size="sm" value={s.lyricIntensity} onChange={v => setSetting('lyricIntensity', v)} options={[{ value: 'calm', label: '平静' }, { value: 'normal', label: '标准' }, { value: 'chaotic', label: '狂野' }]} /></Item>
                <Item title="字体"><Segmented size="sm" value={s.lyricFont} onChange={v => setSetting('lyricFont', v)} options={[{ value: 'sans', label: '黑体' }, { value: 'serif', label: '宋体' }]} /></Item>
                <Item title="字号"><div className="flex w-56 items-center gap-3"><Slider value={s.lyricScale} min={0.6} max={1.6} step={0.05} onChange={v => setSetting('lyricScale', v)} className="flex-1" thumb /><span className="w-10 text-right font-mono text-[12px]">{Math.round(s.lyricScale * 100)}%</span></div></Item>
                <Toggle k="showTranslation" title="显示翻译" />
                <Toggle k="showRoma" title="显示罗马音" />
                <Item title="全局歌词偏移" desc="正值让歌词更晚出现"><div className="flex w-56 items-center gap-3"><Slider value={s.lyricOffset} min={-3000} max={3000} step={50} onChange={v => setSetting('lyricOffset', v)} className="flex-1" thumb /><span className="w-14 text-right font-mono text-[12px]">{(s.lyricOffset / 1000).toFixed(2)}s</span></div></Item>
            </Section>
            <Section title="来源" desc="依次尝试：平台接口 → 洛雪音源 → 其他平台同名歌曲 → LRCLIB；本地歌曲优先使用内嵌歌词与同名 .lrc 文件。">
                <Item title="歌词缓存"><Button onClick={async () => { await clearLyricCache(); toast('歌词缓存已清除', 'success'); }}><Trash2 className="h-4 w-4" />清除</Button></Item>
            </Section>
        </>
    );
}

function AppearanceTab() {
    const s = useSettings();
    return (
        <>
        <Section title="首页">
            <Item title="首页布局" desc={s.homeLayout === 'library' ? '乐库：可拖动的封面拼贴墙，中间的书签切换歌单 / 电台 / 专辑 / 本地 / 广场 / 榜单' : '封面流：3D 封面轮播，在“我的 / 歌单广场 / 排行榜”间切换'}>
                <Segmented size="sm" value={s.homeLayout} onChange={v => setSetting('homeLayout', v)} options={[{ value: 'library', label: '乐库' }, { value: 'carousel', label: '封面流' }]} />
            </Item>
            <Item title="歌单 / 专辑详情页布局" desc={s.detailLayout === 'wall' ? '拼贴墙：歌曲排成可拖动的海报墙，标题、过滤与操作在中间的书签里；窗口窄于 900px 时自动用列表' : '列表：左侧封面与操作，右侧是歌曲列表'}>
                <Segmented size="sm" value={s.detailLayout} onChange={v => setSetting('detailLayout', v)} options={[{ value: 'wall', label: '拼贴墙' }, { value: 'list', label: '列表' }]} />
            </Item>
        </Section>
        <Section title="背景与主题">
            <Item title="播放页背景"><Segmented size="sm" value={s.background} onChange={v => setSetting('background', v)} options={[{ value: 'latent', label: 'Latent 流体' }, { value: 'blur', label: '模糊封面' }, { value: 'solid', label: '纯色' }]} /></Item>
            <Toggle k="dither" title="半色调网点" desc="在背景上叠加细腻的网点纹理" />
            <Toggle k="reactive" title="背景随节奏律动" desc="根据低频能量轻微改变流体亮度与流速" />
            <Item title="配色"><Segmented size="sm" value={s.theme} onChange={v => setSetting('theme', v)} options={[{ value: 'default', label: '默认' }, { value: 'cover', label: '封面取色' }, { value: 'custom', label: '自定义' }]} /></Item>
            {s.theme === 'custom' && <Item title="自定义主色"><input type="color" value={s.customAccent} onChange={e => setSetting('customAccent', e.target.value)} className="h-8 w-14 cursor-pointer rounded-md border-0 bg-transparent" /></Item>}
            <Toggle k="reduceMotion" title="减少动效" desc="降低动画与背景流速，适合低性能设备" />
            <Toggle k="splash" title="启动动画" desc="打开软件时播放 YEmusic 字标动画（约 1.5 秒，点击或按任意键可跳过）" />
            <Item title="精简模式" desc="关闭毛玻璃与装饰层、降低背景流体的分辨率与帧率，手机和老旧设备上更流畅。自动：Android 与旧版内核默认开启">
                <Segmented size="sm" value={s.liteMode} onChange={v => setSetting('liteMode', v)} options={[{ value: 'auto', label: '自动' }, { value: 'on', label: '开启' }, { value: 'off', label: '关闭' }]} />
            </Item>
        </Section>
        </>
    );
}

function AccountsSection() {
    const accounts = useAccounts();
    const current = useSettings(s => s.libraryAccount);
    return (
        <Section title="在线平台账号（可选）" desc="登录后乐库会显示该平台你创建 / 收藏的歌单与专辑（网易云还会按你的口味生成私人FM 与每日推荐）；乐库同一时间显示一个平台，可在乐库书签底部的头像处切换。不登录也能使用全部播放功能，凭据只保存在本机。">
            {ACCOUNT_PLATFORMS.map(p => {
                const meta = ACCOUNT_META[p];
                const { profile, status } = accounts[p];
                return (
                    <Item
                        key={p}
                        title={
                            <span className="flex items-center gap-2.5">
                                <PlatformBadge platform={p} size={22} />
                                {meta.name}
                                {profile && current === p && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-semibold txt-3">乐库显示中</span>}
                            </span>
                        }
                        desc={profile ? (status === 'expired' ? `${profile.nickname} · 登录已失效，请重新登录` : status === 'checking' ? `${profile.nickname} · 正在校验登录状态…` : `${profile.nickname} · ID ${profile.id}`) : `未登录 · 点击登录${isAndroid ? '（手机验证码 / Cookie）' : `（${meta.scanWith}扫码）`}`}
                    >
                        <div className="flex gap-2">
                            {profile && status !== 'expired' && current !== p && <Button variant="ghost" onClick={() => setSetting('libraryAccount', p)}>在乐库显示</Button>}
                            {(!profile || status === 'expired') && <Button variant="white" onClick={() => ui.dialog({ type: 'login', platform: p })}>登录</Button>}
                            {profile && <Button variant="ghost" onClick={() => ui.confirm(`退出${meta.name}`, `确定退出${meta.name}账号吗？`, () => void logoutAccount(p), { confirmText: '退出', danger: true })}>退出登录</Button>}
                        </div>
                    </Item>
                );
            })}
        </Section>
    );
}

function DownloadTab() {
    const s = useSettings();
    const items = useDownloads(d => d.items);
    const [defaults, setDefaults] = useState('');
    useEffect(() => { host.defaultPaths().then(p => setDefaults(p.downloads)).catch(() => {}); }, []);
    return (
        <>
            <Section title="下载设置">
                <Item title="保存位置" desc={<span className="break-all font-mono text-[11px]">{displayPath(s.downloadDir || defaults || '系统下载目录')}</span>}>
                    <div className="flex gap-2">
                        {s.downloadDir && <Button variant="ghost" onClick={() => setSetting('downloadDir', '')}>恢复默认</Button>}
                        <Button onClick={async () => { const r = await host.showOpenDialog({ title: '选择下载目录', directory: true }); if (!r.cancelled && r.paths[0]) setSetting('downloadDir', r.paths[0]); }}><FolderOpen className="h-4 w-4" />选择</Button>
                    </div>
                </Item>
                <Item title="下载音质"><Segmented size="sm" value={s.downloadQuality} onChange={v => setSetting('downloadQuality', v)} options={QUALITY_OPTIONS} /></Item>
                <Item title="文件名格式">
                    <select value={s.fileNameTemplate} onChange={e => setSetting('fileNameTemplate', e.target.value)} className="no-drag h-9 rounded-xl border ln bg-black/30 px-3 text-[13px] outline-none">
                        <option value="{name} - {singer}">歌名 - 歌手</option>
                        <option value="{singer} - {name}">歌手 - 歌名</option>
                        <option value="{name}">歌名</option>
                        <option value="{singer} - {album} - {name}">歌手 - 专辑 - 歌名</option>
                    </select>
                </Item>
                <Toggle k="embedMeta" title="写入歌曲标签" desc="把歌名、歌手、专辑、封面和歌词写进 MP3 / FLAC 文件，其他播放器也能识别" />
                <Toggle k="saveLyricFile" title="同时保存 .lrc 歌词文件" />
            </Section>
            <Section title={`下载列表（${items.length}）`}>
                {items.length ? (
                    <>
                        {items.slice(0, 100).map(item => (
                            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[13px] font-medium">{item.track.name} <span className="txt-4">· {item.track.singer}</span></div>
                                    <div className="mt-1 flex items-center gap-2 font-mono text-[11px] txt-4">
                                        {item.status === 'downloading' && item.total > 0 && <div className="h-1 w-32 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-white" style={{ width: `${(item.received / item.total) * 100}%` }} /></div>}
                                        <span className={item.status === 'error' ? 'text-red-300' : item.status === 'done' ? 'text-emerald-300/80' : ''}>
                                            {{ resolving: '获取链接中…', downloading: item.total ? `${formatSize(item.received)} / ${formatSize(item.total)}` : formatSize(item.received), done: `已完成${item.quality ? ` · ${QUALITY_NAMES[item.quality]}` : ''}`, error: item.error || '失败', cancelled: '已取消' }[item.status]}
                                        </span>
                                    </div>
                                </div>
                                {item.status === 'done' && item.savePath && !isAndroid && <IconButton size="sm" label="在文件夹中显示" onClick={() => host.showItemInFolder(item.savePath!)}><FolderOpen className="h-4 w-4" /></IconButton>}
                                {(item.status === 'downloading' || item.status === 'resolving') ? <IconButton size="sm" label="取消" onClick={() => cancelDownload(item.id)}><X className="h-4 w-4" /></IconButton> : <IconButton size="sm" label="移除记录" onClick={() => removeDownload(item.id)}><Trash2 className="h-4 w-4" /></IconButton>}
                            </div>
                        ))}
                        <div className="flex justify-end px-4 py-2.5"><Button variant="ghost" onClick={clearFinishedDownloads}>清除已完成</Button></div>
                    </>
                ) : <EmptyState dense icon={<Download className="h-4 w-4" />} title="暂无下载" />}
            </Section>
        </>
    );
}

function LibraryTab() {
    const folders = useSettings(s => s.localFolders);
    const scan = useLibrary(s => s.scan);
    const [busy, setBusy] = useState(false);
    const doExport = async () => {
        const r = await host.showSaveDialog({ title: '导出备份', defaultPath: `YEmusic-备份-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (r.cancelled || !r.filePath) return;
        await host.writeFile(r.filePath, await exportBackup());
        toast('备份已导出', 'success');
    };
    const doImport = async () => {
        const r = await host.showOpenDialog({ title: '导入备份', filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (r.cancelled || !r.paths[0]) return;
        setBusy(true);
        try {
            const text = new TextDecoder().decode(await host.readFile(r.paths[0]));
            const result = await importBackup(text);
            let sources = 0;
            for (const s of result.sources) if (s?.script) { await installSource(s.script).then(() => sources++, () => {}); }
            toast(`已导入 ${result.playlists} 个歌单、${sources} 个音源`, 'success');
        } catch (error) {
            toast(`导入失败：${(error as Error).message}`, 'error');
        } finally {
            setBusy(false);
        }
    };
    return (
        <>
            <AccountsSection />
            <Section title="本地音乐文件夹" desc="支持 MP3 / FLAC / M4A / OGG / OPUS / WAV 等格式，自动读取标签、内嵌封面与歌词；再次扫描只处理有变化的文件。">
                {folders.map(f => (
                    <div key={f} className="flex items-center gap-3 px-4 py-3">
                        <FolderOpen className="h-4 w-4 shrink-0 txt-4" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] txt-2">{displayPath(f)}</span>
                        {!isAndroid && <IconButton size="sm" label="打开" onClick={() => host.openPath(f)}><ExternalLink className="h-4 w-4" /></IconButton>}
                        <IconButton size="sm" label="移除" onClick={() => removeLocalFolder(f)}><Trash2 className="h-4 w-4" /></IconButton>
                    </div>
                ))}
                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                    <Button onClick={addLocalFolder} disabled={!isDesktop}><FolderPlus className="h-4 w-4" />添加文件夹</Button>
                    {folders.length > 0 && <Button onClick={() => rescanLocal()} disabled={scan.active}>{scan.active ? <Spinner /> : <RefreshCw className="h-4 w-4" />}{scan.active ? `扫描中 ${scan.done}/${scan.total || '…'}` : '重新扫描'}</Button>}
                </div>
            </Section>
            <Section title="备份与恢复" desc="导出歌单、收藏与自行导入的音源；本地文件路径不会导出。">
                <div className="flex flex-wrap gap-2 px-4 py-3.5">
                    <Button onClick={doExport}><Download className="h-4 w-4" />导出备份</Button>
                    <Button onClick={doImport} disabled={busy}>{busy ? <Spinner /> : <FolderOpen className="h-4 w-4" />}导入备份</Button>
                </div>
            </Section>
            <Section title="缓存">
                <Item title="封面缓存" desc="本地歌曲的内嵌封面"><Button onClick={async () => { await clearCoverCache(); toast('封面缓存已清除，重新扫描后会恢复', 'success'); }}><Trash2 className="h-4 w-4" />清除</Button></Item>
                <Item title="播放链接缓存" desc="链接会在 12 分钟后自动过期"><Button onClick={() => { clearUrlCache(); toast('已清除', 'success'); }}><Trash2 className="h-4 w-4" />清除</Button></Item>
                <Item title="恢复默认设置" desc="不会影响歌单与音源"><Button variant="danger" onClick={() => ui.confirm('恢复默认设置', '确定将所有设置恢复为默认值吗？', resetSettings, { danger: true, confirmText: '恢复' })}><RotateCcw className="h-4 w-4" />恢复</Button></Item>
            </Section>
        </>
    );
}

const SHORTCUTS: [string, string][] = [
    ['空格', '播放 / 暂停'],
    ['多媒体键', '播放 / 暂停、上一首、下一首、停止、音量、静音（输入框里也生效）'],
    ['Ctrl + → / Ctrl + ←', '下一首 / 上一首'],
    ['→ / ←', '播放页：快进 / 快退 5 秒；封面流：切换封面；乐库：平移'],
    ['拖动 / 滚轮', '乐库：平移拼贴墙（Shift + 方向键一次移动 3 格）'],
    ['双击', '乐库 / 封面流：直接播放，不打开详情'],
    ['回车', '封面流：打开当前聚焦的封面'],
    ['Tab + 方向键', '任何滑块：聚焦后用 ← → 微调，PageUp / PageDown 粗调，Home / End 到头'],
    ['/', '乐库：过滤当前页；设置里：搜索设置项'],
    ['Home', '乐库：回到起点'],
    ['↑ / ↓', '播放页：音量 +/- 5%'],
    ['Ctrl + K / Ctrl + F', '搜索（设置里是搜索设置项）'],
    ['↑↓ / Enter', '搜索框内：选择结果 / 播放；Shift + Enter 加入队列，Tab 循环切换平台'],
    ['Ctrl + P', '打开 / 关闭播放页'],
    ['L', '喜欢当前歌曲'],
    ['M', '静音'],
    ['F11', '全屏'],
    ['Ctrl + ,', '设置'],
    ['?', '快捷键与帮助（本页）'],
    ['Esc', '关闭当前浮层（设置里先清掉搜索词）'],
];

/** "Ctrl + → / ←" → [['Ctrl', '→'], ['←']]：按 " / " 分成几个可选组合，再按 "+" 分成键帽；拆出来全是文字说明（拖动、双击）时当作一个键帽 */
function comboOf(text: string): KeyCombo[] {
    return text.split(/\s+\/\s+/).map(part => part.split(/\s*\+\s*/).filter(Boolean));
}

function AboutTab() {
    const [version, setVersion] = useState('');
    const [checking, setChecking] = useState(false);
    // 图标投影跟随主题：原先写死了一抹绿色（rgba(0,168,96,.32)），那是早期品牌的颜色，
    // 和封面取色 / 自定义主题都对不上。取色顺序与 App 的背景一致。
    const bgPalette = useUi(s => s.bgPalette);
    const theme = useTheme(bgPalette);
    useEffect(() => { host.version().then(setVersion).catch(() => {}); }, []);
    return (
        <>
            <div className="settings-no-search mb-7 flex items-center gap-4">
                <img src={appIcon} alt="" draggable={false} className="h-16 w-16 rounded-[18px]" style={{ boxShadow: `0 12px 40px ${css(theme.accent, 0.32)}` }} />
                <div>
                    <div className="text-[22px] font-bold tracking-tight">YEmusic</div>
                    <div className="font-mono text-[12px] txt-4">v{version || '—'} · 融合洛雪音源生态与沉浸式界面的音乐播放器（Windows / Android）</div>
                    {chromeMajor() > 0 && <div className="mt-0.5 text-[11.5px] txt-4">{isAndroid ? 'Android System WebView' : 'Chromium'} {chromeMajor()}{OLD_WEBVIEW ? '（版本较旧，部分界面效果已自动降级；可在应用商店更新「Android System WebView」与 Chrome）' : ''}</div>}
                </div>
            </div>
            <Section title="更新">
                <Item title="检查更新" desc="有新版本时在应用内下载并自动开始安装（数据保留）">
                    <Button variant="glass" onClick={() => { setChecking(true); void checkForUpdateManually().finally(() => setChecking(false)); }}>{checking && <Spinner className="h-3.5 w-3.5" />}检查更新</Button>
                </Item>
            </Section>
            {!isAndroid && <Section title="快捷键">
                {SHORTCUTS.map(([keys, label]) => <Item dense key={keys} title={label}><Keys combos={comboOf(keys)} className="shrink-0 justify-end" /></Item>)}
            </Section>}
            <Section title="开源许可与致谢">
                <div className="space-y-2.5 px-4 py-3.5 text-[12.5px] leading-relaxed txt-3">
                    <p>YEmusic 自有代码以 Apache License 2.0 发布。自 0.5.0 起集成了 Folia 的歌词动画代码（AGPL-3.0），因此包含这些代码的整体程序（安装包 / APK）按 AGPL-3.0 分发：分发时必须同时向接收者提供对应的完整源码与许可文本（见源码中的 LICENSE-AGPL-3.0.txt）。</p>
                    <p>洛雪自定义源兼容层（lx API 语义）与各平台元数据接口的实现参考了 <button type="button" className="txt-2 underline-offset-2 hover:underline" onClick={() => host.openExternal('https://github.com/lyswhut/lx-music-desktop')}>lx-music-desktop</button>（Apache-2.0，© lyswhut），相关代码已按许可保留版权声明。</p>
                    <p>歌词动画“莫奈 / 回环 / 镜台 / 时计 / 商籁 / 凝彩 / 静止 / 绘光”及其渲染器、参数面板源自 <button type="button" className="txt-2 underline-offset-2 hover:underline" onClick={() => host.openExternal('https://github.com/chthollyphile/folia-major')}>Folia</button> v0.7.20（AGPL-3.0，© chthollyphile 及贡献者），已保留版权声明与许可，适配改动记录在源码的 VENDOR.md 中。其余界面（乐库拼贴墙、封面流首页、悬浮面板等）为独立编写，设计上致敬 Folia。</p>
                    <p>扫码登录的二维码由 QRCode for JavaScript 生成（MIT，© Kazuhiko Arase）。“QR Code”是 DENSO WAVE 的注册商标。</p>
                    <p>内置音源脚本（含 YEmusic 聚合音源中的子音源）由各自作者提供，版权归原作者；YEmusic 不提供、不存储任何音乐内容，请支持正版音乐。</p>
                </div>
            </Section>
        </>
    );
}

function TabBody({ id }: { id: SettingsTab }) {
    switch (id) {
        case 'playback': return <PlaybackTab />;
        case 'sources': return <SourcesTab />;
        case 'lyrics': return <LyricsTab />;
        case 'appearance': return <AppearanceTab />;
        case 'download': return <DownloadTab />;
        case 'library': return <LibraryTab />;
        default: return <AboutTab />;
    }
}

function NavItem({ id, active, onSelect }: { id: SettingsTab; active: boolean; onSelect: (id: SettingsTab) => void }) {
    const { label, icon: Icon } = TAB_BY_ID[id];
    return (
        <button
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(id)}
            className={cx('flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[10px] px-2.5 text-[13px] transition-colors', active ? 'bg-[var(--ui-hover)] font-semibold text-white' : 'txt-3 hover:bg-[var(--ui-idle)] hover:txt-1')}
        >
            <Icon className="h-4 w-4 shrink-0" />{label}
        </button>
    );
}

export function SettingsModal() {
    const open = useUi(s => s.settingsOpen);
    const tab = useUi(s => s.settingsTab);
    const [query, setQuery] = useState('');
    const [hits, setHits] = useState(0);
    const searchRef = useRef<HTMLInputElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const stripRef = useRef<HTMLElement>(null);
    const queryRef = useRef('');
    queryRef.current = query;
    const q = query.trim();
    const searching = q.length > 0;

    // Surface 在 onClose 的引用变化时会重跑焦点逻辑（还焦点、再抢焦点），所以这里必须是稳定引用
    const close = useCallback(() => {
        if (useUi.getState().dialog) return;
        if (queryRef.current) return setQuery('');
        ui.closeSettings();
    }, []);
    const select = useCallback((id: SettingsTab) => {
        setQuery('');
        useUi.setState({ settingsTab: id });
    }, []);

    useEffect(() => {
        if (!open) setQuery('');
    }, [open]);

    // 设置里的 Ctrl + F / Ctrl + K / "/" 搜索设置项，而不是在设置后面打开全局搜索
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            const ctrl = event.ctrlKey || event.metaKey;
            const typing = (event.target as HTMLElement | null)?.closest?.('input,textarea,select');
            const wanted = (ctrl && !event.shiftKey && /^[kf]$/i.test(event.key)) || (!ctrl && !event.altKey && !typing && event.key === '/');
            if (!wanted || useUi.getState().dialog) return;
            event.preventDefault();
            event.stopPropagation();
            searchRef.current?.focus();
            searchRef.current?.select();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open]);

    // 搜索时 Section / Item 自己按搜索词决定显不显示，这里只数一数留下了几项
    useLayoutEffect(() => {
        if (searching) setHits(bodyRef.current?.querySelectorAll('[data-item], .settings-section.is-hit').length ?? 0);
    });
    useEffect(() => {
        bodyRef.current?.scrollTo({ top: 0 });
    }, [tab, q]);
    // 手机上页签是横向滚动的一排：打开 / 切换时把当前页签滚到视野里
    useEffect(() => {
        if (open) stripRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    }, [open, tab]);

    const meta = TAB_BY_ID[tab];
    return (
        <Surface
            open={open}
            onClose={close}
            label="设置"
            backdropClassName="bg-black/55 backdrop-blur-md max-sm:p-0"
            className="flex h-[min(680px,100%)] w-[min(980px,100%)] max-sm:h-full max-sm:flex-col max-sm:rounded-none max-sm:border-0"
        >
            <nav className="flex w-[216px] shrink-0 flex-col border-r ln-weak p-3 max-sm:hidden">
                <label className="no-drag flex h-9 shrink-0 items-center gap-2 rounded-[10px] bg-[var(--ui-idle)] px-2.5 text-[13px] transition-colors focus-within:bg-[var(--ui-hover)]">
                    <Search className="h-4 w-4 shrink-0 txt-4" />
                    <input
                        ref={searchRef}
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="搜索设置"
                        aria-label="搜索设置"
                        spellCheck={false}
                        className="min-w-0 flex-1 bg-transparent outline-none placeholder:txt-5"
                    />
                    {query && (
                        <button type="button" aria-label="清除搜索" onClick={() => { setQuery(''); searchRef.current?.focus(); }} className="grid h-5 w-5 shrink-0 place-items-center rounded-full txt-4 hover:bg-white/10 hover:text-white">
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </label>
                <div className="scroll-none -mx-1 mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
                    {NAV_GROUPS.map(group => (
                        <div key={group.title} className="space-y-0.5">
                            <div className="px-2.5 pb-1 pt-3.5 text-[12px] txt-4">{group.title}</div>
                            {group.tabs.map(id => <NavItem key={id} id={id} active={!searching && tab === id} onSelect={select} />)}
                        </div>
                    ))}
                </div>
                <div className="shrink-0 border-t ln-weak pt-2">
                    <NavItem id={PINNED_TAB} active={!searching && tab === PINNED_TAB} onSelect={select} />
                </div>
            </nav>
            <nav ref={stripRef} className="scroll-none hidden shrink-0 gap-1 overflow-x-auto p-2 pr-14 max-sm:flex">
                {TABS.map(t => (
                    <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => select(t.id)} className={cx('flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-[13.5px] transition-colors', tab === t.id ? 'bg-[var(--ui-selected)] font-semibold text-white' : 'txt-3 hover:bg-[var(--ui-idle)] hover:txt-1')}>
                        <t.icon className="h-4 w-4" />{t.label}
                    </button>
                ))}
            </nav>
            <section className="flex min-w-0 flex-1 flex-col max-sm:border-t max-sm:ln-weak">
                <header className="flex shrink-0 items-start justify-between gap-4 border-b ln-weak px-8 pb-4 pt-6 max-sm:hidden">
                    <div className="min-w-0">
                        <h2 className="truncate text-[22px] font-bold tracking-tight">{searching ? `搜索「${q}」` : meta.label}</h2>
                        <p className="mt-1 text-[12.5px] txt-4">{searching ? (hits ? `找到 ${hits} 项` : '没有匹配的设置项') : meta.desc}</p>
                    </div>
                    <IconButton label="关闭 (Esc)" size="sm" onClick={ui.closeSettings}><X className="h-4 w-4" /></IconButton>
                </header>
                <div ref={bodyRef} className={cx('scroll-thin min-h-0 flex-1 overflow-y-auto px-8 pb-6 pt-6 max-sm:px-4 max-sm:pb-[calc(3rem+var(--safe-bottom))] max-sm:pt-4', searching && 'settings-searching')}>
                    <SettingsQuery.Provider value={q}>
                        {searching ? (
                            <>
                                {TABS.map(t => <TabGroup key={t.id} id={t.id}><TabBody id={t.id} /></TabGroup>)}
                                {!hits && <EmptyState dense icon={<Search className="h-4 w-4" />} title="没有匹配的设置项" desc="换个关键词试试，例如「音质」「歌词」「下载」「快捷键」" />}
                            </>
                        ) : <TabBody id={tab} />}
                    </SettingsQuery.Provider>
                </div>
            </section>
            <IconButton label="关闭" size="sm" className="absolute right-2.5 top-2.5 sm:hidden" onClick={ui.closeSettings}><X className="h-4 w-4" /></IconButton>
        </Surface>
    );
}
