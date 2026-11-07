import type { Transition } from 'framer-motion';

/**
 * 动效词汇表：与 index.css 里的 --ye-dur-* / --ye-ease-* 一一对应。
 * fast：按下、颜色反馈；move：位移、开合；unfold：展开、换页；show：大面积入场。
 * “减少动效”由 App 里的 MotionConfig 统一处理（framer）和 .reduce-motion（CSS）。
 */
export const MOTION = {
    dur: { fast: 0.12, move: 0.22, unfold: 0.3, show: 0.48 },
    ease: {
        out: [0.22, 1, 0.36, 1],
        standard: [0.4, 0, 0.2, 1],
        inOut: [0.65, 0, 0.35, 1],
    },
} as const satisfies { dur: Record<string, number>; ease: Record<string, readonly [number, number, number, number]> };

export const tween = (dur: keyof typeof MOTION.dur = 'move', ease: keyof typeof MOTION.ease = 'out'): Transition => ({
    duration: MOTION.dur[dur],
    ease: MOTION.ease[ease] as unknown as Transition['ease'],
});
