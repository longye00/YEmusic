/** 设置中心 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ArrowUp, ClipboardPaste, Database, Download, ExternalLink, FileCode2, FolderOpen, FolderPlus, Info, Link2, Palette, Play, Plug, RefreshCw, RotateCcw, ScrollText, Trash2, Type, X } from 'lucide-react';
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
import { ACCOUNT_META, ACCOUNT_PLATFORMS, logoutAccount, useAccounts } from '@/store/accounts';
import { PlatformBadge } from '../library/LoginPanel';
import { FOLIA_MODES } from '../player/folia/modes';
import { Button, IconButton, Segmented, Slider, Spinner, Switch, cx } from '../components/common';

const TABS: { id: SettingsTab; label: string; icon: typeof Play }[] = [
    { id: 'playback', label: '播放', icon: Play },
    { id: 'sources', label: '音源', icon: Plug },
    { id: 'lyrics', label: '歌词', icon: Type },
    { id: 'appearance', label: '外观', icon: Palette },
    { id: 'download', label: '下载', icon: Download },
    { id: 'library', label: '曲库与数据', icon: Database },
    { id: 'about', label: '关于', icon: Info },
];

const LYRIC_STYLES: { id: Settings['lyricStyle']; name: string; en: string }[] = [
    { id: 'luminous', name: '光晕', en: 'Luminous' },
    { id: 'flow', name: '滚动', en: 'Flow' },
    ...FOLIA_MODES.map(m => ({ id: m.id as Settings['lyricStyle'], name: m.name, en: m.en })),
];

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
    return (
        <section className="mb-7">
            <h3 className="text-[13px] font-semibold text-white/50">{title}</h3>
            {desc && <p className="mt-1 text-[12px] leading-relaxed text-white/35">{desc}</p>}
            <div className="mt-3 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03]">{children}</div>
        </section>
    );
}

function Item({ title, desc, children, column }: { title: ReactNode; desc?: ReactNode; children?: ReactNode; column?: boolean }) {
    return (
        <div className={cx('flex gap-4 px-4 py-3.5', column ? 'flex-col' : 'items-center max-sm:flex-wrap max-sm:gap-y-2.5 max-sm:[&>:not(:first-child)]:ml-auto')}>
            <div className={cx('min-w-0 flex-1', !column && 'max-sm:min-w-[55%]')}>
                <div className="text-[13.5px] font-medium text-white/90">{title}</div>
                {desc && <div className="mt-0.5 text-[12px] leading-relaxed text-white/40">{desc}</div>}
            </div>
            {children}
        </div>
    );
}

function Toggle({ k, title, desc }: { k: keyof Settings; title: string; desc?: string }) {
    const value = useSettings(s => s[k]) as boolean;
    return <Item title={title} desc={desc}><Switch checked={value} onChange={v => setSetting(k, v as never)} /></Item>;
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
            <Section title="音质与容错" desc="音质按偏好从高到低尝试；每个链接播放前都会先探测，失效链接（403/404/410、错误页）会被自动跳过，不会再出现无限重试。">
                <Item title="首选音质" desc="实际音质取决于歌曲与音源支持情况"><Segmented size="sm" value={s.quality} onChange={v => setSetting('quality', v)} options={QUALITY_OPTIONS} /></Item>
                <Toggle k="qualityFallback" title="首选音质不可用时自动切换其他音质" />
                <Toggle k="autoSwitchSource" title="当前平台无法播放时自动换源" desc="按歌名、歌手与时长在其他平台匹配同一首歌" />
                <Toggle k="skipOnError" title="播放失败自动跳到下一首" desc="连续多首失败会自动停止并提示" />
                <Toggle k="resumePlayback" title="启动时恢复上次的播放队列与进度" />
            </Section>
            <Section title="输出">
                <Item title="交叉淡入淡出" desc={s.crossfade ? `切歌时前后两首重叠 ${s.crossfade} 秒` : '关闭'}>
                    <div className="flex w-56 items-center gap-3"><Slider value={s.crossfade} min={0} max={10} step={1} onChange={v => setSetting('crossfade', v)} className="flex-1" thumb /><span className="w-8 text-right font-mono text-[12px]">{s.crossfade}s</span></div>
                </Item>
                <Item title="音频输出设备">
                    <select value={s.outputDevice} onChange={e => setSetting('outputDevice', e.target.value)} className="no-drag h-9 max-w-[260px] rounded-xl border border-white/10 bg-black/30 px-3 text-[13px] outline-none">
                        <option value="default">系统默认</option>
                        {devices.filter(d => d.deviceId && d.deviceId !== 'default').map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `设备 ${d.deviceId.slice(0, 6)}`}</option>)}
                    </select>
                </Item>
                <Item title="均衡器" desc={s.eqEnabled ? `预设：${presetName || '自定义'}` : '关闭'}><Switch checked={s.eqEnabled} onChange={v => setSetting('eqEnabled', v)} /></Item>
                {s.eqEnabled && (
                    <div className="px-4 pb-4 pt-1">
                        <div className="mb-4 flex flex-wrap gap-1.5">
                            {Object.entries(EQ_PRESETS).map(([name, gains]) => (
                                <button key={name} type="button" onClick={() => setSetting('eqGains', [...gains])} className={cx('h-7 rounded-full px-3 text-[12px]', presetName === name ? 'bg-white text-black' : 'bg-white/[0.08] text-white/70 hover:bg-white/15')}>{name}</button>
                            ))}
                        </div>
                        <div className="grid grid-cols-5 gap-4">
                            {EQ_BANDS.map((band, i) => (
                                <div key={band} className="flex flex-col items-center gap-2">
                                    <span className="font-mono text-[11px] text-white/70">{s.eqGains[i] > 0 ? '+' : ''}{s.eqGains[i]}dB</span>
                                    <Slider value={s.eqGains[i]} min={-12} max={12} step={1} onChange={v => { const g = [...s.eqGains]; g[i] = v; setSetting('eqGains', g); }} className="w-full" thumb />
                                    <span className="font-mono text-[10px] text-white/40">{band >= 1000 ? `${band / 1000}k` : band}Hz</span>
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
                        {record.version && <span className="font-mono text-[11px] text-white/40">{/^v/i.test(record.version) ? record.version : `v${record.version}`}</span>}
                        {record.builtin && <span className="rounded-full bg-white/10 px-1.5 py-px text-[10px] text-white/55">内置</span>}
                        {isAggregateSource(record.id) && <span className="rounded-full bg-sky-300/15 px-1.5 py-px text-[10px] text-sky-200/85" title="内含多个子音源，按平台竞速取链、失败自动换用其他子源">聚合</span>}
                        <span className={cx('text-[11px]', status === 'error' ? 'text-red-300' : 'text-white/40')}>{statusText}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-white/40">{[record.author && `作者 ${record.author}`, record.description].filter(Boolean).join(' · ') || '—'}</div>
                    {runtime?.error && <div className="mt-1 text-[12px] text-red-300/90">{runtime.error}</div>}
                    {runtime?.sources && (
                        <div className="mt-2 flex flex-wrap gap-1">
                            {Object.entries(runtime.sources).filter(([p]) => p !== 'local').map(([p, cap]) => (
                                <span key={p} className={cx('rounded-md px-1.5 py-0.5 font-mono text-[10px]', (runtime.platformFailures?.[p] || 0) >= 3 ? 'bg-amber-400/10 text-amber-200/80' : 'bg-white/[0.07] text-white/60')} title={(runtime.platformFailures?.[p] || 0) >= 3 ? '最近多次取链失败，已自动降低优先级' : ''}>
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
                <div className="scroll-thin mt-3 max-h-48 overflow-y-auto rounded-xl bg-black/35 p-3 font-mono text-[10.5px] leading-relaxed text-white/55">
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
                            <input value={input} onChange={e => setInput(e.target.value)} placeholder="https://…/source.js" className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-[13px] outline-none focus:border-white/25" />
                        ) : (
                            <textarea value={input} onChange={e => setInput(e.target.value)} placeholder={'/**\n * @name 音源名称\n * @version 1.0.0\n */\n…'} className="scroll-thin h-40 w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[12px] outline-none focus:border-white/25" />
                        )}
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setMode('none')}>取消</Button>
                            <Button variant="white" disabled={!input.trim() || busy} onClick={() => (mode === 'url' ? fromUrl() : install(input))}>{busy && <Spinner />}导入</Button>
                        </div>
                    </div>
                )}
            </Section>
            <Section title={`已安装（${records.length}）`} desc="排在前面的音源优先使用；某平台连续取链失败的音源会被临时排到后面。">
                {records.length ? records.map((r, i) => <SourceCard key={r.id} record={r} index={i} count={records.length} />) : <div className="px-4 py-6 text-center text-[13px] text-white/40">还没有音源，请导入洛雪自定义源脚本</div>}
            </Section>
            <Section title="网络限制" desc="禁止音源脚本访问的域名（每行一个，含子域名）。脚本只能访问公网地址，本机与局域网地址始终被拦截。">
                <div className="space-y-2 px-4 py-3.5">
                    <textarea value={blockText} onChange={e => setBlockText(e.target.value)} placeholder="example.com" className="scroll-thin h-24 w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[12px] outline-none focus:border-white/25" />
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
                <Item column title="歌词样式" desc="Luminous：逐字飞入、辉光高亮；Flow：经典滚动歌词；其余 8 种是风格各异的动态歌词，每种动画的细节参数在播放页「设置」面板里调整。">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        {LYRIC_STYLES.map(o => (
                            <button key={o.id} type="button" onClick={() => setSetting('lyricStyle', o.id)} className={cx('flex min-w-0 flex-col items-start rounded-xl px-3 py-2 text-left transition-colors', s.lyricStyle === o.id ? 'bg-white/[0.2] text-white' : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white')}>
                                <span className="max-w-full truncate text-[13px] font-semibold leading-tight">{o.name}</span>
                                <span className="max-w-full truncate text-[10.5px] leading-tight text-white/40">{o.en}</span>
                            </button>
                        ))}
                    </div>
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
        </Section>
        <Section title="背景与主题">
            <Item title="播放页背景"><Segmented size="sm" value={s.background} onChange={v => setSetting('background', v)} options={[{ value: 'latent', label: 'Latent 流体' }, { value: 'blur', label: '模糊封面' }, { value: 'solid', label: '纯色' }]} /></Item>
            <Toggle k="dither" title="半色调网点" desc="在背景上叠加细腻的网点纹理" />
            <Toggle k="reactive" title="背景随节奏律动" desc="根据低频能量轻微改变流体亮度与流速" />
            <Item title="配色"><Segmented size="sm" value={s.theme} onChange={v => setSetting('theme', v)} options={[{ value: 'default', label: '默认' }, { value: 'cover', label: '封面取色' }, { value: 'custom', label: '自定义' }]} /></Item>
            {s.theme === 'custom' && <Item title="自定义主色"><input type="color" value={s.customAccent} onChange={e => setSetting('customAccent', e.target.value)} className="h-8 w-14 cursor-pointer rounded-md border-0 bg-transparent" /></Item>}
            <Toggle k="reduceMotion" title="减少动效" desc="降低动画与背景流速，适合低性能设备" />
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
                                {profile && current === p && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-semibold text-white/70">乐库显示中</span>}
                            </span>
                        }
                        desc={profile ? (status === 'expired' ? `${profile.nickname} · 登录已失效，请重新扫码` : status === 'checking' ? `${profile.nickname} · 正在校验登录状态…` : `${profile.nickname} · ID ${profile.id}`) : `未登录 · 使用${meta.scanWith}扫码登录`}
                    >
                        <div className="flex gap-2">
                            {profile && status !== 'expired' && current !== p && <Button variant="ghost" onClick={() => setSetting('libraryAccount', p)}>在乐库显示</Button>}
                            {(!profile || status === 'expired') && <Button variant="white" onClick={() => ui.dialog({ type: 'login', platform: p })}>扫码登录</Button>}
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
                    <select value={s.fileNameTemplate} onChange={e => setSetting('fileNameTemplate', e.target.value)} className="no-drag h-9 rounded-xl border border-white/10 bg-black/30 px-3 text-[13px] outline-none">
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
                                    <div className="truncate text-[13px] font-medium">{item.track.name} <span className="text-white/40">· {item.track.singer}</span></div>
                                    <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-white/40">
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
                ) : <div className="px-4 py-6 text-center text-[13px] text-white/40">暂无下载</div>}
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
                        <FolderOpen className="h-4 w-4 shrink-0 text-white/45" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-white/75">{displayPath(f)}</span>
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
    ['Ctrl + → / ←', '下一首 / 上一首'],
    ['→ / ←', '播放页：快进 / 快退 5 秒；封面流：切换封面；乐库：平移'],
    ['拖动 / 滚轮', '乐库：平移拼贴墙（Shift + 方向键一次移动 3 格）'],
    ['/', '乐库：过滤当前页'],
    ['Home', '乐库：回到起点'],
    ['↑ / ↓', '播放页：音量 +/- 5%'],
    ['Ctrl + K / Ctrl + F', '搜索'],
    ['Ctrl + P', '打开 / 关闭播放页'],
    ['L', '喜欢当前歌曲'],
    ['M', '静音'],
    ['F11', '全屏'],
    ['Ctrl + ,', '设置'],
    ['Esc', '关闭当前浮层'],
];

