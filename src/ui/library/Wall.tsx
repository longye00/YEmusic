/**
 * 乐库拼贴墙：可无限拖动的封面马赛克，中间夹着一张“书签”（seam）。
 *
 * - 卡片按“图块”（patch）打包，图块在四个方向无缝重复。格子以半格为单位（1×1 / 1×1.5 / 1.5×1 / 2×2 / 3×2 …），
 *   每 BAND 个半格是一条“竖带”，卡片从不跨越竖带边界，所以书签可以在任意一条带边界上把墙“撕开”：
 *   边界左边的卡片整体左移、右边的右移，书签就夹在缝里，跟着墙一起被拖动。
 * - 书签被拖到屏幕边缘时会被挤窄，挤没了就在屏幕边上留一个“乐库”标签，点它在视线附近的边界重新打开。
 * - 只渲染视口附近的格子，拖动 / 惯性 / 滚轮 / 方向键都直接改 transform，跨格时才重新计算可见块。
 * （布局与交互为 YEmusic 独立实现，设计参考 Folia 的“乐库”视图。）
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import { seededRandom, thumbUrl } from '@/lib/util';
import { imageStatus, queueImage, type ImageStatus } from '@/lib/imageQueue';
import { useCover } from '../hooks';
import { PlayingBars, cx } from '../components/common';
import { PatternArt } from './art';

export interface WallCard {
    key: string;
    title: string;
    desc?: string;
    /** 左上角小标签，如“歌单 · 56” */
    badge?: string;
    badgeIcon?: ReactNode;
    /** 醒目的强调色标签（电台、每日推荐等） */
    special?: boolean;
    cover?: string;
    /** 没有封面时的生成式背景 */
    art?: ReactNode;
    /** 优先占大格 */
    featured?: boolean;
    /** 集合（歌单 / 专辑）：右下角露出叠起来的书页边 */
    stack?: boolean;
    /** 高亮（如正在播放的电台） */
    active?: boolean;
    /** 操作卡片（新建 / 导入 / 登录等） */
    action?: boolean;
    onOpen: () => void;
    onPlay?: () => void;
}

export interface WallHandle {
    /** 回到起点：书签回到视线位置，内容从头开始 */
    recenter: () => void;
    /** 随机跳到远处的一块区域 */
    shuffle: () => void;
    panBy: (dx: number, dy: number) => void;
    /** 在视线附近重新打开书签；width 为即将显示的内容宽度（不传则用当前目标宽度） */
    openHere: (width?: number) => void;
    /** 书签当前的屏幕矩形（收起 / 被挤没时为 null） */
    seamRect: () => DOMRect | null;
}

interface Block { c: number; r: number; w: number; h: number; card: number }
interface Patch { cols: number; rows: number; blocks: Block[] }

/** 卡片之间的缝隙（px） */
export const GAP = 8;
/** 一条竖带的宽度（半格数）：书签只在竖带边界打开 */
const BAND = 12;
/** 书签离屏幕边缘至少留的距离 */
const EDGE_ROOM = 14;
/** 墙顶部的起始偏移 */
const TOP = 6;
const SEAM_TWEEN_MS = 360;
/** [宽, 高, 权重]，单位为半格 */
const SPANS: [number, number, number][] = [
    [2, 2, 0.3], [2, 3, 0.15], [3, 2, 0.11], [3, 3, 0.05], [4, 2, 0.07], [2, 4, 0.06], [4, 3, 0.07], [4, 4, 0.08], [6, 4, 0.04], [6, 3, 0.03], [3, 4, 0.04],
];
const AVG_AREA = SPANS.reduce((sum, [w, h, p]) => sum + w * h * p, 0) / SPANS.reduce((sum, s) => sum + s[2], 0);

/**
 * 在 cols × rows 的半格网格里铺卡片。规则保证不留 1 个半格宽 / 高的空洞：
 * 每次放置后，同一行剩下的连续空位与到底部的剩余高度都不会正好是 1。
 * once：每张卡片只放一次（有限布局）；之后的空位用空画框（card = -1）补齐成矩形。
 */
