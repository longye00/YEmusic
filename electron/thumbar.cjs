/**
 * Windows 任务栏缩略图工具栏（上一首 / 播放暂停 / 下一首）。
 * 图标在运行时用简单几何图形光栅化生成，免去额外的图片资源。
 */
const { nativeImage } = require('electron');

const inTriangle = (px, py, [a, b, c]) => {
    const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
    const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
    const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
};
const inRect = (px, py, [x0, y0, x1, y1]) => px >= x0 && px <= x1 && py >= y0 && py <= y1;

const SHAPES = {
    play: [{ tri: [[0.3, 0.18], [0.3, 0.82], [0.82, 0.5]] }],
    pause: [{ rect: [0.26, 0.2, 0.42, 0.8] }, { rect: [0.58, 0.2, 0.74, 0.8] }],
    previous: [{ rect: [0.2, 0.22, 0.31, 0.78] }, { tri: [[0.8, 0.2], [0.8, 0.8], [0.33, 0.5]] }],
    next: [{ rect: [0.69, 0.22, 0.8, 0.78] }, { tri: [[0.2, 0.2], [0.2, 0.8], [0.67, 0.5]] }],
};

function rasterize(name, scale) {
    const size = Math.max(16, Math.round(16 * scale));
    const shapes = SHAPES[name];
    const buffer = Buffer.alloc(size * size * 4);
    const samples = 4;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let hit = 0;
            for (let sy = 0; sy < samples; sy++) {
                for (let sx = 0; sx < samples; sx++) {
                    const px = (x + (sx + 0.5) / samples) / size;
                    const py = (y + (sy + 0.5) / samples) / size;
                    if (shapes.some(s => (s.tri ? inTriangle(px, py, s.tri) : inRect(px, py, s.rect)))) hit++;
                }
            }
            const alpha = Math.round((255 * hit) / (samples * samples));
            const i = (y * size + x) * 4;
            // BGRA、预乘 alpha 的白色
            buffer[i] = alpha;
            buffer[i + 1] = alpha;
            buffer[i + 2] = alpha;
            buffer[i + 3] = alpha;
        }
    }
    return nativeImage.createFromBitmap(buffer, { width: size, height: size, scaleFactor: size / 16 });
}

let cache = null;
function icons(scale) {
    if (!cache || cache.scale !== scale) {
        cache = { scale, play: rasterize('play', scale), pause: rasterize('pause', scale), previous: rasterize('previous', scale), next: rasterize('next', scale) };
    }
    return cache;
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {{ playing: boolean }} state
 * @param {(command: string) => void} onCommand
 * @param {number} scale 显示器缩放比例
 */
function updateThumbar(win, state, onCommand, scale = 1) {
    if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
    try {
        const set = icons(scale);
        win.setThumbarButtons([
            { tooltip: '上一首', icon: set.previous, click: () => onCommand('previous') },
            { tooltip: state.playing ? '暂停' : '播放', icon: state.playing ? set.pause : set.play, click: () => onCommand('playpause') },
            { tooltip: '下一首', icon: set.next, click: () => onCommand('next') },
        ]);
    } catch (error) {
        console.warn('[main] thumbar unavailable', error?.message || error);
    }
}

module.exports = { updateThumbar };
