#!/usr/bin/env python3
"""由 build/icon-source.png（1024×1024，透明底的圆角方形图标）生成各平台用到的图标。

    pip install pillow numpy
    python scripts/make-icons.py            # 只生成 PNG / Android 启动图标 / 安装向导图
    python scripts/make-icons.py --ico      # 同时按源图重新生成 build/icon.ico

输出：
  build/icon.png                         512×512，裁掉透明边距（Electron 托盘 / Linux 窗口图标）
  src/assets/icon.png                    256×256，应用内“关于”页使用
  build/icon.ico                         （仅 --ico）16–256 多尺寸 Windows 图标
  packaging/wizard.bmp                   NSIS 安装向导侧边图（164×314）
  android/app/src/main/res/mipmap-*/     ic_launcher / ic_launcher_round / ic_launcher_foreground / ic_launcher_monochrome
  android/app/src/main/res/values/ic_launcher_background.xml
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
DENSITIES = {'mdpi': 1.0, 'hdpi': 1.5, 'xhdpi': 2.0, 'xxhdpi': 3.0, 'xxxhdpi': 4.0}
FOREGROUND_ICON_DP = 76   # 自适应图标 108dp 画布内，图标本体占 76dp（可见区 72dp，字形完整落在安全区内）


def load_icon(path: Path) -> Image.Image:
    """读取源图并裁到图标本体（去掉四周透明边距），返回方形 RGBA。"""
    src = Image.open(path).convert('RGBA')
    box = src.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if not box:
        raise SystemExit('源图没有不透明像素')
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    side = max(box[2] - box[0], box[3] - box[1])
    half = side / 2
    return src.crop((round(cx - half), round(cy - half), round(cx + half), round(cy + half)))


def scaled(icon: Image.Image, px: int) -> Image.Image:
    return icon.resize((px, px), Image.LANCZOS)


def on_canvas(img: Image.Image, canvas: int) -> Image.Image:
    out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(img, ((canvas - img.width) // 2, (canvas - img.height) // 2))
    return out


def circle_mask(px: int) -> Image.Image:
    k = 4
    m = Image.new('L', (px * k, px * k), 0)
    ImageDraw.Draw(m).ellipse((0, 0, px * k - 1, px * k - 1), fill=255)
    return m.resize((px, px), Image.LANCZOS)


def glyph_mask(icon: Image.Image) -> np.ndarray:
    """提取音符叶片字形 → 0..1 透明度，用于 Android 13 主题图标。
    深绿底和光晕的红色分量几乎为 0，而字形的红色分量 ≥ 150，用红通道做阈值边缘最干净。"""
    red = np.asarray(icon.getchannel('R'), dtype=np.float32)
    t = np.clip((red - 80.0) / (150.0 - 80.0), 0.0, 1.0)
    return t * t * (3 - 2 * t) * (np.asarray(icon.getchannel('A'), dtype=np.float32) / 255.0)


def make_wizard(icon: Image.Image, out: Path) -> None:
    w, h = 164, 314
    top, bottom = np.array([10, 66, 42], np.float32), np.array([2, 10, 6], np.float32)
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None] ** 0.8
    grad = (top * (1 - t) + bottom * t) * np.ones((1, w, 1), np.float32)
    bg = Image.fromarray(grad.clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    size = 84
    bg.alpha_composite(scaled(icon, size * 4).resize((size, size), Image.LANCZOS), ((w - size) // 2, 72))
    draw = ImageDraw.Draw(bg)
    font = None
    for cand in ('/usr/share/fonts/msttcore/arial.ttf', '/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf',
                 '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', 'arial.ttf', 'DejaVuSans.ttf'):
        try:
            font = ImageFont.truetype(cand, 21)
            break
        except OSError:
            continue
    if font is None:
        font = ImageFont.load_default()
    text = 'YEmusic'
    tw = draw.textlength(text, font=font)
    draw.text(((w - tw) / 2, 176), text, font=font, fill=(255, 255, 255, 255))
    bg.convert('RGB').save(out, format='BMP')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=str(ROOT / 'build' / 'icon-source.png'))
    ap.add_argument('--ico', action='store_true', help='同时重新生成 build/icon.ico')
    args = ap.parse_args()
    icon = load_icon(Path(args.source))
    print(f'图标本体 {icon.width}×{icon.height}')

    # 桌面
    scaled(icon, 512).save(ROOT / 'build' / 'icon.png', optimize=True)
    (ROOT / 'src' / 'assets').mkdir(parents=True, exist_ok=True)
    scaled(icon, 256).save(ROOT / 'src' / 'assets' / 'icon.png', optimize=True)
    if args.ico:
        big = scaled(icon, 256)
        big.save(ROOT / 'build' / 'icon.ico', format='ICO', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    make_wizard(icon, ROOT / 'packaging' / 'wizard.bmp')

    # Android：自适应图标背景色取图标边缘平均色
    arr = np.asarray(icon, dtype=np.float32)
    n = arr.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    d = np.minimum(np.minimum(xx, n - 1 - xx), np.minimum(yy, n - 1 - yy))
    ring = arr[(d >= 8) & (d < 18) & (arr[:, :, 3] > 250)][:, :3].mean(axis=0)
    bg_hex = '#%02X%02X%02X' % tuple(int(round(v)) for v in ring)
    (RES / 'values').mkdir(parents=True, exist_ok=True)
    (RES / 'values' / 'ic_launcher_background.xml').write_text(
        f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{bg_hex}</color>\n</resources>\n',
        encoding='utf-8')
    print('adaptive background', bg_hex)

    mask = glyph_mask(icon)
    mono = Image.fromarray((mask * 255).astype(np.uint8), 'L')
    mono_icon = Image.merge('RGBA', (Image.new('L', mono.size, 255),) * 3 + (mono,))

    for name, scale in DENSITIES.items():
        folder = RES / f'mipmap-{name}'
        folder.mkdir(parents=True, exist_ok=True)
        legacy = round(48 * scale)
        scaled(icon, legacy).save(folder / 'ic_launcher.png', optimize=True)
        # 圆形图标：把方形图标略放大再裁圆，避免边缘露出圆角方形的暗边
        big = scaled(icon, round(legacy * 1.06))
        crop = big.crop(((big.width - legacy) // 2, (big.height - legacy) // 2, (big.width - legacy) // 2 + legacy, (big.height - legacy) // 2 + legacy))
        crop.putalpha(circle_mask(legacy))
        crop.save(folder / 'ic_launcher_round.png', optimize=True)
        canvas = round(108 * scale)
        inner = round(FOREGROUND_ICON_DP * scale)
        on_canvas(scaled(icon, inner), canvas).save(folder / 'ic_launcher_foreground.png', optimize=True)
        on_canvas(scaled(mono_icon, inner), canvas).save(folder / 'ic_launcher_monochrome.png', optimize=True)
    print('Android 图标已写入', RES)


if __name__ == '__main__':
    main()
