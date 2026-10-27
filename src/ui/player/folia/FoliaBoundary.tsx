/** 某个 Folia 动画在当前设备上崩溃（如不支持 WebGL）时，不能拖垮整个播放页：捕获后退回备用歌词。 */
import { Component, type ReactNode } from 'react';

interface Props {
    /** 变化时（换动画 / 换歌）重置错误状态 */
    resetKey: string;
    fallback: ReactNode;
    onError?: (error: Error) => void;
    children: ReactNode;
}

export class FoliaBoundary extends Component<Props, { failedKey: string | null }> {
    state = { failedKey: null as string | null };

    static getDerivedStateFromError() {
        return { failedKey: '*' };
    }

    componentDidCatch(error: Error) {
        console.error('[folia] 歌词动画运行出错，已退回备用样式', error);
        this.setState({ failedKey: this.props.resetKey });
        this.props.onError?.(error);
    }

    componentDidUpdate(prev: Props) {
        if (prev.resetKey !== this.props.resetKey && this.state.failedKey) this.setState({ failedKey: null });
    }

    render() {
        return this.state.failedKey ? this.props.fallback : this.props.children;
    }
}
