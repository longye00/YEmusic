/** 试听片段：平台只给未开会员的账号 30 秒 / 1 分钟的片段，结尾常带一句开通会员的语音 */
export const TRIAL_ONLY = '只有试听片段：完整版需要平台会员，其他音源也没有找到';
/** 实际时长明显短于歌曲时长才算试听：不超过 95 秒、至少短 30 秒、且不到八成（时长未知一律不算） */
export function isTrialClip(actual: number, expected?: number): boolean {
    if (!expected || expected <= 0 || !Number.isFinite(actual) || actual <= 0) return false;
    return actual <= 95 && expected - actual >= 30 && actual < expected * 0.8;
}
