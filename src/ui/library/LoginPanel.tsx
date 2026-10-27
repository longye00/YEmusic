/** 在线平台扫码登录面板：乐库书签里的登录态与设置页的登录对话框共用 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, ScanLine, Smartphone, X } from 'lucide-react';
import { host, isAndroid } from '@/lib/host';
import qrMatrix from '@/lib/vendor/qrcode.js';
import { ACCOUNT_META, loginWithCookie, startQrLogin, type AccountPlatform, type LoginMethod, type LoginPhase, type LoginQr } from '@/store/accounts';
import { toast } from '@/store/toast';
import { Button, Spinner, cx } from '../components/common';

function QrSvg({ text, size }: { text: string; size: number }) {
    const path = useMemo(() => {
        const matrix: boolean[][] = qrMatrix(text, 'M');
        let d = '';
        matrix.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + 2} ${y + 2}h1v1h-1z`; }));
        return { d, n: matrix.length + 4 };
    }, [text]);
    return (
        <svg viewBox={`0 0 ${path.n} ${path.n}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label="登录二维码">
            <rect width={path.n} height={path.n} fill="#fff" />
            <path d={path.d} fill="#000" />
        </svg>
    );
}

export function PlatformBadge({ platform, size = 32, className }: { platform: AccountPlatform; size?: number; className?: string }) {
    const meta = ACCOUNT_META[platform];
    return (
        <span className={cx('grid shrink-0 place-items-center rounded-full font-black text-white', className)} style={{ width: size, height: size, background: meta.color, fontSize: Math.round(size * 0.44) }}>
            {meta.badge}
        </span>
    );
}

/** 把登录二维码画成一张留白充足的 PNG（用于保存到相册，再用别的 App 的“扫一扫 → 相册”识别） */
async function qrToPng(qr: LoginQr): Promise<Uint8Array> {
    const SIZE = 720;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法生成图片');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = false;
    if (qr.kind === 'text') {
        const matrix: boolean[][] = qrMatrix(qr.value, 'M');
        const cell = Math.max(1, Math.floor(SIZE / (matrix.length + 8)));
        const offset = Math.floor((SIZE - cell * matrix.length) / 2);
        ctx.fillStyle = '#000000';
        matrix.forEach((row, y) => row.forEach((on, x) => { if (on) ctx.fillRect(offset + x * cell, offset + y * cell, cell, cell); }));
    } else {
        const img = new Image();
        img.src = qr.value;
        await img.decode();
        const scale = Math.max(1, Math.floor((SIZE - 120) / Math.max(img.naturalWidth, 1)));
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, Math.floor((SIZE - w) / 2), Math.floor((SIZE - h) / 2), w, h);
    }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('生成图片失败');
    return new Uint8Array(await blob.arrayBuffer());
}

const COOKIE_HINT: Record<AccountPlatform, { text: string; placeholder: string }> = {
    wy: { text: '在浏览器登录 music.163.com 后，从开发者工具复制 Cookie（或其中 MUSIC_U 的值）粘贴到这里。', placeholder: 'MUSIC_U=…; __csrf=…' },
    tx: { text: '在浏览器登录 y.qq.com 后，从开发者工具复制 Cookie 粘贴到这里（需要包含 uin 与 qqmusic_key 或 qm_keyst）。', placeholder: 'uin=…; qqmusic_key=…' },
    kg: { text: '粘贴酷狗账号的 userid 与 token（可在已登录的酷狗网页 / 客户端请求里找到）。', placeholder: 'userid=…; token=…' },
};

export interface LoginPanelProps {
    platform: AccountPlatform;
    /** 登录成功 */
    onDone: () => void;
    onClose: () => void;
    /** seam：书签里（300px 宽）；dialog：对话框里 */
    variant: 'seam' | 'dialog';
    /** 书签底部要让出来的高度（播放胶囊），避免盖住下方的操作 */
    bottomSafe?: number;
}

