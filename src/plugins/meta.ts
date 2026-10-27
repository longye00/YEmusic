/** 洛雪自定义源脚本头部信息解析 */
export const INFO_LIMITS = { name: 24, description: 36, author: 56, homepage: 1024, version: 36 } as const;

/**
 * 解析脚本头部注释。必须与洛雪桌面版 parseScriptInfo 完全一致：
 * 部分音源会用 md5(name + description) 做防篡改校验，名称/描述哪怕多一个字符都会导致脚本拒绝工作。
 */
export function parseScriptMeta(script: string) {
    const head = /^\/\*[\S|\s]+?\*\//.exec(script)?.[0] ?? /^\/\*[\S|\s]+?\*\//.exec(script.replace(/^[\s\uFEFF]+/, ''))?.[0];
    if (!head) throw new Error('无效的自定义源文件：缺少头部注释');
    const infos: Record<string, string> = {};
    for (const line of head.split(/\r?\n/)) {
        const result = /^\s?\*\s?@(\w+)\s(.+)$/.exec(line);
        if (!result || !(result[1] in INFO_LIMITS)) continue;
        infos[result[1]] = result[2].trim();
    }
    for (const [key, len] of Object.entries(INFO_LIMITS)) {
        infos[key] ||= '';
        if (infos[key].length > len) infos[key] = infos[key].substring(0, len) + '...';
    }
    return {
        name: infos.name || `user_api_${new Date().toLocaleString()}`,
        description: infos.description,
        version: infos.version,
        author: infos.author,
        homepage: infos.homepage,
    };
}

