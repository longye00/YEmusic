/** 乐库卡片的生成式背景（没有封面的歌单、电台、操作卡片） */
import type { ReactNode } from 'react';
import { Radio } from 'lucide-react';
import { useCover } from '../hooks';

function hashOf(seed: string) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    return hash;
}

/** 渐变 + 网点 + 圆环，不含文字（标题由卡片统一绘制） */
export function PatternArt({ seed, icon, tone }: { seed: string; icon?: ReactNode; tone?: [number, number] }) {
    const hash = hashOf(seed);
    const hue = tone ? tone[0] : hash % 360;
    const hue2 = tone ? tone[1] : (hue + 40 + (hash % 80)) % 360;
    return (
        <div className="absolute inset-0 overflow-hidden" style={{ background: `radial-gradient(110% 80% at 85% 5%, hsl(${hue2} 70% 58% / .8), transparent 55%), radial-gradient(90% 90% at 0% 100%, hsl(${hue} 65% 36%), transparent 70%), linear-gradient(160deg, hsl(${hue} 50% 20%), hsl(${hue2} 45% 10%))` }}>
            <div className="halftone absolute inset-0 opacity-25" />
            <div className="absolute -right-[12%] -top-[12%] h-[62%] w-[62%] rounded-full border border-white/20" />
            <div className="absolute right-[4%] top-[10%] h-[34%] w-[34%] rounded-full border border-white/10" />
            {icon && <div className="absolute left-[10%] top-[16%] text-white/80 [&>svg]:h-[clamp(22px,22%,64px)] [&>svg]:w-[clamp(22px,22%,64px)]">{icon}</div>}
        </div>
    );
}

/** 私人FM：深色舞台 + 一束光；正在播放时叠上当前歌曲封面 */
export function FmArt({ cover }: { cover?: string }) {
    const url = useCover(cover);
    return (
        <div className="absolute inset-0 overflow-hidden bg-[#0b0b10]">
            {url && <img src={url} alt="" draggable={false} referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover opacity-55 blur-[1px]" />}
            <div className="absolute inset-0" style={{ background: 'conic-gradient(from 200deg at 38% -10%, transparent 0deg, rgb(150 190 255 / .38) 14deg, transparent 30deg)' }} />
            <div className="absolute inset-0" style={{ background: 'radial-gradient(60% 50% at 40% 100%, rgb(120 150 255 / .22), transparent 70%)' }} />
            <div className="absolute right-[10%] top-[12%] grid h-[24%] max-h-16 w-[24%] max-w-16 place-items-center rounded-full border border-white/25 text-white/70">
                <Radio className="h-1/2 w-1/2" strokeWidth={1.6} />
            </div>
        </div>
    );
}

/** 每日推荐：大号日期 */
export function DailyArt() {
    const now = new Date();
    return (
        <div className="absolute inset-0 overflow-hidden" style={{ background: 'radial-gradient(90% 70% at 80% 0%, rgb(255 120 120 / .55), transparent 60%), linear-gradient(160deg, #3a1020, #12070d)' }}>
            <div className="halftone absolute inset-0 opacity-20" />
            <div className="absolute right-[8%] top-[4%] font-black leading-none tracking-tighter text-white/90" style={{ fontSize: 'clamp(56px, 42cqmin, 220px)' }}>{now.getDate()}</div>
            <div className="absolute right-[9%] top-[calc(4%+clamp(56px,42cqmin,220px))] font-mono text-[11px] uppercase tracking-[0.3em] text-white/55">{now.toLocaleString('en', { month: 'short' })}</div>
        </div>
    );
}