function AboutTab() {
    const [version, setVersion] = useState('');
    useEffect(() => { host.version().then(setVersion).catch(() => {}); }, []);
    return (
        <>
            <div className="mb-7 flex items-center gap-4">
                <img src={appIcon} alt="" draggable={false} className="h-16 w-16 rounded-[18px] shadow-[0_12px_40px_rgba(0,168,96,.32)]" />
                <div>
                    <div className="text-[22px] font-bold tracking-tight">YEmusic</div>
                    <div className="font-mono text-[12px] text-white/45">v{version || '0.5.2'} · 融合洛雪音源生态与沉浸式界面的音乐播放器（Windows / Android）</div>
                    {chromeMajor() > 0 && <div className="mt-0.5 text-[11.5px] text-white/35">{isAndroid ? 'Android System WebView' : 'Chromium'} {chromeMajor()}{OLD_WEBVIEW ? '（版本较旧，部分界面效果已自动降级；可在应用商店更新「Android System WebView」与 Chrome）' : ''}</div>}
                </div>
            </div>
            {!isAndroid && <Section title="快捷键">
                {SHORTCUTS.map(([k, v]) => <div key={k} className="flex items-center justify-between px-4 py-2.5 text-[13px]"><span className="text-white/70">{v}</span><kbd>{k}</kbd></div>)}
            </Section>}
            <Section title="开源许可与致谢">
                <div className="space-y-2.5 px-4 py-3.5 text-[12.5px] leading-relaxed text-white/55">
                    <p>YEmusic 自有代码以 Apache License 2.0 发布。自 0.5.0 起集成了 Folia 的歌词动画代码（AGPL-3.0），因此包含这些代码的整体程序（安装包 / APK）按 AGPL-3.0 分发：分发时必须同时向接收者提供对应的完整源码与许可文本（见源码中的 LICENSE-AGPL-3.0.txt）。</p>
                    <p>洛雪自定义源兼容层（lx API 语义）与各平台元数据接口的实现参考了 <button type="button" className="text-white/80 underline-offset-2 hover:underline" onClick={() => host.openExternal('https://github.com/lyswhut/lx-music-desktop')}>lx-music-desktop</button>（Apache-2.0，© lyswhut），相关代码已按许可保留版权声明。</p>
                    <p>歌词动画“莫奈 / 回环 / 镜台 / 时计 / 商籁 / 凝彩 / 静止 / 绘光”及其渲染器、参数面板源自 <button type="button" className="text-white/80 underline-offset-2 hover:underline" onClick={() => host.openExternal('https://github.com/chthollyphile/folia-major')}>Folia</button> v0.7.20（AGPL-3.0，© chthollyphile 及贡献者），已保留版权声明与许可，适配改动记录在源码的 VENDOR.md 中。其余界面（乐库拼贴墙、封面流首页、悬浮面板等）为独立编写，设计上致敬 Folia。</p>
                    <p>扫码登录的二维码由 QRCode for JavaScript 生成（MIT，© Kazuhiko Arase）。“QR Code”是 DENSO WAVE 的注册商标。</p>
                    <p>内置音源脚本（含 YEmusic 聚合音源中的子音源）由各自作者提供，版权归原作者；YEmusic 不提供、不存储任何音乐内容，请支持正版音乐。</p>
                </div>
            </Section>
        </>
    );
}