function pack(cols: number, rows: number, featured: boolean[], seed: string, band: number, once = false): Block[] {
    const count = featured.length;
    const rand = seededRandom(`${seed}:${cols}x${rows}`);
    const owner = new Int32Array(cols * rows).fill(-1);
    const blocks: Block[] = [];
    let placed = 0;
    let limit = rows;
    let perm: number[] = [];
    let cycle = -1;
    const put = (c: number, r: number, w: number, h: number, card: number) => {
        const index = blocks.length;
        blocks.push({ c, r, w, h, card });
        for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) owner[y * cols + x] = index;
    };
    for (let r = 0; r < limit; r++) {
        for (let c = 0; c < cols; c++) {
            if (owner[r * cols + c] >= 0) continue;
            const bandEnd = Math.min(cols, (Math.floor(c / band) + 1) * band);
            let run = 0;
            while (c + run < bandEnd && owner[r * cols + c + run] < 0) run++;
            if (once && placed >= count) {
                // 有限布局收尾：空画框补齐到最后一行
                const w = run <= 3 ? run : run - 2 === 1 ? 3 : 2;
                const left = limit - r;
                put(c, r, w, left <= 3 ? left : left - 2 === 1 ? 3 : 2, -1);
                continue;
            }
            const hRem = rows - r;
            const ok = (w: number, h: number) => w <= run && run - w !== 1 && h <= hRem && hRem - h !== 1;
            const order = placed;
            const k = Math.floor(order / count);
            const pos = order % count;
            if (k !== cycle) {
                cycle = k;
                perm = Array.from({ length: count }, (_, i) => i);
                // 第一轮保持原顺序（重要的卡片排在起点附近），之后每轮打乱
                if (k > 0) for (let i = count - 1; i > 0; i--) {
                    const j = Math.floor(rand() * (i + 1));
                    [perm[i], perm[j]] = [perm[j], perm[i]];
                }
            }
            // 避免与左侧 / 上方的块是同一张卡片
            const left = c > 0 ? owner[r * cols + c - 1] : -1;
            const up = r > 0 ? owner[(r - 1) * cols + c] : -1;
            const same = (i: number) => (left >= 0 && blocks[left].card === perm[i]) || (up >= 0 && blocks[up].card === perm[i]);
            if (count > 2 && same(pos) && pos + 1 < count) [perm[pos], perm[pos + 1]] = [perm[pos + 1], perm[pos]];
            const card = perm[pos];
            let span: [number, number] | null = null;
            if (featured[card] && k === 0) {
                const big = ([[6, 4], [4, 4], [4, 3]] as [number, number][]).filter(([w, h]) => ok(w, h));
                if (big.length) span = big[0][0] === 6 && rand() < 0.55 ? big[0] : big.find(([w]) => w === 4) || big[0];
            }
            if (!span) {
                const options = SPANS.filter(([w, h]) => ok(w, h));
                const total = options.reduce((sum, o) => sum + o[2], 0);
                let pick = rand() * total;
                for (const [w, h, p] of options) {
                    pick -= p;
                    if (pick <= 0) {
                        span = [w, h];
                        break;
                    }
                }
            }
            // 兜底：run、hRem 都至少为 2（见上面的规则），2 / 3 总能放下
            if (!span) span = [run === 3 ? 3 : 2, hRem === 3 ? 3 : 2];
            put(c, r, span[0], span[1], card);
            placed++;
            if (once && placed >= count) limit = blocks.reduce((max, b) => Math.max(max, b.r + b.h), 0);
        }
    }
    return blocks;
}

function buildPatch(featured: boolean[], seed: string): Patch {
    const count = Math.max(1, featured.length);
    const area = Math.max(count * AVG_AREA * 1.06, BAND * 8);
    const cols = BAND * Math.max(2, Math.round(Math.sqrt(area * 1.5) / BAND));
    let rows = Math.max(8, Math.ceil(area / cols));
    let blocks = pack(cols, rows, featured, seed, BAND);
    // 保证每张卡片在图块里至少出现一次
    while (new Set(blocks.map(b => b.card)).size < count && rows < 800) {
        rows += Math.max(2, Math.ceil((count - new Set(blocks.map(b => b.card)).size) * AVG_AREA / cols));
        blocks = pack(cols, rows, featured, seed, BAND);
    }
    return { cols, rows, blocks };
}

/** 有限布局（过滤结果、卡片很少时）：每张卡片只出现一次，铺在书签右侧 */
function buildFinitePatch(featured: boolean[], seed: string, cols: number): Patch {
    const count = Math.max(1, featured.length);
    const width = Math.max(2, cols);
    const blocks = featured.length ? pack(width, Math.ceil((count * 16) / width) + 6, featured, `${seed}:once`, width, true) : [];
    const rows = blocks.reduce((max, b) => Math.max(max, b.r + b.h), 0);
    return { cols: width, rows, blocks };
}

