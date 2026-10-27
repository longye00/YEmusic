/** 右下角“正在播放”按钮：旋转的封面，点击打开播放页 */
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { usePlayer } from '@/store/player';
import { ui } from '@/store/ui';
import { Cover } from '../components/common';

export function NowPlayingButton() {
    const current = usePlayer(s => s.current);
    const status = usePlayer(s => s.status);
    if (!current) return null;
    return (
        <motion.button
            type="button"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={ui.openPlayer}
            title="打开播放页"
            className="no-drag absolute bottom-6 right-6 z-30 flex h-[60px] items-center gap-3 rounded-full bg-black/60 lite:bg-black/80 pl-2 pr-4 shadow-[0_12px_40px_rgba(0,0,0,.4)] backdrop-blur-2xl transition-colors hover:bg-black/75"
        >
            <Cover src={current.cover} size={44} seed={current.name} className={`h-11 w-11 ${status === 'playing' ? 'spin-slow' : ''}`} rounded="rounded-full" />
            <span className="h-6 w-px bg-white/15" />
            <ChevronRight className="h-5 w-5 text-white/85" />
        </motion.button>
    );
}
