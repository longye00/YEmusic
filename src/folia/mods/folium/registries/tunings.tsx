// YEmusic shim (replaces Folia's src/mods/folium/registries/tunings.tsx).
// Folium - Folia's third-party mod system - is not part of YEmusic, so no mod can modulate a
// visualizer. Every tunable therefore resolves to its identity value (an empty map), which is the
// unmodified look the visualizers fall back to.

const NO_TUNINGS: Readonly<Record<string, number>> = Object.freeze({});

export const readFoliumTunings = (_target: string): Readonly<Record<string, number>> => NO_TUNINGS;

export const useFoliumTunings = (_target: string): Readonly<Record<string, number>> => NO_TUNINGS;
