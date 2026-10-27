/**
 * “Latent” 风格流体背景：WebGL 域扭曲噪声 + 颜色平滑过渡 + 可选音频律动；
 * 其上叠加一层按设备像素对齐的 4×4 Bayer 有序抖动（warp 图案，soft-light 混合），
 * 形成像素画质感的网点层。无 WebGL 时退回 CSS 渐变 / CSS 网点。
 */
import { useEffect, useRef, useState } from 'react';
import { useLite } from '@/lib/lite';
import type { RGB } from '../theme';
import { css } from '../theme';

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uC0, uC1, uC2, uC3;
uniform float uEnergy;
uniform float uDim;

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(dot(hash2(i), f), dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
               mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = m * p;
        a *= 0.5;
    }
    return v;
}
void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
    float t = uTime * 0.035;
    vec2 q = vec2(fbm(p * 1.1 + vec2(0.0, t)), fbm(p * 1.1 + vec2(5.2, 1.3) - t * 0.8));
    vec2 r = vec2(fbm(p * 1.3 + 2.6 * q + vec2(1.7, 9.2) + t * 0.6), fbm(p * 1.3 + 2.6 * q + vec2(8.3, 2.8) - t * 0.5));
    float f = fbm(p * 1.2 + (2.2 + uEnergy * 0.8) * r);
    float g = 0.5 + 0.5 * f;
    vec3 col = mix(uC0, uC1, smoothstep(0.2, 0.75, g));
    col = mix(col, uC2, smoothstep(0.25, 0.95, length(q) * 1.15) * 0.85);
    col = mix(col, uC3, smoothstep(0.55, 1.05, g + r.x * 0.35) * 0.55);
    // 烟雾状的亮色丝带
    float band = abs(sin((f + r.y * 0.6) * 9.0 + t * 2.0));
    float streak = smoothstep(0.985, 1.0, 1.0 - band * 0.08 - abs(r.x) * 0.02) * smoothstep(0.1, 0.6, length(r));
    col += uC2 * streak * 0.35;
    // 大尺度暗部，营造 Folia 式的明暗对比
    float shade = smoothstep(-0.2, 0.55, fbm(p * 0.7 - vec2(t * 0.4, -t * 0.3)) + 0.25);
    col *= mix(0.35, 1.05, shade);
    col *= 1.0 + uEnergy * 0.25;
    float vig = smoothstep(1.25, 0.25, length(uv - 0.5) * 1.35);
    col *= mix(0.6, 1.0, vig);
    col *= uDim;
    gl_FragColor = vec4(pow(max(col, 0.0), vec3(0.95)), 1.0);
}`;

interface Props {
    colors: [RGB, RGB, RGB, RGB];
    dim?: number;
    dither?: boolean;
    grain?: boolean;
    speed?: number;
    /** 每帧调用，返回 0..1 的低频能量 */
    energy?: () => number;
    paused?: boolean;
    className?: string;
    scale?: number;
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader error');
    return shader;
}

const DITHER_FRAG = `precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uBack, uFront;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y) * 2.4;
    float t = uTime;
    for (float i = 1.0; i < 5.0; i += 1.0) {
        p.x += 0.6 / i * cos(i * 2.5 * p.y + t);
        p.y += 0.6 / i * cos(i * 1.5 * p.x + t * 0.8);
    }
    float shape = 0.5 + 0.5 * sin(p.x + p.y + t * 0.35);
    shape = smoothstep(0.08, 0.92, shape);
    float on = step(0.5, shape + (bayer4(gl_FragCoord.xy) - 0.5));
    gl_FragColor = vec4(mix(uBack, uFront, on), 1.0);
}`;

/** 像素对齐的有序抖动层（单个网点约 2.5 CSS 像素） */
export function DitherLayer({ back, front, opacity = 0.4, speed = 1, energy, paused, cell = 2.5 }: { back: RGB; front: RGB; opacity?: number; speed?: number; energy?: () => number; paused?: boolean; cell?: number }) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const target = useRef({ back, front, opacity, speed, energy, paused });
    const [failed, setFailed] = useState(false);
    target.current = { back, front, opacity, speed, energy, paused };

    useEffect(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;
        const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
        if (!gl) {
            setFailed(true);
            return;
        }
        let program: WebGLProgram;
        try {
            program = gl.createProgram()!;
            gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
            gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, DITHER_FRAG));
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link failed');
        } catch (error) {
            console.warn('[dither] WebGL 初始化失败', error);
            setFailed(true);
            return;
        }
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(program, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const uRes = gl.getUniformLocation(program, 'uRes');
        const uTime = gl.getUniformLocation(program, 'uTime');
        const uBack = gl.getUniformLocation(program, 'uBack');
        const uFront = gl.getUniformLocation(program, 'uFront');
        const back0 = target.current.back.map(v => v / 255);
        const front0 = target.current.front.map(v => v / 255);
        let time = Math.random() * 50;
        let last = performance.now();
        let lastDraw = 0;
        let energyValue = 0;
        let frame = 0;
        /** 尺寸变化后需要重画一次（暂停时也是） */
        let dirty = true;
        const resize = () => {
            dirty = true;
            // 每个网点占整数个设备像素，避免缩放造成的疏密不均
            const dpr = window.devicePixelRatio || 1;
            const px = Math.max(1, Math.round(cell * dpr));
            const w = Math.max(1, Math.ceil((wrap.clientWidth * dpr) / px));
            const h = Math.max(1, Math.ceil((wrap.clientHeight * dpr) / px));
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
                gl.viewport(0, 0, w, h);
            }
            canvas.style.width = `${(w * px) / dpr}px`;
            canvas.style.height = `${(h * px) / dpr}px`;
        };
        const observer = new ResizeObserver(resize);
        observer.observe(wrap);
        resize();
        const draw = (now: number) => {
            frame = requestAnimationFrame(draw);
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            const t = target.current;
            if (document.hidden || now - lastDraw < 48) return;
            lastDraw = now;
            const e = t.energy ? t.energy() : 0;
            energyValue += (e - energyValue) * Math.min(1, dt * 6);
            if (!t.paused) time += dt * 2.4 * (0.12 * t.speed + energyValue * 0.25);
            const k = 1 - Math.pow(0.04, dt * 2);
            for (let j = 0; j < 3; j++) {
                back0[j] += (t.back[j] / 255 - back0[j]) * k;
                front0[j] += (t.front[j] / 255 - front0[j]) * k;
            }
            // 暂停且颜色已经过渡完：画面不会再变，不必重复绘制（省电 / 省 GPU）
            let drift = energyValue;
            for (let j = 0; j < 3; j++) drift = Math.max(drift, Math.abs(t.back[j] / 255 - back0[j]), Math.abs(t.front[j] / 255 - front0[j]));
            if (t.paused && drift < 0.003 && !dirty) return;
            dirty = false;
            wrap.style.opacity = String(Math.min(1, t.opacity + energyValue * 0.25));
            gl.uniform2f(uRes, canvas.width, canvas.height);
            gl.uniform1f(uTime, time);
            gl.uniform3f(uBack, back0[0], back0[1], back0[2]);
            gl.uniform3f(uFront, front0[0], front0[1], front0[2]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        frame = requestAnimationFrame(draw);
        const onLost = (event: Event) => {
            event.preventDefault();
            cancelAnimationFrame(frame);
            setFailed(true);
        };
        canvas.addEventListener('webglcontextlost', onLost);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            canvas.removeEventListener('webglcontextlost', onLost);
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        };
    }, [cell]);

    if (failed) return <div className="halftone pointer-events-none absolute inset-0 opacity-30" />;
    return (
        <div ref={wrapRef} className="pointer-events-none absolute inset-0 overflow-hidden" style={{ mixBlendMode: 'soft-light', opacity }}>
            <canvas ref={canvasRef} className="absolute left-0 top-0" style={{ imageRendering: 'pixelated' }} />
        </div>
    );
}

export function FluidBackground({ colors, dim = 1, dither = true, grain = true, speed = 1, energy, paused, className = '', scale: scaleProp }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const target = useRef({ colors, dim, speed, energy, paused });
    const [failed, setFailed] = useState(false);
    const lite = useLite();
    // 精简模式（手机）：更低的渲染分辨率、更少的噪声层数、更低的帧率；颜色是大块渐变，肉眼几乎看不出区别
    const scale = scaleProp ?? (lite ? 0.3 : 0.5);
    const octaves = lite ? 3 : 5;
    const interval = lite ? 45 : 32;
    target.current = { colors, dim, speed, energy, paused };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
        if (!gl) {
            setFailed(true);
            return;
        }
        let program: WebGLProgram;
        try {
            program = gl.createProgram()!;
            gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
            gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG.replace('i < 5', `i < ${octaves}`)));
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link failed');
        } catch (error) {
            console.warn('[fluid] WebGL 初始化失败', error);
            setFailed(true);
            return;
        }
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(program, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const u = (name: string) => gl.getUniformLocation(program, name);
        const uRes = u('uRes'), uTime = u('uTime'), uEnergy = u('uEnergy'), uDim = u('uDim');
        const uC = [u('uC0'), u('uC1'), u('uC2'), u('uC3')];
        const current = target.current.colors.map(c => c.map(v => v / 255));
        let currentDim = target.current.dim;
        let energyValue = 0;
        let time = Math.random() * 100;
        let last = performance.now();
        let lastDraw = 0;
        let frame = 0;
        let timer = 0;
        /** 首帧 / 尺寸变化后需要重画一次（暂停时也是） */
        let dirty = true;
        const wake = (delay: number) => {
            timer = window.setTimeout(() => { frame = requestAnimationFrame(draw); }, delay);
        };
        const resize = () => {
            dirty = true;
            const w = Math.max(1, Math.round(canvas.clientWidth * scale));
            const h = Math.max(1, Math.round(canvas.clientHeight * scale));
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
                gl.viewport(0, 0, w, h);
            }
        };
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();
        const draw = (now: number): void => {
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            const t = target.current;
            if (document.hidden) return wake(500);
            // 约 30fps（精简模式 22fps）即可，节省 GPU
            if (now - lastDraw < interval) {
                frame = requestAnimationFrame(draw);
                return;
            }
            lastDraw = now;
            if (!t.paused) time += dt * 2 * t.speed;
            const k = 1 - Math.pow(0.04, dt * 2);
            let drift = 0;
            for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
                const goal = t.colors[i][j] / 255;
                drift = Math.max(drift, Math.abs(goal - current[i][j]));
                current[i][j] += (goal - current[i][j]) * k;
            }
            drift = Math.max(drift, Math.abs(t.dim - currentDim));
            currentDim += (t.dim - currentDim) * k;
            const e = t.energy ? t.energy() : 0;
            energyValue += (e - energyValue) * Math.min(1, dt * 6);
            // 暂停（被不透明的乐库墙盖住、播放页换了别的背景……）且颜色已过渡完：画面不会再变，
            // 不再绘制，只是隔一会儿醒来看看有没有变化。这是手机上乐库首页卡顿的主要来源之一
            if (t.paused && !t.energy && !dirty && drift < 0.003 && energyValue < 0.003) return wake(250);
            dirty = false;
            gl.uniform2f(uRes, canvas.width, canvas.height);
            gl.uniform1f(uTime, time);
            gl.uniform1f(uEnergy, energyValue);
            gl.uniform1f(uDim, currentDim);
            for (let i = 0; i < 4; i++) gl.uniform3f(uC[i], current[i][0], current[i][1], current[i][2]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        const onLost = (event: Event) => {
            event.preventDefault();
            cancelAnimationFrame(frame);
            clearTimeout(timer);
            setFailed(true);
        };
        canvas.addEventListener('webglcontextlost', onLost);
        return () => {
            cancelAnimationFrame(frame);
            clearTimeout(timer);
            observer.disconnect();
            canvas.removeEventListener('webglcontextlost', onLost);
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        };
    }, [scale, octaves, interval]);

    return (
        <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
            {failed ? (
                <div
                    className="absolute inset-0 transition-[background] duration-1000"
                    style={{
                        background: `radial-gradient(120% 90% at 20% 20%, ${css(colors[2])} 0%, transparent 55%), radial-gradient(100% 80% at 80% 70%, ${css(colors[3], 0.8)} 0%, transparent 60%), radial-gradient(140% 120% at 50% 50%, ${css(colors[1])} 0%, ${css(colors[0])} 70%)`,
                        filter: `brightness(${dim})`,
                    }}
                />
            ) : (
                <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
            )}
            {dither && !lite && <DitherLayer back={colors[0]} front={colors[3]} speed={speed} energy={energy} paused={paused} />}
            {grain && !lite && <div className="grain absolute inset-0 opacity-[0.07]" />}
        </div>
    );
}
