// 手机端的渲染预算：精简模式（安卓默认）下把歌词动画的画布分辨率与帧率压下来。
//
// 桌面 GPU 跑满分辨率 60fps 没问题，手机 GPU 不行：商籁 / 凝彩 / 绘光每个全屏滤镜通道
// 都按「CSS 尺寸 × resolution」光栅化再进 Pixi 的 2 的幂纹理池，分辨率每高一点，
// 显存与填充率都是成倍涨；60fps 的 ticker 则让中端机的主线程一直排不上别的活。
// 这里给一个统一的系数：精简模式分辨率乘 0.75、ticker 限 30fps，画面只是略软、略顿，
// 换来整机的流畅。读取 <html> 上的 lite 类（src/lib/lite.ts 同步），不反向依赖应用层。

export function liteBudget(): { scale: number; maxFPS: number } {
    const lite = typeof document !== 'undefined' && document.documentElement.classList.contains('lite');
    return lite ? { scale: 0.75, maxFPS: 30 } : { scale: 1, maxFPS: 0 };
}

/** 套在既有分辨率解析外面：先按纹理池取整，再按手机端预算下调（不低于 0.5，避免糊成马赛克） */
export function budgetedResolution(resolution: number): number {
    const { scale } = liteBudget();
    return Math.max(0.5, resolution * scale);
}
