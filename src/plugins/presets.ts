/** 内置音源（首次启动时自动导入，之后可在“设置 → 音源”中管理）。 */
import merged from './presets/yemusic-merged.js?raw';
import juhe from './presets/聚合音源特供版.js?raw';

export const PRESET_SCRIPTS: { key: string; script: string }[] = [
    { key: 'merged', script: merged },
    { key: 'juhe', script: juhe },
];

/** 0.1.x / 0.2.0 内置、经实测已失效的音源：升级时自动停用（不删除，可手动重新启用） */
export const RETIRED_PRESET_NAMES = ['微信公众号：洛雪音乐', 'Huibq_lxmusic源', '野花🌷', '野草🌾'];

/** 聚合音源（多个子源打包在一个脚本里）：单个子源失败不代表整个音源失效，换链时可以再次请求它 */
export const AGGREGATE_MARK = '@yemusic-aggregate';