/** 一格（1×1 卡片 + 缝隙）的边长：宽屏 208，中屏 176，窄屏 144；窗口很矮时再缩小 */
export function wallCellFor(width: number, height: number) {
    const base = width >= 1100 ? 208 : width >= 640 ? 176 : width >= 480 ? 144 : 120;
    return 2 * Math.round(Math.min(base, Math.max(128, height / 3.6)) / 2);
}

/** 书签中线在屏幕上的默认位置 */
export const seamLineFor = (width: number) => Math.round(width * (width < 640 ? 0.2 : 0.28));

function TileImage({ src, px, seed, priority }: { src?: string; px: number; seed: string; priority: number }) {
    const url = useCover(thumbUrl(src, px));
    const queued = Boolean(url && /^https?:/i.test(url));
    const [status, setStatus] = useState<ImageStatus | 'loading'>(() => (!url ? 'error' : !queued ? 'ok' : imageStatus(url) ?? 'loading'));
    // 首次渲染时已加载过的封面不再淡入
    const [instant, setInstant] = useState(status === 'ok');
    const priorityRef = useRef(priority);
    priorityRef.current = priority;
    useEffect(() => {
        if (!url) {
            setStatus('error');
            return;
        }
        if (!queued) {
            setStatus('ok');
            return;
        }
        const known = imageStatus(url);
        if (known) {
            setStatus(known);
            return;
        }
        setStatus('loading');
        setInstant(false);
        return queueImage(url, setStatus, priorityRef.current);
    }, [url, queued]);
    if (!url || status === 'error') return <PatternArt seed={seed} />;
    if (status !== 'ok') return null;
    return <img src={url} alt="" draggable={false} decoding="async" referrerPolicy="no-referrer" onError={() => setStatus('error')} className={cx('absolute inset-0 h-full w-full object-cover', !instant && 'img-in')} />;
}

interface TileProps {
    card: WallCard;
    x: number;
    y: number;
    w: number;
    h: number;
    delay?: number;
    /** 封面加载优先级（只在挂载时使用） */
    priority: number;
    ignoreClick: () => boolean;
}

const Tile = memo(function Tile({ card, x, y, w, h, delay, priority, ignoreClick }: TileProps) {
    const [enterDelay] = useState(delay);
    return (
        <div className="wall-cell" style={{ left: x, top: y, width: w, height: h }}>
            <div
                role="button"
                tabIndex={-1}
                title={card.desc ? `${card.title}\n${card.desc}` : card.title}
                onClick={() => { if (!ignoreClick()) card.onOpen(); }}
                onDoubleClick={() => { if (!ignoreClick()) card.onPlay?.(); }}
                className={cx('wall-poster', card.stack && 'is-stack', card.active && 'is-current', card.action && 'is-action', enterDelay !== undefined && 'wall-flip-in')}
                style={enterDelay !== undefined ? { animationDelay: `${enterDelay}ms` } : undefined}
            >
                <div className="wall-art">{card.art || <TileImage src={card.cover} px={Math.max(w, h)} seed={card.title} priority={priority} />}</div>
                <div className="wall-shade" />
                {card.badge && (
                    <div className={cx('wall-badge', card.special && 'is-special')}>
                        {card.active ? <PlayingBars className="h-2.5" /> : card.badgeIcon}
                        <span className="truncate">{card.badge}</span>
                    </div>
                )}
                <div className="wall-copy">
                    <div className="wall-title">{card.title}</div>
                    {card.desc && <div className="wall-sub">{card.desc}</div>}
                </div>
                <div className="wall-tint" />
                {card.onPlay && (
                    <button
                        type="button"
                        title="播放"
                        onClick={event => {
                            event.stopPropagation();
                            if (!ignoreClick()) card.onPlay?.();
                        }}
                        className="wall-play no-drag"
                    >
                        <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
                    </button>
                )}
            </div>
        </div>
    );
}, (a, b) => a.card === b.card && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.ignoreClick === b.ignoreClick);

