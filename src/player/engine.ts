/**
 * 音频引擎：双 <audio> 声道（用于交叉淡入淡出）+ WebAudio（均衡器 / 音量 / 频谱）。
 * 远程音频经主进程本地代理提供 CORS 头，因此可以安全接入 WebAudio。
 */
import { EQ_BANDS } from '@/store/settings';

export type EngineEvent =
    | { type: 'playing' }
    | { type: 'pause' }
    | { type: 'waiting' }
    | { type: 'ended' }
    | { type: 'error'; message: string }
    | { type: 'duration'; duration: number };

interface Deck {
    el: HTMLAudioElement;
    gain?: GainNode;
    id: number;
}

const MEDIA_ERRORS: Record<number, string> = {
    1: '加载被中断',
    2: '网络错误，音频下载失败',
    3: '音频解码失败（文件损坏或格式不支持）',
    4: '音频格式不受支持或链接已失效',
};

export function mediaErrorText(el: HTMLAudioElement) {
    const code = el.error?.code || 0;
    return MEDIA_ERRORS[code] || el.error?.message || '未知播放错误';
}

class AudioEngine {
    private ctx?: AudioContext;
    private decks: Deck[] = [];
    private active = 0;
    private eq: BiquadFilterNode[] = [];
    private master?: GainNode;
    private analyser?: AnalyserNode;
    private freq?: Uint8Array<ArrayBuffer>;
    /** 高分辨率频谱（2048 点 FFT）：给 Folia 歌词动画的分频段律动用 */
    private analyserHi?: AnalyserNode;
    private freqHi?: Uint8Array<ArrayBuffer>;
    private listeners = new Set<(event: EngineEvent) => void>();
    private volume = 0.8;
    private muted = false;
    private fadeTimer?: ReturnType<typeof setTimeout>;
    private pauseTimer?: ReturnType<typeof setTimeout>;
    private loadSeq = 0;

    constructor() {
        this.decks = [this.createDeck(0), this.createDeck(1)];
    }

    private createDeck(id: number): Deck {
        const el = new Audio();
        el.crossOrigin = 'anonymous';
        el.preload = 'auto';
        const deck: Deck = { el, id };
        const forward = (event: EngineEvent) => {
            if (this.decks[this.active] === deck) this.emit(event);
        };
        el.addEventListener('playing', () => forward({ type: 'playing' }));
        el.addEventListener('pause', () => forward({ type: 'pause' }));
        el.addEventListener('waiting', () => forward({ type: 'waiting' }));
        el.addEventListener('ended', () => forward({ type: 'ended' }));
        el.addEventListener('durationchange', () => {
            if (Number.isFinite(el.duration)) forward({ type: 'duration', duration: el.duration });
        });
        el.addEventListener('error', () => {
            if (!el.getAttribute('src')) return;
            forward({ type: 'error', message: mediaErrorText(el) });
        });
        return deck;
    }

    private ensureGraph() {
        if (this.ctx || typeof AudioContext === 'undefined') return;
        try {
            const ctx = new AudioContext({ latencyHint: 'playback' });
            const master = ctx.createGain();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.82;
            this.eq = EQ_BANDS.map((frequency, i) => {
                const node = ctx.createBiquadFilter();
                node.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
                node.frequency.value = frequency;
                node.Q.value = 1;
                node.gain.value = 0;
                return node;
            });
            for (let i = 0; i < this.eq.length - 1; i++) this.eq[i].connect(this.eq[i + 1]);
            this.eq[this.eq.length - 1].connect(master);
            master.connect(analyser);
            analyser.connect(ctx.destination);
            // 第二个分析节点只“旁听”，静音后接到输出以确保各平台都会持续处理它
            const analyserHi = ctx.createAnalyser();
            analyserHi.fftSize = 2048;
            analyserHi.smoothingTimeConstant = 0.6;
            const tap = ctx.createGain();
            tap.gain.value = 0;
            master.connect(analyserHi);
            analyserHi.connect(tap);
            tap.connect(ctx.destination);
            for (const deck of this.decks) {
                const source = ctx.createMediaElementSource(deck.el);
                deck.gain = ctx.createGain();
                deck.gain.gain.value = deck === this.decks[this.active] ? 1 : 0;
                source.connect(deck.gain).connect(this.eq[0]);
            }
            this.ctx = ctx;
            this.master = master;
            this.analyser = analyser;
            this.freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
            this.analyserHi = analyserHi;
            this.freqHi = new Uint8Array(new ArrayBuffer(analyserHi.frequencyBinCount));
            this.applyVolume();
        } catch (error) {
            console.warn('[engine] WebAudio 初始化失败，退回到普通播放', error);
        }
    }

