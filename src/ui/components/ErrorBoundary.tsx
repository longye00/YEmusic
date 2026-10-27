/** 渲染错误兜底：单个视图出错时只替换该视图，不再让整个窗口变成黑屏 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
    name: string;
    children: ReactNode;
    /** 点击“返回”时调用，通常用于关闭出错的视图 */
    onReset?: () => void;
    /** 是否铺满父容器（详情页 / 播放页等全屏视图） */
    fill?: boolean;
    /** 该值变化时自动清除错误状态（例如打开了另一个歌单） */
    resetKey?: unknown;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidUpdate(prev: Props) {
        if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(`[ui] ${this.props.name} 渲染出错`, error, info.componentStack);
    }

    private reset = () => {
        this.setState({ error: null });
        this.props.onReset?.();
    };

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        return (
            <div className={this.props.fill === false ? 'p-6' : 'pointer-events-auto absolute inset-0 z-[60] grid place-items-center bg-[rgba(7,7,11,0.85)] p-6 backdrop-blur-xl'}>
                <div className="w-[min(480px,100%)] rounded-[24px] border border-white/10 bg-white/[0.04] p-6 text-center">
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-red-500/15 text-red-200"><AlertTriangle className="h-6 w-6" /></div>
                    <div className="mt-3 text-[16px] font-bold">{this.props.name}出了点问题</div>
                    <div className="mt-1.5 break-all font-mono text-[11.5px] text-white/45">{String(error.message || error).slice(0, 240)}</div>
                    <div className="mt-5 flex justify-center gap-2">
                        <button type="button" onClick={this.reset} className="flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-semibold text-black"><RotateCcw className="h-4 w-4" />返回</button>
                        <button type="button" onClick={() => location.reload()} className="h-9 rounded-full bg-white/10 px-4 text-[13px] font-semibold hover:bg-white/15">重新加载界面</button>
                    </div>
                </div>
            </div>
        );
    }
}