export function SettingsModal() {
    const open = useUi(s => s.settingsOpen);
    const tab = useUi(s => s.settingsTab);
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !useUi.getState().dialog) { e.stopPropagation(); ui.closeSettings(); } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open]);
    return (
        <AnimatePresence>
            {open && (
                <motion.div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-6 backdrop-blur-md max-sm:p-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={e => { if (e.target === e.currentTarget) ui.closeSettings(); }}>
                    <motion.div className="relative flex h-[min(680px,100%)] w-[min(980px,100%)] overflow-hidden rounded-[30px] border border-white/10 bg-[rgba(20,19,25,0.95)] shadow-[0_40px_140px_rgba(0,0,0,.65)] max-sm:h-full max-sm:flex-col max-sm:rounded-none max-sm:border-0" initial={{ scale: 0.95, y: 16, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 32 }}>
                        <nav className="scroll-none flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-white/[0.06] p-4 max-sm:mr-12 max-sm:w-auto max-sm:flex-row max-sm:gap-1 max-sm:overflow-x-auto max-sm:border-r-0 max-sm:p-2">
                            <div className="mb-4 px-3 pt-2 text-[20px] font-bold tracking-tight max-sm:hidden">设置</div>
                            {TABS.map(t => (
                                <button key={t.id} type="button" onClick={() => useUi.setState({ settingsTab: t.id })} className={cx('flex h-10 items-center gap-3 rounded-xl px-3 text-[13.5px] transition-colors max-sm:shrink-0 max-sm:gap-2 max-sm:whitespace-nowrap', tab === t.id ? 'bg-white/[0.1] font-semibold text-white' : 'text-white/55 hover:bg-white/[0.05] hover:text-white/85')}>
                                    <t.icon className="h-4 w-4" />{t.label}
                                </button>
                            ))}
                        </nav>
                        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto px-8 pb-6 pt-7 max-sm:border-t max-sm:border-white/[0.06] max-sm:px-4 max-sm:pb-12 max-sm:pt-4">
                            {tab === 'playback' && <PlaybackTab />}
                            {tab === 'sources' && <SourcesTab />}
                            {tab === 'lyrics' && <LyricsTab />}
                            {tab === 'appearance' && <AppearanceTab />}
                            {tab === 'download' && <DownloadTab />}
                            {tab === 'library' && <LibraryTab />}
                            {tab === 'about' && <AboutTab />}
                        </div>
                        <IconButton label="关闭 (Esc)" size="sm" className="absolute right-4 top-4 max-sm:right-2.5 max-sm:top-2.5" onClick={ui.closeSettings}><X className="h-4 w-4" /></IconButton>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