const Frame = memo(function Frame({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
    return <div className="wall-cell" style={{ left: x, top: y, width: w, height: h }}><div className="wall-frame" /></div>;
});

interface WallProps {
    cards: WallCard[];
    /** 布局种子（通常为标签页 + 卡片数）；变化时整面墙翻牌换内容 */
    seed: string;
    cell: number;
    /** 是否响应方向键 */
    keyboard?: boolean;
    /** 有限布局：卡片不重复、不无限平铺，只能上下滚动 */
    finite?: boolean;
    handle?: MutableRefObject<WallHandle | null>;
    /** 书签的目标宽度；0 = 收起（只剩屏幕边上的标签） */
    seamWidth: number;
    /** 书签里的内容 */
    seam: ReactNode;
    /** 屏幕边上标签的文字 */
    edgeLabel: string;
    /** 收起状态下点了边上的标签（由外部恢复书签等级） */
    onRestore: () => void;
}

type Seam = { anchorC: number; cur: number; from: number; to: number; t0: number; target: number; visible: number };

export function Wall({ cards, seed, cell, keyboard = true, finite = false, handle, seamWidth, seam, edgeLabel, onRestore }: WallProps) {
    const unit = cell / 2;
    const viewportRef = useRef<HTMLDivElement>(null);
    const leftRef = useRef<HTMLDivElement>(null);
    const rightRef = useRef<HTMLDivElement>(null);
    const seamRef = useRef<HTMLDivElement>(null);
    const seamW = useRef(-1);
    const seamShown = useRef<boolean | null>(null);
    const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
    const sizeRef = useRef(size);
    sizeRef.current = size;
    const lineX = seamLineFor(size.w);
    const lineRef = useRef(lineX);
    const unitRef = useRef(unit);
    const seamS = useRef<Seam>({ anchorC: 0, cur: seamWidth, from: seamWidth, to: seamWidth, t0: 0, target: seamWidth, visible: seamWidth });
    const cam = useRef({ x: -lineX, y: -TOP, vx: 0, vy: 0, tx: NaN, ty: NaN });
    const origin = useRef({ c: 0, r: 0 });
    const drag = useRef<{ id: number; sx: number; sy: number; cx: number; cy: number; moved: boolean; lx: number; ly: number; lt: number; vx: number; vy: number } | null>(null);
    const suppressUntil = useRef(0);
    const raf = useRef(0);
    const lastFrame = useRef(0);
    const [anchorC, setAnchorC] = useState(0);
    /** 翻牌批次：变化时所有卡片重新挂载并按离书签的距离依次翻入 */
    const [wave, setWave] = useState({ n: 0, at: performance.now() });
    const [view, setView] = useState(() => ({ c0: Math.floor(-lineX / cell), r0: 0 }));
    const viewRef = useRef(view);
    const [edge, setEdge] = useState<{ show: boolean; side: 'left' | 'right' }>({ show: seamWidth === 0, side: 'left' });
    const edgeRef = useRef(edge);
    const [grabbing, setGrabbing] = useState(false);

    const featuredKey = cards.map(c => (c.featured ? 1 : 0)).join('');
    const finiteCols = finite ? Math.max(2, Math.floor((size.w - lineX - Math.max(seamWidth, 64) / 2 - GAP * 2) / unit)) : 0;
    const patch = useMemo(() => {
        const flags = cards.map(c => Boolean(c.featured));
        return finite || !cards.length ? buildFinitePatch(flags, seed, finiteCols) : buildPatch(flags, seed);
    }, [seed, featuredKey, finite, finiteCols, cards.length]); // eslint-disable-line react-hooks/exhaustive-deps
    const patchRef = useRef(patch);
    patchRef.current = patch;
    const fixed = finite || !cards.length;

    // 有限布局的可滚动范围（相机坐标）
    const bounds = useRef<{ x: number; minY: number; maxY: number } | null>(null);
    bounds.current = fixed ? { x: seamS.current.anchorC * unit - lineX, minY: -TOP, maxY: Math.max(-TOP, patch.rows * unit + 120 - size.h) } : null;

    const apply = useCallback(() => {
        const k = cam.current;
        const s = seamS.current;
        const u = unitRef.current;
        const { w: vw } = sizeRef.current;
        const b = bounds.current;
        if (b) {
            const y = Math.min(b.maxY, Math.max(b.minY, k.y));
            if (y !== k.y) k.vy = 0;
            k.x = b.x;
            k.vx = 0;
            k.y = y;
            if (!Number.isNaN(k.tx)) {
                k.tx = b.x;
                k.ty = Math.min(b.maxY, Math.max(b.minY, k.ty));
            }
        }
        // 书签几何：边界的屏幕位置、能打开多宽（离屏幕边越近越窄）
        const screenX = s.anchorC * u - k.x;
        const room = Math.min(screenX, vw - screenX) - EDGE_ROOM;
        const width = b ? s.cur : Math.max(0, Math.min(s.cur, room * 2));
        s.visible = width;
        const pad = (GAP / 2) * Math.min(1, width / 16);
        const half = width > 0 ? width / 2 + pad : 0;
        if (leftRef.current) leftRef.current.style.transform = `translate3d(${-k.x - half}px, ${-k.y}px, 0)`;
        if (rightRef.current) rightRef.current.style.transform = `translate3d(${-k.x + half}px, ${-k.y}px, 0)`;
        const el = seamRef.current;
        if (el) {
            // 拖动时只改 transform（合成层位移，不触发布局 / 重绘）；宽度只在变化时才写
            el.style.transform = `translate3d(${screenX - width / 2}px, 0, 0)`;
            if (width !== seamW.current) {
                seamW.current = width;
                el.style.width = `${width}px`;
            }
            const visible = width >= 1;
            if (visible !== seamShown.current) {
                seamShown.current = visible;
                el.style.visibility = visible ? 'visible' : 'hidden';
            }
        }
        const show = s.target === 0 || width < 2;
        const side: 'left' | 'right' = screenX < lineRef.current + 1 ? 'left' : 'right';
        if (show !== edgeRef.current.show || (show && side !== edgeRef.current.side)) {
            edgeRef.current = { show, side };
            setEdge(edgeRef.current);
        }
        const c0 = Math.floor(k.x / (u * 2));
        const r0 = Math.floor(k.y / (u * 2));
        if (c0 !== viewRef.current.c0 || r0 !== viewRef.current.r0) {
            viewRef.current = { c0, r0 };
            setView(viewRef.current);
        }
    }, []);

    const frame = useCallback((now: number) => {
        const k = cam.current;
        const s = seamS.current;
        const dt = Math.min(48, Math.max(1, now - (lastFrame.current || now - 16)));
        lastFrame.current = now;
        let moving = false;
        if (s.cur !== s.to) {
            const p = Math.min(1, (now - s.t0) / SEAM_TWEEN_MS);
            const e = 1 - Math.pow(1 - p, 3);
            s.cur = p >= 1 ? s.to : s.from + (s.to - s.from) * e;
            moving = true;
        }
        if (!Number.isNaN(k.tx)) {
            const ease = 1 - Math.pow(1 - 0.16, dt / 16.67);
            const dx = k.tx - k.x;
            const dy = k.ty - k.y;
            if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) {
                k.x = k.tx;
                k.y = k.ty;
                k.tx = k.ty = NaN;
            } else {
                k.x += dx * ease;
                k.y += dy * ease;
                moving = true;
            }
        } else if (!drag.current?.moved && (Math.abs(k.vx) > 0.01 || Math.abs(k.vy) > 0.01)) {
            k.x += k.vx * dt;
            k.y += k.vy * dt;
            const decay = Math.pow(0.94, dt / 16.67);
            k.vx *= decay;
            k.vy *= decay;
            moving = true;
        }
        apply();
        raf.current = moving ? requestAnimationFrame(frame) : 0;
    }, [apply]);

    const kick = useCallback(() => {
        if (!raf.current) {
            lastFrame.current = 0;
            raf.current = requestAnimationFrame(frame);
        }
    }, [frame]);

    useEffect(() => () => cancelAnimationFrame(raf.current), []);

    const tweenSeam = useCallback((from: number, to: number) => {
        const s = seamS.current;
        s.cur = from;
        s.from = from;
        s.to = to;
        s.t0 = performance.now();
        kick();
    }, [kick]);

    const setAnchor = useCallback((c: number) => {
        seamS.current.anchorC = c;
        setAnchorC(c);
    }, []);

    /** 在视线附近挑一条竖带边界打开书签：相机尽量少挪，挪到能完整放下书签为止 */
    const seamHere = useCallback((width: number) => {
        const k = cam.current;
        const u = unitRef.current;
        const { w: vw } = sizeRef.current;
        const line = lineRef.current;
        const bandPx = BAND * u;
        const need = Math.min(vw / 2, width / 2 + EDGE_ROOM);
        const base = Math.round((k.x + line) / bandPx);
        let best = { i: base, sx: 0, fit: 0, score: Infinity };
        for (let i = base - 2; i <= base + 2; i++) {
            const sx = i * bandPx - k.x;
            const fit = Math.max(need, Math.min(vw - need, sx));
            const score = Math.abs(fit - sx) + 0.15 * Math.abs(fit - line);
            if (score < best.score) best = { i, sx, fit, score };
        }
        const sameBand = best.i * BAND === seamS.current.anchorC;
        setAnchor(best.i * BAND);
        if (Math.abs(best.fit - best.sx) > 0.5) {
            k.vx = k.vy = 0;
            k.tx = k.x + (best.sx - best.fit);
            k.ty = Number.isNaN(k.ty) ? k.y : k.ty;
        }
        // 还在原来那条竖带上：从当前宽度接着变宽，不用先缩成 0 再长出来
        tweenSeam(sameBand ? Math.min(seamS.current.cur, width) : 0, width);
    }, [setAnchor, tweenSeam]);

    // 书签宽度变化：收起 / 展开 / 换内容（首页 120 ↔ 书脊 64 ↔ 登录 300）
    useEffect(() => {
        const s = seamS.current;
        if (seamWidth === s.target) return;
        const wasClosed = s.target === 0 || s.visible < 2;
        s.target = seamWidth;
        if (seamWidth > 0 && wasClosed && !bounds.current) seamHere(seamWidth);
        else tweenSeam(s.cur, seamWidth);
    }, [seamWidth, seamHere, tweenSeam]);

    // 换内容（换标签页 / 过滤）：内容从书签处重新开始，整面墙翻牌
    const firstSeed = useRef(true);
    useLayoutEffect(() => {
        if (firstSeed.current) {
            firstSeed.current = false;
            return;
        }
        const k = cam.current;
        const s = seamS.current;
        const u = unitRef.current;
        const line = lineRef.current;
        k.vx = k.vy = 0;
        k.tx = k.ty = NaN;
        if (!bounds.current && (s.target === 0 || s.visible < 2)) {
            // 书签收着 / 被挤没了：内容换成从视线处开始，书签也在那里重新打开
            const i = Math.round((k.x + line) / (BAND * u));
            setAnchor(i * BAND);
            if (s.target > 0) tweenSeam(0, s.target);
        }
        if (bounds.current || s.target === 0 || s.visible < 2) k.x = s.anchorC * u - line;
        origin.current = { c: s.anchorC, r: 0 };
        k.y = -TOP;
        setWave(w => ({ n: w.n + 1, at: performance.now() }));
        apply();
    }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

    useLayoutEffect(() => {
        apply();
    }, [apply, patch]);

    // 窗口缩放：书签中线跟着移动；格子尺寸变化时按比例换算相机位置
    useLayoutEffect(() => {
        const k = cam.current;
        const s = seamS.current;
        const oldUnit = unitRef.current;
        const oldLine = lineRef.current;
        if (oldUnit !== unit) {
            const screenX = s.anchorC * oldUnit - k.x;
            k.x = s.anchorC * unit - screenX;
            k.y = ((k.y + TOP) * unit) / oldUnit - TOP;
            k.tx = k.ty = NaN;
            unitRef.current = unit;
        }
        if (oldLine !== lineX) {
            k.x -= lineX - oldLine;
            if (!Number.isNaN(k.tx)) k.tx -= lineX - oldLine;
            lineRef.current = lineX;
        }
        apply();
    }, [unit, lineX, apply]);

    useEffect(() => {
        const el = viewportRef.current;
        if (!el) return;
        const observer = new ResizeObserver(entries => {
            const rect = entries[0]?.contentRect;
            if (rect) setSize({ w: rect.width, h: rect.height });
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const panTo = useCallback((x: number, y: number) => {
        const k = cam.current;
        k.vx = k.vy = 0;
        k.tx = x;
        k.ty = y;
        kick();
    }, [kick]);

    const panBy = useCallback((dx: number, dy: number) => {
        const k = cam.current;
        panTo((Number.isNaN(k.tx) ? k.x : k.tx) + dx, (Number.isNaN(k.ty) ? k.y : k.ty) + dy);
    }, [panTo]);

    const recenter = useCallback(() => {
        const k = cam.current;
        const s = seamS.current;
        const u = unitRef.current;
        const p = patchRef.current;
        if (bounds.current) {
            panTo(k.x, -TOP);
            return;
        }
        if (s.target > 0 && s.visible < 2) seamHere(s.target);
        const tx = s.anchorC * u - lineRef.current;
        if ((((s.anchorC - origin.current.c) % p.cols) + p.cols) % p.cols !== 0) {
            // 书签换过位置：让内容从书签处重新开始（翻牌），相机直接就位
            origin.current = { c: s.anchorC, r: 0 };
            k.vx = k.vy = 0;
            k.tx = k.ty = NaN;
            k.x = tx;
            k.y = -TOP;
            setWave(w => ({ n: w.n + 1, at: performance.now() }));
            apply();
            return;
        }
        const period = p.rows * u;
        const base = origin.current.r * u - TOP;
        panTo(tx, base + Math.round((k.y - base) / period) * period);
    }, [apply, panTo, seamHere]);

    const openHere = useCallback((width?: number) => {
        const s = seamS.current;
        const w = width ?? s.target;
        if (w > 0) seamHere(w);
    }, [seamHere]);

    useEffect(() => {
        if (!handle) return;
        handle.current = {
            recenter,
            shuffle: () => {
                if (bounds.current) return;
                const angle = Math.random() * Math.PI * 2;
                const dist = (4 + Math.random() * 6) * cell;
                panBy(Math.round((Math.cos(angle) * dist) / cell) * cell, Math.round((Math.sin(angle) * dist) / cell) * cell);
            },
            panBy,
            openHere,
            seamRect: () => (seamRef.current && seamS.current.visible >= 2 ? seamRef.current.getBoundingClientRect() : null),
        };
        return () => { handle.current = null; };
    }, [handle, recenter, panBy, openHere, cell]);

    useEffect(() => {
        if (!keyboard) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
            if ((event.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable]')) return;
            const map: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
            const dir = map[event.key];
            if (dir) {
                event.preventDefault();
                panBy(dir[0] * cell * (event.shiftKey ? 3 : 1), dir[1] * cell * (event.shiftKey ? 3 : 1));
            } else if (event.key === 'Home') {
                event.preventDefault();
                recenter();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [keyboard, panBy, recenter, cell]);

    const ignoreClick = useCallback(() => performance.now() < suppressUntil.current || Boolean(drag.current?.moved), []);

    // ---------- 可见块 ----------
    const fresh = performance.now() - wave.at < 900;
    const left: ReactNode[] = [];
    const right: ReactNode[] = [];
    {
        const k = cam.current;
        const s = seamS.current;
        const maxHalf = Math.max(seamWidth, s.cur) / 2 + GAP;
        const c0 = Math.floor((k.x - maxHalf) / unit) - 4;
        const c1 = Math.ceil((k.x + size.w + maxHalf) / unit) + 4;
        const r0 = Math.floor(k.y / unit) - 4;
        const r1 = Math.ceil((k.y + size.h) / unit) + 4;
        const anchorX = anchorC * unit;
        const midY = k.y + size.h / 2;
        const viewRight = k.x + size.w;
        const delayOf = (x: number, y: number, w: number, h: number) => (fresh ? Math.round(Math.min(560, (Math.hypot(x + w / 2 - anchorX, (y + h / 2 - midY) * 0.6) / cell) * 55)) : undefined);
        const push = (c: number, node: ReactNode) => (c < anchorC ? left : right).push(node);
        if (cards.length) {
            const p = patch;
            const oc = origin.current.c;
            const or = origin.current.r;
            const px0 = fixed ? 0 : Math.floor((c0 - oc) / p.cols);
            const px1 = fixed ? 0 : Math.floor((c1 - oc) / p.cols);
            const py0 = fixed ? 0 : Math.floor((r0 - or) / p.rows);
            const py1 = fixed ? 0 : Math.floor((r1 - or) / p.rows);
            for (let py = py0; py <= py1; py++) {
                for (let px = px0; px <= px1; px++) {
                    const baseC = oc + px * p.cols;
                    const baseR = or + py * p.rows;
                    p.blocks.forEach((block, index) => {
                        const bc = baseC + block.c;
                        const br = baseR + block.r;
                        if (bc + block.w <= c0 || bc > c1 || br + block.h <= r0 || br > r1) return;
                        const x = bc * unit;
                        const y = br * unit;
                        const w = block.w * unit;
                        const h = block.h * unit;
                        const key = `${wave.n}:${px}_${py}_${index}`;
                        if (block.card < 0) {
                            push(bc, <Frame key={key} x={x} y={y} w={w} h={h} />);
                            return;
                        }
                        const onScreen = x < viewRight && x + w > k.x && y < k.y + size.h && y + h > k.y;
                        const priority = (onScreen ? (x >= anchorX ? 200 : 100) : 0) - Math.hypot(x + w / 2 - (anchorX + size.w / 3), y + h / 2 - midY) / cell;
                        push(bc, <Tile key={key} card={cards[block.card]} x={x} y={y} w={w} h={h} delay={delayOf(x, y, w, h)} priority={priority} ignoreClick={ignoreClick} />);
                    });
                }
            }
        }
        // 有限布局 / 空墙：其余位置用空画框铺满，保持墙面的格子感
        if (fixed) {
            const fc0 = c0 - (c0 & 1);
            for (let r = r0 - (r0 & 1); r <= r1; r += 2) {
                for (let c = fc0; c <= c1; c += 2) {
                    if (r < 0 || (cards.length > 0 && c + 1 >= anchorC && c < anchorC + patch.cols && r < patch.rows)) continue;
                    push(c, <Frame key={`f${wave.n}:${c}_${r}`} x={c * unit} y={r * unit} w={unit * 2} h={unit * 2} />);
                }
            }
        }
    }

    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

    return (
        <div
            ref={viewportRef}
            className={cx('wall-viewport absolute inset-0 touch-none select-none overflow-hidden', grabbing ? 'cursor-grabbing' : 'cursor-default')}
            onPointerDown={event => {
                if (event.button !== 0) return;
                const k = cam.current;
                k.vx = k.vy = 0;
                k.tx = k.ty = NaN;
                drag.current = { id: event.pointerId, sx: event.clientX, sy: event.clientY, cx: k.x, cy: k.y, moved: false, lx: event.clientX, ly: event.clientY, lt: performance.now(), vx: 0, vy: 0 };
            }}
            onPointerMove={event => {
                const d = drag.current;
                if (!d || d.id !== event.pointerId) return;
                const dx = event.clientX - d.sx;
                const dy = event.clientY - d.sy;
                if (!d.moved) {
                    if (Math.hypot(dx, dy) < 6) return;
                    d.moved = true;
                    setGrabbing(true);
                    try { viewportRef.current?.setPointerCapture(event.pointerId); } catch { /* ignore */ }
                }
                const now = performance.now();
                const dt = Math.max(1, now - d.lt);
                d.vx = d.vx * 0.5 + (-(event.clientX - d.lx) / dt) * 0.5;
                d.vy = d.vy * 0.5 + (-(event.clientY - d.ly) / dt) * 0.5;
                d.lx = event.clientX;
                d.ly = event.clientY;
                d.lt = now;
                cam.current.x = d.cx - dx;
                cam.current.y = d.cy - dy;
                apply();
            }}
            onPointerUp={event => {
                const d = drag.current;
                if (!d || d.id !== event.pointerId) return;
                drag.current = null;
                if (!d.moved) return;
                setGrabbing(false);
                suppressUntil.current = performance.now() + 80;
                const idle = performance.now() - d.lt;
                const k = cam.current;
                k.vx = idle < 90 ? Math.max(-4, Math.min(4, d.vx)) : 0;
                k.vy = idle < 90 ? Math.max(-4, Math.min(4, d.vy)) : 0;
                kick();
            }}
            onPointerCancel={() => {
                drag.current = null;
                setGrabbing(false);
            }}
            onWheel={event => {
                const scale = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? size.h : 1;
                const dx = (event.shiftKey ? event.deltaY : event.deltaX) * scale;
                const dy = (event.shiftKey ? 0 : event.deltaY) * scale;
                if (!dx && !dy) return;
                panBy(dx, dy);
            }}
        >
            <div ref={leftRef} className="absolute left-0 top-0 will-change-transform">{left}</div>
            <div ref={rightRef} className="absolute left-0 top-0 will-change-transform">{right}</div>
            <div ref={seamRef} className="seam" onPointerDown={stop} onWheel={stop} onDoubleClick={stop}>
                {seam}
            </div>
            {edge.show && (
                <button
                    type="button"
                    className={cx('seam-tab no-drag', edge.side === 'right' ? 'is-right' : 'is-left')}
                    onPointerDown={stop}
                    onClick={() => (seamS.current.target === 0 ? onRestore() : openHere())}
                    title={seamS.current.target === 0 ? '展开书签' : '在这里打开书签'}
                >
                    <span className="seam-vlabel">{edgeLabel}</span>
                </button>
            )}
        </div>
    );
}
