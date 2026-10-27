/**
 * 封面预加载队列：限制同时进行的图片请求数，失败后退避重试。
 * 乐库墙一次会挂载上百张封面，直接全部交给 <img> 容易触发 Chromium 的
 * net::ERR_INSUFFICIENT_RESOURCES。这里统一排队加载，完成后再渲染 <img>（命中缓存）。
 */
export type ImageStatus = 'ok' | 'error';

interface Job {
    url: string;
    waiters: Set<(status: ImageStatus) => void>;
    attempts: number;
    queued: boolean;
    /** 越大越先加载 */
    priority: number;
    /** 入队序号：同优先级时后来者优先 */
    seq: number;
}

const MAX_ACTIVE = 10;
const MAX_ATTEMPTS = 5;
const TIMEOUT = 20000;
/** 失败结果只记一会儿，之后允许重新尝试 */
const ERROR_TTL = 60000;
const MAX_REMEMBERED = 3000;

const settled = new Map<string, { status: ImageStatus; at: number }>();
const jobs = new Map<string, Job>();
/** 待加载：优先级高的先加载；同优先级后进先出（最近挂载的往往就是当前可见的） */
const pending: Job[] = [];
let active = 0;
let seq = 0;

function takeNext(): Job | undefined {
    let best = -1;
    for (let i = 0; i < pending.length; i++) {
        const job = pending[i];
        if (best < 0 || job.priority > pending[best].priority || (job.priority === pending[best].priority && job.seq > pending[best].seq)) best = i;
    }
    return best < 0 ? undefined : pending.splice(best, 1)[0];
}

function remember(url: string, status: ImageStatus) {
    settled.delete(url);
    settled.set(url, { status, at: Date.now() });
    if (settled.size > MAX_REMEMBERED) {
        const oldest = settled.keys().next().value;
        if (oldest !== undefined) settled.delete(oldest);
    }
}

/** 已知结果（同步）：用于避免已加载过的封面闪一下占位图 */
export function imageStatus(url: string): ImageStatus | undefined {
    const hit = settled.get(url);
    if (!hit) return undefined;
    if (hit.status === 'error' && Date.now() - hit.at > ERROR_TTL) {
        settled.delete(url);
        return undefined;
    }
    return hit.status;
}

function pump() {
    while (active < MAX_ACTIVE && pending.length) {
        const job = takeNext()!;
        job.queued = false;
        if (!job.waiters.size) {
            jobs.delete(job.url);
            continue;
        }
        start(job);
    }
}

function start(job: Job) {
    active++;
    job.attempts++;
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    let done = false;
    const finish = (status: ImageStatus) => {
        if (done) return;
        done = true;
        active--;
        clearTimeout(timer);
        img.onload = img.onerror = null;
        if (status === 'error' && job.attempts < MAX_ATTEMPTS && job.waiters.size) {
            // 退避后放到队尾（优先级最低），给其它封面让路
            setTimeout(() => {
                if (!job.waiters.size) {
                    jobs.delete(job.url);
                    return;
                }
                job.queued = true;
                job.priority -= 1000;
                pending.push(job);
                pump();
            }, 700 * job.attempts * job.attempts);
        } else {
            jobs.delete(job.url);
            remember(job.url, status);
            for (const fn of [...job.waiters]) fn(status);
            job.waiters.clear();
        }
        pump();
    };
    const timer = setTimeout(() => {
        img.src = '';
        finish('error');
    }, TIMEOUT);
    img.onload = () => {
        // 尽量先解码，避免 <img> 出现时再卡一帧
        const ready = typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve();
        void ready.then(() => finish('ok'));
    };
    img.onerror = () => finish('error');
    img.src = job.url;
}

/**
 * 排队加载图片；返回取消函数（组件卸载时调用，未开始的请求会被丢弃）。
 * 已知结果时会同步回调。priority 越大越先加载。
 */
export function queueImage(url: string, callback: (status: ImageStatus) => void, priority = 0): () => void {
    const known = imageStatus(url);
    if (known) {
        callback(known);
        return () => undefined;
    }
    let job = jobs.get(url);
    if (!job) {
        job = { url, waiters: new Set(), attempts: 0, queued: true, priority, seq: ++seq };
        jobs.set(url, job);
        pending.push(job);
    } else if (job.queued) {
        // 再次被请求：按更高的优先级、更新的顺序排
        job.priority = Math.max(job.priority, priority);
        job.seq = ++seq;
    }
    const current = job;
    current.waiters.add(callback);
    queueMicrotask(pump);
    return () => {
        current.waiters.delete(callback);
        if (!current.waiters.size && current.queued) {
            const index = pending.indexOf(current);
            if (index >= 0) pending.splice(index, 1);
            jobs.delete(current.url);
        }
    };
}
