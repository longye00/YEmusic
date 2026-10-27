/** Folia 歌词动画的细调参数（每种动画一份），localStorage 持久化。 */
import { create } from 'zustand';
import {
    DEFAULT_CLADDAGH_TUNING,
    DEFAULT_DIORAMA_TUNING,
    DEFAULT_LUMIERE_TUNING,
    DEFAULT_MONET_TUNING,
    DEFAULT_PENDOLO_TUNING,
    DEFAULT_SONNET_TUNING,
    DEFAULT_TEMPERA_TUNING,
    type CladdaghTuning,
    type DioramaTuning,
    type LumiereTuning,
    type MonetTuning,
    type PendoloTuning,
    type SonnetTuning,
    type TemperaTuning,
} from '@/folia/types';

export interface FoliaTunings {
    monet: MonetTuning;
    claddagh: CladdaghTuning;
    diorama: DioramaTuning;
    pendolo: PendoloTuning;
    sonnet: SonnetTuning;
    tempera: TemperaTuning;
    lumiere: LumiereTuning;
}
export type FoliaTuningMode = keyof FoliaTunings;

export const DEFAULT_FOLIA_TUNINGS: FoliaTunings = {
    monet: DEFAULT_MONET_TUNING,
    claddagh: DEFAULT_CLADDAGH_TUNING,
    diorama: DEFAULT_DIORAMA_TUNING,
    pendolo: DEFAULT_PENDOLO_TUNING,
    sonnet: DEFAULT_SONNET_TUNING,
    tempera: DEFAULT_TEMPERA_TUNING,
    lumiere: DEFAULT_LUMIERE_TUNING,
};

const KEY = 'ye.folia.tunings.v1';

const isPlain = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 以默认值为模板合并存档：只接受同类型的字段，嵌套对象逐层合并（应对新版本新增字段）。 */
function mergeInto<T>(defaults: T, saved: unknown): T {
    if (!isPlain(defaults) || !isPlain(saved)) return defaults;
    const out: Record<string, unknown> = { ...defaults };
    for (const [key, fallback] of Object.entries(defaults)) {
        const value = saved[key];
        if (value === undefined) continue;
        if (isPlain(fallback)) out[key] = mergeInto(fallback, value);
        else if (typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value))) out[key] = value;
    }
    return out as T;
}

function load(): FoliaTunings {
    let saved: Record<string, unknown> = {};
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
        if (isPlain(raw)) saved = raw;
    } catch { /* 存档损坏时用默认值 */ }
    const out = { ...DEFAULT_FOLIA_TUNINGS };
    for (const mode of Object.keys(out) as FoliaTuningMode[]) {
        (out as Record<string, unknown>)[mode] = mergeInto(DEFAULT_FOLIA_TUNINGS[mode], saved[mode]);
    }
    return out;
}

interface FoliaTuningState {
    tunings: FoliaTunings;
    patch<M extends FoliaTuningMode>(mode: M, patch: Partial<FoliaTunings[M]>): void;
    reset(mode: FoliaTuningMode): void;
}

export const useFoliaTunings = create<FoliaTuningState>((set, get) => ({
    tunings: load(),
    patch(mode, patch) {
        const current = get().tunings;
        set({ tunings: { ...current, [mode]: { ...current[mode], ...patch } } });
    },
    reset(mode) {
        set({ tunings: { ...get().tunings, [mode]: DEFAULT_FOLIA_TUNINGS[mode] } });
    },
}));

let timer: ReturnType<typeof setTimeout> | undefined;
useFoliaTunings.subscribe(state => {
    clearTimeout(timer);
    timer = setTimeout(() => {
        try { localStorage.setItem(KEY, JSON.stringify(state.tunings)); } catch { /* 存储已满等 */ }
    }, 250);
});
