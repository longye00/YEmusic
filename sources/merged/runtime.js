/* @yemusic-aggregate */
(function () {
    'use strict';
    var G = globalThis;
    var realLx = G.lx;
    var EVENT_NAMES = realLx.EVENT_NAMES;
    var nativeConsole = G.console;
    var PLATFORMS = ['kw', 'kg', 'tx', 'wy', 'mg'];
    var NAMES = { kw: '酷我', kg: '酷狗', tx: 'QQ音乐', wy: '网易云', mg: '咪咕' };
    var QUALITYS = ['128k', '320k', 'flac', 'flac24bit'];
    /** 每个平台的子源顺序（按实测成功率与速度排列，运行中会按失败次数自动降权） */
    var ORDER = /*__ORDER__*/ {};
    /** 错峰并发间隔：前一个子源这么久还没结果，就同时启动下一个 */
    var STAGGER = { kw: 1200, kg: 1500, tx: 3000, wy: 1200, mg: 1500 };
    /** 总时长须小于播放器的单次调用超时（12 秒） */
    var TOTAL_MS = 11000;
    var SUB_TIMEOUT = 10000;
    var SUBS = /*__SUBS__*/ [];

    function log(level, text) {
        try { nativeConsole[level]('[聚合] ' + text); } catch (e) { /* ignore */ }
    }

    // ---------- 子源隔离环境 ----------
    function makeConsole(tag) {
        var noop = function () {};
        var pass = function (level) {
            return function () {
                try {
                    var args = Array.prototype.slice.call(arguments);
                    nativeConsole[level].apply(nativeConsole, ['[' + tag + ']'].concat(args));
                } catch (e) { /* ignore */ }
            };
        };
        // 子源的调试输出非常多，只保留警告和错误
        return { log: noop, info: noop, debug: noop, trace: noop, dir: noop, table: noop, time: noop, timeEnd: noop, timeLog: noop, group: noop, groupCollapsed: noop, groupEnd: noop, count: noop, assert: noop, warn: pass('warn'), error: pass('error') };
    }

    var boundCache = new Map();
    function makeGlobal(overrides) {
        var has = function (key) { return Object.prototype.hasOwnProperty.call(overrides, key); };
        var proxy = new Proxy(G, {
            get: function (target, key) {
                if (has(key)) return overrides[key];
                if (key === 'globalThis' || key === 'self' || key === 'window') return proxy;
                var value = Reflect.get(target, key);
                // setTimeout / fetch 等宿主函数必须以真实全局对象为 this 调用
                if (typeof value === 'function' && typeof key === 'string' && /^[a-z]/.test(key)) {
                    var bound = boundCache.get(value);
                    if (!bound) { bound = value.bind(target); boundCache.set(value, bound); }
                    return bound;
                }
                return value;
            },
            set: function (target, key, value) { overrides[key] = value; return true; },
            has: function (target, key) { return has(key) || key in target; },
            deleteProperty: function (target, key) { delete overrides[key]; return true; },
        });
        return proxy;
    }

    function normalizeCaps(sources) {
        if (!sources || typeof sources !== 'object') return null;
        var caps = {};
        PLATFORMS.forEach(function (p) {
            var s = sources[p];
            if (!s || (s.type && s.type !== 'music')) return;
            if (Array.isArray(s.actions) && s.actions.indexOf('musicUrl') < 0) return;
            caps[p] = (Array.isArray(s.qualitys) ? s.qualitys : []).filter(function (q) { return QUALITYS.indexOf(q) >= 0; });
        });
        return caps;
    }

    function loadSub(def) {
        var st = { def: def, handler: null, caps: null, ready: false, failed: '', health: {} };
        var subLx = {
            EVENT_NAMES: EVENT_NAMES,
            request: realLx.request,
            utils: realLx.utils,
            env: realLx.env,
            version: realLx.version,
            currentScriptInfo: Object.assign({}, def.info, { rawScript: def.code }),
            on: function (name, handler) {
                if (name !== EVENT_NAMES.request) return Promise.reject(new Error('The event is not supported: ' + name));
                st.handler = handler;
                return Promise.resolve();
            },
            send: function (name, data) {
                if (name === EVENT_NAMES.inited) {
                    if (st.ready) return Promise.reject(new Error('Script is inited'));
                    st.ready = true;
                    if (data && data.status === false) st.failed = '初始化失败';
                    st.caps = normalizeCaps(data && data.sources);
                    return Promise.resolve();
                }
                if (name === EVENT_NAMES.updateAlert) {
                    // 子源已打包固定版本，不弹更新窗口，只记录
                    log('info', def.tag + ' 提示有新版本：' + String((data && data.log) || '').slice(0, 80));
                    return Promise.resolve();
                }
                return Promise.reject(new Error('The event is not supported: ' + name));
            },
        };
        st.lx = subLx;
        var subConsole = makeConsole(def.tag);
        var scope = makeGlobal({ lx: subLx, console: subConsole });
        try {
            var run = new Function('globalThis', 'self', 'window', 'lx', 'console',
                'return (function () {\n' + def.code + '\n}).call(globalThis);\n//# sourceURL=yemusic-merged/' + def.id + '.js');
            run(scope, scope, scope, subLx, subConsole);
        } catch (error) {
            st.failed = String((error && error.message) || error).slice(0, 80);
            log('warn', def.tag + ' 加载失败：' + st.failed);
        }
        if (!st.handler && !st.failed) st.failed = '未注册取链接口';
        return st;
    }

    // ---------- 加载子源 ----------
    var states = SUBS.map(loadSub);
    var byId = {};
    states.forEach(function (st) { byId[st.def.id] = st; });

    // 防止子源绕过隔离改写真实的 lx 事件（只拦 on / send，其余照常）
    try {
        var guard = Object.assign({}, realLx, {
            on: function () { log('warn', '已拦截子源对全局 lx.on 的调用'); return Promise.resolve(); },
            send: function () { return Promise.resolve(); },
        });
        G.lx = guard;
    } catch (e) { /* 只读时忽略 */ }

    // ---------- 取链 ----------
    var urlOwner = new Map();
    function rememberUrl(url, id) {
        urlOwner.set(url, id);
        if (urlOwner.size > 300) urlOwner.delete(urlOwner.keys().next().value);
    }

    function supports(st, source, quality) {
        var caps = st.caps || st.def.caps;
        if (!caps) return true;
        var list = caps[source];
        if (!list) return false;
        return !list.length || list.indexOf(quality) >= 0;
    }

    function penalty(st, source) {
        var h = st.health[source];
        if (!h) return 0;
        if (h.fails >= 3) return 6 + h.fails;
        return h.fails * 0.6;
    }

    function markOk(st, source, ms) {
        var h = st.health[source] || (st.health[source] = { fails: 0, ok: 0, ms: 0 });
        h.fails = 0;
        h.ok += 1;
        h.ms = h.ms ? Math.round(h.ms * 0.7 + ms * 0.3) : ms;
    }
    function markFail(st, source) {
        var h = st.health[source] || (st.health[source] = { fails: 0, ok: 0, ms: 0 });
        h.fails += 1;
    }

    /** 错误描述只用中性词，避免宿主把“某个子源超时 / 连不上”当成整个聚合源失效 */
    function cleanError(error) {
        var m = String((error && error.message) || error || '');
        if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(m)) return '域名失效';
        if (/ECONNREFUSED|ECONNRESET|socket hang up|EHOSTUNREACH|ENETUNREACH|network/i.test(m)) return '连接中断';
        if (/time ?out|timed out|超时|无响应/i.test(m)) return '无响应';
        if (/卡密|过期|expired/i.test(m)) return '授权过期';
        if (/不支持|not support/i.test(m)) return '不支持';
        return '未取到';
    }

    function judge(url, exclude) {
        if (typeof url !== 'string') return '无效链接';
        url = url.trim();
        if (!/^https?:\/\//i.test(url) || url.length > 2048) return '无效链接';
        if (exclude.indexOf(url) >= 0) return '刚才播放失败';
        // 网易云外链跳转对 VIP / 下架歌曲会返回网页，只作为最后的备选
        if (/music\.163\.com\/song\/media\/outer\/url/i.test(url)) return 'weak';
        return 'ok';
    }

    function callSub(st, source, info) {
        return new Promise(function (resolve, reject) {
            var timer = setTimeout(function () { reject(new Error('无响应')); }, SUB_TIMEOUT);
            var musicInfo;
            try { musicInfo = JSON.parse(JSON.stringify(info.musicInfo || {})); } catch (e) { musicInfo = info.musicInfo; }
            var payload = { source: source, action: 'musicUrl', info: { type: info.type, musicInfo: musicInfo } };
            Promise.resolve()
                .then(function () { return st.handler.call(st.lx, payload); })
                .then(function (result) {
                    clearTimeout(timer);
                    resolve(typeof result === 'string' ? result : result && typeof result.url === 'string' ? result.url : result);
                }, function (error) {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    function candidates(source, quality, exclude) {
        var demoted = {};
        exclude.forEach(function (url) { var owner = urlOwner.get(url); if (owner) demoted[owner] = true; });
        return (ORDER[source] || [])
            .map(function (id, index) { return { st: byId[id], index: index }; })
            .filter(function (x) { return x.st && x.st.handler && !x.st.failed && supports(x.st, source, quality); })
            .map(function (x) { return { st: x.st, score: x.index + penalty(x.st, source) + (demoted[x.st.def.id] ? 20 : 0) }; })
            .sort(function (a, b) { return a.score - b.score; })
            .map(function (x) { return x.st; });
    }

    function race(list, source, info, exclude) {
        return new Promise(function (resolve, reject) {
            var index = 0;
            var running = 0;
            var finished = false;
            var weak = null;
            var errors = [];
            var timer = null;
            var deadline = setTimeout(function () { finish(weak); }, TOTAL_MS);
            function finish(hit) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                clearTimeout(deadline);
                if (hit) resolve(hit);
                else reject(new Error(errors.length ? errors.join('；') : '没有可用的子源'));
            }
            function settleOne() {
                running -= 1;
                if (finished) return;
                if (index < list.length) launch();
                else if (running === 0) finish(weak);
            }
            function launch() {
                clearTimeout(timer);
                if (finished || index >= list.length) return;
                var st = list[index++];
                var started = Date.now();
                running += 1;
                if (index < list.length) timer = setTimeout(launch, STAGGER[source] || 1500);
                callSub(st, source, info).then(function (url) {
                    var ms = Date.now() - started;
                    var verdict = judge(url, exclude);
                    if (verdict === 'ok') {
                        markOk(st, source, ms);
                        if (!finished) finish({ url: url.trim(), st: st, ms: ms });
                        running -= 1;
                        return;
                    }
                    if (verdict === 'weak') {
                        if (!weak) weak = { url: url.trim(), st: st, ms: ms, weak: true };
                        errors.push(st.def.tag + ' 备选');
                    } else {
                        markFail(st, source);
                        errors.push(st.def.tag + ' ' + verdict);
                    }
                    settleOne();
                }, function (error) {
                    markFail(st, source);
                    errors.push(st.def.tag + ' ' + cleanError(error));
                    settleOne();
                });
            }
            launch();
        });
    }

    function getMusicUrl(source, info) {
        var quality = info.type;
        var hint = (info && info.ye) || {};
        var exclude = Array.isArray(hint.exclude) ? hint.exclude.filter(function (u) { return typeof u === 'string'; }) : [];
        var list = candidates(source, quality, exclude);
        if (!list.length) return Promise.reject(new Error('聚合：没有支持' + (NAMES[source] || source) + ' ' + quality + '的子源'));
        return race(list, source, info, exclude).then(function (hit) {
            rememberUrl(hit.url, hit.st.def.id);
            log('info', (NAMES[source] || source) + ' ' + quality + ' ← ' + hit.st.def.tag + '（' + hit.ms + 'ms' + (hit.weak ? '，备选链接' : '') + '）');
            return hit.url;
        }, function (error) {
            var text = '聚合：' + String(error.message || '').slice(0, 120);
            log('warn', (NAMES[source] || source) + ' ' + quality + ' 未取到：' + text);
            throw new Error(text);
        });
    }

    realLx.on(EVENT_NAMES.request, function (payload) {
        var source = payload && payload.source;
        var action = payload && payload.action;
        var info = (payload && payload.info) || {};
        if (action !== 'musicUrl') return Promise.reject(new Error('action not support'));
        if (PLATFORMS.indexOf(source) < 0) return Promise.reject(new Error('source not support'));
        return getMusicUrl(source, info);
    });

    var declared = {};
    PLATFORMS.forEach(function (p) {
        var qs = {};
        SUBS.forEach(function (def) { ((def.caps && def.caps[p]) || []).forEach(function (q) { qs[q] = true; }); });
        var list = QUALITYS.filter(function (q) { return qs[q]; });
        if (list.length) declared[p] = { name: NAMES[p], type: 'music', actions: ['musicUrl'], qualitys: list };
    });
    var loaded = states.filter(function (st) { return !st.failed; }).map(function (st) { return st.def.tag; });
    log('info', '已载入子源：' + (loaded.join('、') || '无'));
    realLx.send(EVENT_NAMES.inited, { status: true, openDevTools: false, sources: declared });
})();
