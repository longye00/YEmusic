import { useEffect } from 'react';
import { useSpring, useTransform, type MotionValue } from 'framer-motion';
import {
    PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
    resolvePlayerSubtitleBottomFromPresence,
} from '../utils/playerBottomBarLayout';

// YEmusic shim (replaces Folia's src/hooks/usePlayerBottomBarBottomPx.ts).
// Folia lets the user raise a global bottom baseline and shares it through a motion signal and
// several stores. YEmusic has a fixed control bar, so only the part the visualizers need survives:
// the subtitle layer's `bottom`, which eases between "control bar present" and "control bar hidden".
const SUBTITLE_PRESENCE_SPRING = { stiffness: 280, damping: 28 } as const;

export const usePlayerSubtitleBottomPx = (isPlayerChromeHidden: boolean): MotionValue<number> => {
    const controlBarPresence = useSpring(isPlayerChromeHidden ? 0 : 1, SUBTITLE_PRESENCE_SPRING);

    useEffect(() => {
        controlBarPresence.set(isPlayerChromeHidden ? 0 : 1);
    }, [controlBarPresence, isPlayerChromeHidden]);

    return useTransform(
        controlBarPresence,
        (presence: number) => resolvePlayerSubtitleBottomFromPresence(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX, presence),
    );
};
