/**
 * 浮层容器（Surface）：统一 Esc、遮罩点击、焦点陷阱、焦点归还与 aria 语义。
 * 所有对话框经 Modal 间接使用它，改这里等于所有浮层一起改。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useUi } from "@/store/ui";
import { useLite } from "@/lib/lite";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";

function focusables(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null || el === document.activeElement);
}

export function Surface({ open, onClose, children, className = "", label, backdropClassName = "bg-black/55 backdrop-blur-md" }: {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    className?: string;
    label?: string;
    backdropClassName?: string;
}) {
    const cardRef = useRef<HTMLDivElement>(null);
    const restoreRef = useRef<HTMLElement | null>(null);
    const downOnBackdrop = useRef(false);
    // 精简模式（安卓默认）去掉遮罩毛玻璃：整屏 backdrop-filter 在手机上每帧都要重采样
    // 底下所有内容，设置中心这种大浮层会把主线程拖到卡死。深色遮罩本身已足够压暗。
    const lite = useLite();
    const backdrop = lite ? backdropClassName.replace(/backdrop-blur-\S+/g, "").trim() : backdropClassName;

    useEffect(() => {
        if (!open) return;
        restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const card = cardRef.current;
        if (card) {
            const first = focusables(card)[0];
            (first ?? card).focus({ preventScroll: true });
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                // 歌词样式窗口（z-85）浮在所有 Surface（z-80）之上：它开着时 Esc 归它自己的 capture 监听处理，
                // 不然按一次 Esc 会把底下的设置 / 对话框连带关掉
                if (useUi.getState().lyricStyle) return;
                event.stopPropagation();
                onClose();
                return;
            }
            if (event.key !== "Tab") return;
            const node = cardRef.current;
            if (!node) return;
            const items = focusables(node);
            if (!items.length) {
                event.preventDefault();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement as HTMLElement | null;
            if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && (active === first || active === node)) {
                event.preventDefault();
                last.focus();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            restoreRef.current?.focus?.({ preventScroll: true });
            restoreRef.current = null;
        };
    }, [open, onClose]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={"fixed inset-0 z-[80] grid place-items-center p-6 " + backdrop}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onPointerDown={event => { downOnBackdrop.current = event.target === event.currentTarget; }}
                    onPointerUp={event => {
                        if (downOnBackdrop.current && event.target === event.currentTarget) onClose();
                        downOnBackdrop.current = false;
                    }}
                >
                    <motion.div
                        ref={cardRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label={label}
                        tabIndex={-1}
                        className={"relative max-h-full overflow-hidden rounded-[var(--radius-card)] border ln bg-[var(--surface-card)] shadow-[var(--shadow-card)] outline-none " + className}
                        initial={{ opacity: 0, scale: 0.94, y: 16 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    >
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
