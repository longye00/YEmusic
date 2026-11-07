/**
 * 快捷键键帽：把 [['Ctrl', 'K'], ['Ctrl', 'F']] 渲染成 [Ctrl] + [K] / [Ctrl] + [F]。
 * 设置里的快捷键表、悬浮提示（Tooltip）、搜索面板的按键提示都用它，键帽样式只在 index.css 的 kbd 里定义一份。
 */
import { Fragment } from 'react';
import { cx } from './common';

export type KeyCombo = string[];

const NAMED_KEYS = /^(ctrl|control|shift|alt|cmd|win|esc|enter|return|tab|space|home|end|pageup|pagedown|delete|del|backspace|insert|f\d{1,2}|空格|回车)$/i;
const SINGLE_KEY = /^[^\s\p{L}\p{N}]$|^[A-Za-z0-9]$|^[←→↑↓↵]+$/u;
const PRETTY: Record<string, string> = { control: 'Ctrl', pageup: 'PageUp', pagedown: 'PageDown' };

/**
 * 把 "Ctrl K" / "Ctrl + K" / "Ctrl+→" / "Esc" 拆成键名数组。
 * 只要有一段不是键名（例如中文说明）就返回 null，调用方应当把它当作普通文字。
 */
export function parseCombo(text: string): KeyCombo | null {
    const parts = text.trim().split(/\s*\+\s*|\s+/).filter(Boolean);
    if (!parts.length || parts.length > 4) return null;
    if (!parts.every(p => NAMED_KEYS.test(p) || SINGLE_KEY.test(p))) return null;
    return parts.map(p => (NAMED_KEYS.test(p) ? PRETTY[p.toLowerCase()] ?? p[0].toUpperCase() + p.slice(1).toLowerCase() : p));
}

export function Keys({ combos, className }: { combos: KeyCombo[]; className?: string }) {
    return (
        <span className={cx('inline-flex flex-wrap items-center gap-x-1.5 gap-y-1', className)}>
            {combos.map((combo, i) => (
                <Fragment key={i}>
                    {i > 0 && <span className="text-[11px] txt-5">/</span>}
                    <span className="inline-flex items-center gap-1">
                        {combo.map((key, j) => (
                            <Fragment key={j}>
                                {j > 0 && <span className="text-[11px] txt-5">+</span>}
                                <kbd>{key}</kbd>
                            </Fragment>
                        ))}
                    </span>
                </Fragment>
            ))}
        </span>
    );
}
