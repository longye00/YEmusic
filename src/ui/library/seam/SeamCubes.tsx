/** 书签空白处缓缓转动的点阵立方体（纯装饰，画在 canvas 上，不拦截鼠标） */
import { useEffect, useRef } from 'react';

const N = 9;
/** 立方体表面的点阵（[-1, 1]³，每个面 (N+1)² 个点，棱上的点会重复，无所谓） */
const POINTS: [number, number, number][] = (() => {
    const out: [number, number, number][] = [];
    for (let i = 0; i <= N; i++) {
        for (let j = 0; j <= N; j++) {
            const a = -1 + (2 * i) / N;
            const b = -1 + (2 * j) / N;
            out.push([a, b, -1], [a, b, 1], [a, -1, b], [a, 1, b], [-1, a, b], [1, a, b]);
        }
    }
    return out;
})();

/** 两个立方体：位置是相对空白区的比例（size 为相对主立方体的大小），drift 控制缓慢漂移的幅度 */
const CUBES = [
    { x: 0.5, y: 0.4, size: 1, spin: 0.32, phase: 0.4, drift: 0.05 },
    { x: 0.12, y: 0.82, size: 0.62, spin: -0.22, phase: 2.1, drift: 0.08 },
];
/** 画布比空白区上下各多出这么多，立方体靠边时不会被横着切开 */
const BLEED = 48;

export function SeamCubes({ paused }: { paused?: boolean }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;

    useEffect(() => {
        const canvas = ref.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion');
        let raf = 0;
        let last = -1e9;
        const t0 = performance.now();
        const draw = (now: number) => {
            const w = canvas.clientWidth;
            const fullH = canvas.clientHeight;
            const h = fullH - BLEED * 2;
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const pw = Math.round(w * dpr);
            const ph = Math.round(fullH * dpr);
            if (canvas.width !== pw || canvas.height !== ph) {
                canvas.width = pw;
                canvas.height = ph;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, fullH);
            // 空白区太小就不画
            if (w < 24 || h < 40) return;
            const t = (now - t0) / 1000;
            const base = Math.min(w * 0.46, h * 0.66, 58);
            for (const [i, cube] of CUBES.entries()) {
                if (i > 0 && h < 150) break;
                const half = (base * cube.size) / 2;
                const cx = w * (cube.x + Math.sin(t * 0.07 + cube.phase) * cube.drift);
                const cy = BLEED + h * (cube.y + Math.cos(t * 0.05 + cube.phase) * cube.drift * 0.6);
                const ay = t * cube.spin + cube.phase;
                const ax = 0.46 + Math.sin(t * 0.11 + cube.phase) * 0.14;
                const sy = Math.sin(ay);
                const cyy = Math.cos(ay);
                const sx = Math.sin(ax);
                const cxx = Math.cos(ax);
                for (const [px, py, pz] of POINTS) {
                    // 绕 Y 再绕 X 旋转，简单透视
                    const x1 = px * cyy + pz * sy;
                    const z1 = -px * sy + pz * cyy;
                    const y2 = py * cxx - z1 * sx;
                    const z2 = py * sx + z1 * cxx;
                    const k = 3.2 / (3.2 + z2);
                    const alpha = 0.08 + 0.34 * ((1 - z2) / 2);
                    ctx.fillStyle = `rgba(247,244,238,${alpha.toFixed(3)})`;
                    const r = 0.95 * k;
                    ctx.fillRect(cx + x1 * half * k - r / 2, cy + y2 * half * k - r / 2, r, r);
                }
            }
        };
        const loop = (now: number) => {
            raf = requestAnimationFrame(loop);
            if (pausedRef.current || now - last < 40) return;
            last = now;
            draw(now);
        };
        if (reduce) draw(t0 + 4000);
        else raf = requestAnimationFrame(loop);
        const ro = new ResizeObserver(() => draw(performance.now()));
        ro.observe(canvas);
        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
        };
    }, []);

    return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-x-[-10px]" style={{ top: -BLEED, bottom: -BLEED, width: 'calc(100% + 20px)', height: `calc(100% + ${BLEED * 2}px)` }} />;
}
