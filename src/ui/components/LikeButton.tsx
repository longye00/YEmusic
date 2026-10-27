/** 播放条上的“我喜欢”开关：点一下把当前歌曲加入 / 移出「我喜欢的音乐」 */
import { Heart } from 'lucide-react';
import type { Track } from '@/sdk/types';
import { toggleFavorite } from '@/store/library';
import { toast } from '@/store/toast';
import { useIsFavorite } from '../hooks';
import { cx } from './common';

export function LikeButton({ track, className, iconClass = 'h-[18px] w-[18px]' }: { track?: Track | null; className?: string; iconClass?: string }) {
    const liked = useIsFavorite(track?.id);
    return (
        <button
            type="button"
            title={liked ? '取消喜欢' : '喜欢'}
            aria-label={liked ? '取消喜欢' : '喜欢'}
            aria-pressed={liked}
            disabled={!track}
            onClick={event => {
                event.stopPropagation();
                if (!track) return;
                const on = toggleFavorite(track);
                toast(on ? '已添加到「我喜欢的音乐」' : '已取消喜欢', on ? 'success' : 'info', { duration: 1300, key: 'like' });
            }}
            className={cx('grid shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40', liked ? 'text-rose-400' : 'text-white/70 hover:text-white', className)}
        >
            <Heart className={iconClass} fill={liked ? 'currentColor' : 'none'} />
        </button>
    );
}