export function LoginPanel({ platform, onDone, onClose, variant, bottomSafe = 0 }: LoginPanelProps) {
    const meta = ACCOUNT_META[platform];
    const [method, setMethod] = useState<LoginMethod>(platform === 'tx' ? 'qq' : 'qr');
    const [qr, setQr] = useState<LoginQr | null>(null);
    const [phase, setPhase] = useState<LoginPhase>({ phase: 'loading' });
    const [nonce, setNonce] = useState(0);
    const [manual, setManual] = useState(false);
    const [cookieText, setCookieText] = useState('');
    const [busy, setBusy] = useState(false);
    const doneRef = useRef(onDone);
    doneRef.current = onDone;

    useEffect(() => {
        if (manual) return;
        return startQrLogin(platform, method, setQr, next => {
            setPhase(next);
            if (next.phase === 'done') {
                toast(`已登录${meta.name}：${next.profile.nickname}`, 'success');
                setTimeout(() => doneRef.current(), 700);
            }
        });
    }, [platform, method, nonce, manual, meta.name]);

    const submitCookie = async () => {
        setBusy(true);
        try {
            const profile = await loginWithCookie(platform, cookieText);
            toast(`已登录${meta.name}：${profile.nickname}`, 'success');
            onDone();
        } catch (error) {
            toast(`登录失败：${(error as Error).message}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    // 同一台手机登录：二维码没法自己扫自己，先存进相册，再到对应 App 的“扫一扫 → 相册”里选它
    const scanApp = platform === 'wy' ? ({ key: 'netease', name: '网易云音乐', short: '网易云' } as const)
        : platform === 'kg' ? ({ key: 'kugou', name: '酷狗音乐', short: '酷狗' } as const)
            : method === 'wechat' ? ({ key: 'wechat', name: '微信', short: '微信' } as const)
                : ({ key: 'qq', name: 'QQ', short: 'QQ' } as const);
    const canSave = isAndroid && Boolean(host.saveImage) && Boolean(qr) && (phase.phase === 'waiting' || phase.phase === 'scanned');
    const saveQr = async () => {
        if (!qr || !host.saveImage) return;
        try {
            const data = await qrToPng(qr);
            await host.saveImage({ data, name: `YEmusic-${platform}-login-${Date.now().toString(36)}.png` });
            toast(`二维码已保存到相册。打开${scanApp.name}的「扫一扫」→ 点相册，选这张图`, 'success', { duration: 6000 });
        } catch (error) {
            toast(`保存失败：${(error as Error).message || '未知错误'}`, 'error');
        }
    };
    const openScanner = async () => {
        try {
            const ok = (await host.launchApp?.(scanApp.key)) ?? false;
            if (!ok) toast(`没有找到${scanApp.name}，请先安装，或换另一台设备扫码`, 'error');
        } catch {
            toast(`无法打开${scanApp.name}`, 'error');
        }
    };

    const qrSize = variant === 'seam' ? 196 : 200;
    const refresh = () => setNonce(n => n + 1);
    const scanWith = platform === 'tx' ? (method === 'wechat' ? '微信' : '手机 QQ') : meta.scanWith;
    const statusText =
        phase.phase === 'loading' ? '正在获取二维码…'
            : phase.phase === 'waiting' ? `打开${scanWith}，扫一扫登录`
                : phase.phase === 'scanned' ? '已扫码，请在手机上确认登录'
                    : phase.phase === 'finishing' ? '正在同步账号…'
                        : phase.phase === 'done' ? `已登录：${phase.profile.nickname}`
                            : phase.phase === 'expired' ? '二维码已过期'
                                : phase.phase === 'refused' ? '已在手机上取消登录'
                                    : phase.message;
    const overlay = phase.phase === 'scanned' || phase.phase === 'finishing' || phase.phase === 'done' || phase.phase === 'expired' || phase.phase === 'refused' || (phase.phase === 'error' && qr);

    return (
        <div className={cx('login-panel flex h-full flex-col', variant === 'seam' ? 'scroll-thin overflow-y-auto px-[22px] pt-5' : 'px-7 pb-7 pt-2')} style={variant === 'seam' ? { paddingBottom: bottomSafe } : undefined}>
            {variant === 'seam' && (
                <div className="flex items-center gap-2.5">
                    <PlatformBadge platform={platform} size={28} />
                    <div className="min-w-0 flex-1 text-[16px] font-extrabold tracking-[0.02em]">登录{meta.name}</div>
                    <button type="button" title="返回乐库" onClick={onClose} className="seam-icon no-drag !h-8 !w-8"><X /></button>
                </div>
            )}
            <p className={cx('text-[12px] leading-relaxed text-[color:var(--seam-ink-soft)]', variant === 'seam' ? 'mt-3' : '')}>
                登录是可选的：登录后乐库会显示{meta.perks}。凭据只保存在本机。
            </p>
            {!manual ? (
                <div className="mt-4 flex flex-col items-center">
                    {platform === 'tx' && (
                        <div className="mb-4 flex w-full rounded-[10px] bg-white/[0.06] p-[3px] text-[12.5px] font-bold">
                            {(['qq', 'wechat'] as LoginMethod[]).map(m => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setMethod(m)}
                                    className={cx('no-drag h-8 flex-1 rounded-[8px] transition-colors', method === m ? 'bg-[#f7f4ee] text-[#0b0b0c]' : 'text-white/60 hover:text-white')}
                                >
                                    {m === 'qq' ? 'QQ 扫码' : '微信扫码'}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="relative grid place-items-center overflow-hidden rounded-[14px] bg-white p-2 shadow-[0_18px_50px_rgba(0,0,0,.45)]" style={{ width: qrSize + 16, height: qrSize + 16 }}>
                        {qr?.kind === 'text' && <QrSvg text={qr.value} size={qrSize} />}
                        {qr?.kind === 'image' && <img src={qr.value} alt="登录二维码" draggable={false} style={{ width: qrSize, height: qrSize, imageRendering: 'pixelated' }} />}
                        {!qr && phase.phase !== 'error' && <Spinner className="h-6 w-6 text-black/50" />}
                        {overlay && (
                            <div className="absolute inset-0 grid place-items-center bg-white/92 text-center text-black backdrop-blur-[2px]">
                                {phase.phase === 'scanned' ? (
                                    <div className="flex flex-col items-center gap-2 px-4">
                                        {phase.avatarUrl ? <img src={phase.avatarUrl} alt="" className="h-14 w-14 rounded-full" referrerPolicy="no-referrer" /> : <Smartphone className="h-9 w-9 text-black/70" />}
                                        <div className="text-[14px] font-bold">{phase.nickname || '已扫码'}</div>
                                        <div className="text-[12px] text-black/55">请在手机上确认登录</div>
                                    </div>
                                ) : phase.phase === 'finishing' ? (
                                    <div className="flex flex-col items-center gap-2 text-[13px] font-medium"><Spinner className="h-6 w-6 text-black/60" />正在同步账号…</div>
                                ) : phase.phase === 'done' ? (
                                    <div className="flex flex-col items-center gap-2 text-[13px] font-semibold"><CheckCircle2 className="h-10 w-10 text-emerald-600" />{phase.profile.nickname}</div>
                                ) : (
                                    <button type="button" onClick={refresh} className="no-drag flex flex-col items-center gap-2 text-[13px] font-semibold">
                                        <RefreshCw className="h-7 w-7" />
                                        {phase.phase === 'expired' ? '二维码已过期，点击刷新' : '点击重新获取二维码'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    <div className={cx('mt-3.5 flex max-w-full items-start gap-2 text-center text-[12.5px] leading-snug', phase.phase === 'error' ? 'text-red-300' : 'text-white/75')}>
                        <span className="min-w-0">{statusText}</span>
                    </div>
                    {phase.phase === 'error' && !qr && <Button className="mt-3" onClick={refresh}><RefreshCw className="h-4 w-4" />重试</Button>}
                    {isAndroid ? (
                        <div className="mt-3.5 w-full space-y-2">
                            {canSave && (
                                <div className="flex gap-2">
                                    <Button className="min-w-0 flex-1 !px-2" onClick={saveQr}><Download className="h-4 w-4 shrink-0" />保存二维码</Button>
                                    <Button className="min-w-0 flex-1 !px-2" onClick={openScanner}><ScanLine className="h-4 w-4 shrink-0" /><span className="truncate">打开{scanApp.short}</span></Button>
                                </div>
                            )}
                            <p className="text-center text-[11.5px] leading-relaxed text-[color:var(--seam-ink-soft)]">
                                二维码需要用另一个设备扫，或者在这台手机上：先「保存二维码」，再打开{scanApp.name}，用「扫一扫」→ 相册选择这张图片。
                            </p>
                        </div>
                    ) : null}
                </div>
            ) : (
                <div className="mt-4 space-y-3">
                    <p className="text-[12px] leading-relaxed text-[color:var(--seam-ink-soft)]">{COOKIE_HINT[platform].text}</p>
                    <textarea
                        value={cookieText}
                        onChange={event => setCookieText(event.target.value)}
                        placeholder={COOKIE_HINT[platform].placeholder}
                        spellCheck={false}
                        className="no-drag scroll-thin h-28 w-full resize-none rounded-[12px] border border-white/10 bg-black/30 px-3.5 py-3 font-mono text-[11.5px] outline-none placeholder:text-white/25 focus:border-white/30"
                    />
                    <div className="flex justify-end">
                        <Button variant="white" onClick={submitCookie} disabled={busy || !cookieText.trim()}>{busy && <Spinner />}登录</Button>
                    </div>
                </div>
            )}
            <div className={cx('flex items-center justify-between gap-3 text-[12px]', variant === 'seam' ? 'mt-auto pb-2 pt-4' : 'mt-6 border-t border-white/[0.06] pt-4')}>
                <button type="button" className="no-drag text-left text-white/45 underline-offset-2 hover:text-white/80 hover:underline" onClick={() => setManual(m => !m)}>
                    {manual ? '返回扫码登录' : '扫码不可用？使用 Cookie 登录'}
                </button>
                {variant === 'dialog' && <Button variant="ghost" onClick={onClose}>稍后再说</Button>}
            </div>
        </div>
    );
}