    on(listener: (event: EngineEvent) => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(event: EngineEvent) {
        for (const listener of this.listeners) listener(event);
    }

    get el() {
        return this.decks[this.active].el;
    }

    get currentTime() {
        return this.el.currentTime || 0;
    }

    get duration() {
        const d = this.el.duration;
        return Number.isFinite(d) ? d : 0;
    }

    get paused() {
        return this.el.paused;
    }

    /** 正在出声（未暂停、未结束） */
    get playing() {
        return !this.el.paused && !this.el.ended;
    }

    get hasSource() {
        return Boolean(this.el.getAttribute('src'));
    }

    get buffered() {
        const el = this.el;
        try {
            for (let i = 0; i < el.buffered.length; i++) {
                if (el.buffered.start(i) <= el.currentTime && el.buffered.end(i) >= el.currentTime) return el.buffered.end(i);
            }
        } catch { /* ignore */ }
        return 0;
    }

    private applyVolume() {
        const v = this.muted ? 0 : Math.pow(this.volume, 1.6);
        if (this.master && this.ctx) {
            this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
            for (const deck of this.decks) deck.el.volume = 1;
        } else {
            for (const deck of this.decks) deck.el.volume = v;
        }
    }

    setVolume(volume: number, muted = this.muted) {
        this.volume = Math.max(0, Math.min(1, volume));
        this.muted = muted;
        this.applyVolume();
    }

    setEq(enabled: boolean, gains: number[]) {
        this.ensureGraph();
        this.eq.forEach((node, i) => {
            const value = enabled ? gains[i] || 0 : 0;
            if (this.ctx) node.gain.setTargetAtTime(value, this.ctx.currentTime, 0.05);
        });
    }

    async setOutputDevice(deviceId: string) {
        const id = deviceId === 'default' ? '' : deviceId;
        try {
            const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
            if (ctx?.setSinkId) await ctx.setSinkId(id);
            else for (const deck of this.decks) await (deck.el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(id);
            return true;
        } catch (error) {
            console.warn('[engine] 切换输出设备失败', error);
            return false;
        }
    }

    /** 低频能量 0..1，用于背景律动 */
    energy(): number {
        if (!this.analyser || !this.freq || this.el.paused) return 0;
        this.analyser.getByteFrequencyData(this.freq);
        let sum = 0;
        const bins = Math.min(24, this.freq.length);
        for (let i = 2; i < bins; i++) sum += this.freq[i];
        return sum / ((bins - 2) * 255);
    }

    spectrum(): Uint8Array | null {
        if (!this.analyser || !this.freq) return null;
        this.analyser.getByteFrequencyData(this.freq);
        return this.freq;
    }

    /** 2048 点 FFT 的幅度谱（0..255）与每个 bin 的带宽（Hz）；音频图未建立时为 null。返回的数组会被复用。 */
    fineSpectrum(): { data: Uint8Array<ArrayBuffer>; binHz: number } | null {
        if (!this.analyserHi || !this.freqHi || !this.ctx) return null;
        this.analyserHi.getByteFrequencyData(this.freqHi);
        return { data: this.freqHi, binHz: this.ctx.sampleRate / this.analyserHi.fftSize };
    }

    private waitReady(el: HTMLAudioElement, seq: number, timeoutMs: number): Promise<{ ok: boolean; error?: string }> {
        return new Promise(resolve => {
            const cleanup = () => {
                clearTimeout(timer);
                el.removeEventListener('canplay', onReady);
                el.removeEventListener('error', onError);
            };
            const onReady = () => { cleanup(); resolve({ ok: seq === this.loadSeq }); };
            const onError = () => { cleanup(); resolve({ ok: false, error: mediaErrorText(el) }); };
            const timer = setTimeout(() => { cleanup(); resolve({ ok: false, error: '缓冲超时，音频服务器无响应' }); }, timeoutMs);
            el.addEventListener('canplay', onReady);
            el.addEventListener('error', onError);
        });
    }

    /** 在当前声道加载并（可选）播放 */
    async load(url: string, options: { autoplay?: boolean; startAt?: number; timeoutMs?: number } = {}): Promise<{ ok: boolean; error?: string }> {
        this.ensureGraph();
        clearTimeout(this.pauseTimer);
        const seq = ++this.loadSeq;
        const other = this.decks[1 - this.active];
        other.el.pause();
        other.el.removeAttribute('src');
        other.el.load();
        if (other.gain) other.gain.gain.value = 0;
        const deck = this.decks[this.active];
        if (deck.gain && this.ctx) deck.gain.gain.setValueAtTime(1, this.ctx.currentTime);
        const el = deck.el;
        el.pause();
        el.src = url;
        el.load();
        const ready = await this.waitReady(el, seq, options.timeoutMs ?? 25000);
        if (seq !== this.loadSeq) return { ok: false, error: 'superseded' };
        if (!ready.ok) return ready;
        if (options.startAt && options.startAt > 0) {
            try { el.currentTime = options.startAt; } catch { /* ignore */ }
        }
        if (options.autoplay !== false) return this.play().then(() => ({ ok: true }), (error: Error) => ({ ok: false, error: error.message }));
        return { ok: true };
    }

    /** 在另一声道加载新曲并交叉淡入淡出 */
    async crossfade(url: string, seconds: number): Promise<{ ok: boolean; error?: string }> {
        this.ensureGraph();
        if (!this.ctx) return this.load(url);
        const seq = ++this.loadSeq;
        const from = this.decks[this.active];
        const to = this.decks[1 - this.active];
        to.el.src = url;
        to.el.load();
        const ready = await this.waitReady(to.el, seq, 20000);
        if (seq !== this.loadSeq) return { ok: false, error: 'superseded' };
        if (!ready.ok) return ready;
        const t = this.ctx.currentTime;
        to.gain!.gain.cancelScheduledValues(t);
        to.gain!.gain.setValueAtTime(0, t);
        to.gain!.gain.linearRampToValueAtTime(1, t + seconds);
        from.gain!.gain.cancelScheduledValues(t);
        from.gain!.gain.setValueAtTime(from.gain!.gain.value, t);
        from.gain!.gain.linearRampToValueAtTime(0, t + seconds);
        this.active = 1 - this.active;
        await to.el.play().catch(() => {});
        clearTimeout(this.fadeTimer);
        this.fadeTimer = setTimeout(() => {
            from.el.pause();
            from.el.removeAttribute('src');
            from.el.load();
        }, seconds * 1000 + 200);
        this.emit({ type: 'playing' });
        return { ok: true };
    }

    async play() {
        clearTimeout(this.pauseTimer);
        this.ensureGraph();
        if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => {});
        const deck = this.decks[this.active];
        if (deck.gain && this.ctx) {
            const t = this.ctx.currentTime;
            deck.gain.gain.cancelScheduledValues(t);
            deck.gain.gain.setValueAtTime(0.0001, t);
            deck.gain.gain.exponentialRampToValueAtTime(1, t + 0.18);
        }
        await deck.el.play();
    }

    pause() {
        const deck = this.decks[this.active];
        if (deck.gain && this.ctx && !deck.el.paused) {
            const t = this.ctx.currentTime;
            deck.gain.gain.cancelScheduledValues(t);
            deck.gain.gain.setValueAtTime(deck.gain.gain.value || 1, t);
            deck.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
            const el = deck.el;
            clearTimeout(this.pauseTimer);
            this.pauseTimer = setTimeout(() => { if (this.decks[this.active] === deck) el.pause(); }, 160);
            return;
        }
        deck.el.pause();
    }

    seek(time: number) {
        const el = this.el;
        if (!this.hasSource) return;
        try {
            el.currentTime = Math.max(0, Math.min(time, this.duration || time));
        } catch { /* ignore */ }
    }

    stop() {
        ++this.loadSeq;
        for (const deck of this.decks) {
            deck.el.pause();
            deck.el.removeAttribute('src');
            deck.el.load();
        }
    }
}

export const engine = new AudioEngine();
