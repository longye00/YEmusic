/**
 * Folia（chthollyphile/folia-major，AGPL-3.0）v0.5.0 起新增的歌词动画。
 * 这里只放轻量元数据：设置面板列出它们时不需要加载任何动画代码（动画本体在 src/folia，按需分包加载）。
 */
export const FOLIA_MODES = [
    { id: 'monet', name: '莫奈', en: 'Monet', since: '0.5.0', desc: '海报式歌词轨道，右侧肖像与底部频谱' },
    { id: 'claddagh', name: '回环', en: 'Claddagh', since: '0.5.23', desc: '歌词沿环形轨道回旋，随节奏起伏' },
    { id: 'diorama', name: '镜台', en: 'Diorama', since: '0.5.27', desc: '程序化 3D 歌词穿梭，随歌词运镜' },
    { id: 'pendolo', name: '时计', en: 'Pendolo', since: '0.6.3', desc: '弧形歌词轮盘与钟表擒纵机芯' },
    { id: 'sonnet', name: '商籁', en: 'Sonnet', since: '0.6.9', desc: '日式动态图形（MG）歌词 PV' },
    { id: 'tempera', name: '凝彩', en: 'Tempera', since: '0.6.20', desc: '色块构图的歌词 PV' },
    { id: 'still', name: '静止', en: 'Still', since: '0.6.22', desc: '低资源占用的静态排版' },
    { id: 'lumiere', name: '绘光', en: 'Lumière', since: '0.7.10', desc: '舞台灯光：体积光、烟雾与光学线稿' },
] as const;

export type FoliaModeId = (typeof FOLIA_MODES)[number]['id'];

const IDS = new Set<string>(FOLIA_MODES.map(mode => mode.id));

export const isFoliaMode = (value: unknown): value is FoliaModeId => typeof value === 'string' && IDS.has(value);

export const FOLIA_MODE_NAMES = Object.fromEntries(FOLIA_MODES.map(mode => [mode.id, mode.name])) as Record<FoliaModeId, string>;
