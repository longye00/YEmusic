/* 启动遮罩脚本：首帧前同步执行。移植自 Folia index.html 的内联脚本（AGPL-3.0）：
   波形逐条随机化 + 「YEmusic」字体轮盘；新增设置开关、点击 / 按键跳过、__yeHideSplash。
   CSP 只允许 'self'，所以放在 public 里用经典 <script> 加载。 */
(function () {
    var splash = document.getElementById('app-splash');
    if (!splash) return;

    window.__yeSplashStart = performance.now();

    // 设置关掉启动动画：localStorage 里 splash === false 时首帧前直接摘掉，不闪。
    var reduced = false;
    try {
        var settings = JSON.parse(localStorage.getItem('ye.settings.v2') || '{}');
        if (settings.splash === false) {
            splash.remove();
            return;
        }
        reduced = settings.reduceMotion === true;
    } catch (error) {
        // 解析失败照常用遮罩
    }
    if (!reduced && window.matchMedia) {
        reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    if (reduced) splash.classList.add('is-reduced');

    window.__yeHideSplash = function (immediate) {
        var el = document.getElementById('app-splash');
        if (!el) return;
        el.classList.add('is-hiding');
        window.setTimeout(function () { el.remove(); }, immediate ? 80 : (reduced ? 200 : 420));
    };

    // 点击或按任意键立刻跳过
    var skip = function () { window.__yeHideSplash(true); };
    window.addEventListener('pointerdown', skip, { capture: true, once: true });
    window.addEventListener('keydown', skip, { capture: true, once: true });

    // 波形逐条随机化：高度、宽度、节奏、相位都带抖动，每次加载的形状都不一样。
    try {
        var rand = function (min, max) { return min + Math.random() * (max - min); };
        var bars = splash.querySelectorAll('.app-splash-wave span');
        for (var i = 0; i < bars.length; i += 1) {
            var bar = bars[i];
            // 中间高、两端低的整体包络，再叠加随机量，形状既像波形又不规整。
            var envelope = Math.sin(((i + 0.5) / bars.length) * Math.PI);
            var peak = Math.min(1, 0.32 + envelope * rand(0.38, 0.72));
            bar.style.setProperty('--peak', peak.toFixed(3));
            bar.style.setProperty('--floor', rand(0.08, 0.24).toFixed(3));
            bar.style.setProperty('--w', rand(3.5, 6.5).toFixed(2) + 'px');
            bar.style.setProperty('--alpha', rand(0.55, 1).toFixed(2));
            bar.style.setProperty('--glow', Math.round(rand(6, 26)) + 'px');
            bar.style.animationDuration = Math.round(rand(820, 1500)) + 'ms';
            bar.style.animationDelay = '-' + Math.round(rand(0, 1500)) + 'ms';
        }
    } catch (error) {
        // 随机化失败无所谓，CSS 默认值已经能跑一条波形。
    }

    if (reduced) return;

    // 七个字母不断跳到不同字形（Loki 片头那种字体轮盘），
    // 字重 / 斜体 / 横向拉伸叠加，不同机器装不同字体也能看出来跳变。
    try {
        var BASE_FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
        var FAMILIES = [BASE_FONT, 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];
        var WEIGHTS = ['400', '600', '800'];
        var SCALES = [0.86, 0.94, 1, 1.06, 1.12];
        var letters = splash.querySelectorAll('.app-splash-title span');
        if (!letters.length) return;

        // 用 canvas 在 100px 基准下量出每个字母在所有候选字形里的最大宽度，换算成 em 写死盒子宽度，
        // 这样字形来回换、词标整体不会左右乱跳。
        var measure = document.createElement('canvas').getContext('2d');
        for (var m = 0; m < letters.length; m += 1) {
            var glyph = letters[m].textContent;
            var widest = 0;
            for (var f = 0; f < FAMILIES.length; f += 1) {
                measure.font = 'italic 800 100px ' + FAMILIES[f];
                widest = Math.max(widest, measure.measureText(glyph).width);
                measure.font = '800 100px ' + FAMILIES[f];
                widest = Math.max(widest, measure.measureText(glyph).width);
            }
            if (widest > 0) {
                // 余量留给最大的缩放组合（1.12 × 1.12），字形放大时不会压到相邻字母。
                letters[m].style.width = ((widest / 100) * 1.26 + 0.04).toFixed(3) + 'em';
            }
        }

        var pick = function (list) { return list[Math.floor(Math.random() * list.length)]; };
        var jitter = function (min, max) { return min + Math.random() * (max - min); };
        var randomGlow = function () {
            var roll = Math.random();
            if (roll < 0.3) return '0 0 ' + (2 + Math.random() * 4).toFixed(1) + 'px rgba(255,255,255,0.35)';
            if (roll < 0.75) {
                return '0 0 ' + (6 + Math.random() * 8).toFixed(1) + 'px rgba(255,255,255,0.7), 0 0 ' +
                    (20 + Math.random() * 16).toFixed(1) + 'px rgba(255,255,255,0.35)';
            }
            return '0 0 ' + (10 + Math.random() * 8).toFixed(1) + 'px rgba(255,255,255,0.95), 0 0 ' +
                (34 + Math.random() * 20).toFixed(1) + 'px rgba(255,255,255,0.7), 0 0 ' +
                (70 + Math.random() * 40).toFixed(1) + 'px rgba(255,255,255,0.45)';
        };
        var timer = window.setInterval(function () {
            // 遮罩被移除后自己停掉，不留空转的定时器。
            if (!document.getElementById('app-splash')) {
                window.clearInterval(timer);
                return;
            }
            // 一拍只换一个字母，偶尔两个，节奏克制。
            var swaps = Math.random() < 0.25 ? 2 : 1;
            for (var i = 0; i < swaps; i += 1) {
                var letter = pick(letters);
                letter.style.fontFamily = pick(FAMILIES);
                letter.style.fontWeight = pick(WEIGHTS);
                letter.style.fontStyle = Math.random() < 0.25 ? 'italic' : 'normal';
                // 大小和宽窄都用 transform 做：不进入布局，盒子宽度不受影响，排版才不会抖。
                var sizeScale = jitter(0.86, 1.12);
                letter.style.transform = 'scale(' + (sizeScale * pick(SCALES)).toFixed(3) + ',' + sizeScale.toFixed(3) + ')';
                letter.style.textShadow = randomGlow();
            }
        }, 380);
    } catch (error) {
        // 字体轮盘失败就保持静态词标。
    }
})();
