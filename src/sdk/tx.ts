/** QQ 音乐（接口参考 lx-music-desktop，Apache-2.0）。 */
import { requestJson } from '@/lib/http';
import { base64Decode, utf8Decode } from '@/lib/bytes';
import { decodeEntities } from '@/lib/util';
import { getTxCredential, txHeaders } from './txAuth';
import { sizeFormat, sortQualities, trackKey, type Board, type PlatformSdk, type QualityInfo, type Track } from './types';

const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

function fromSong(item: any): Track | null {
    const file = item?.file;
    if (!item?.mid || !file?.media_mid) return null;
    const qualities: QualityInfo[] = [];
    if (Number(file.size_128mp3)) qualities.push({ type: '128k', size: sizeFormat(file.size_128mp3) });
    if (Number(file.size_320mp3)) qualities.push({ type: '320k', size: sizeFormat(file.size_320mp3) });
    if (Number(file.size_flac)) qualities.push({ type: 'flac', size: sizeFormat(file.size_flac) });
    if (Number(file.size_hires)) qualities.push({ type: 'flac24bit', size: sizeFormat(file.size_hires) });
    const albumMid = item.album?.mid || '';
    const singers = Array.isArray(item.singer) ? item.singer : [];
    const cover = albumMid && albumMid !== '空'
        ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`
        : singers[0]?.mid ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${singers[0].mid}.jpg` : undefined;
    return {
        id: trackKey('tx', item.mid),
        source: 'tx',
        songmid: String(item.mid),
        name: decodeEntities(item.title || item.name),
        singer: decodeEntities(singers.map((s: any) => s.name).join('、')),
        album: decodeEntities(item.album?.title || item.album?.name || ''),
        albumId: albumMid,
        duration: Number(item.interval) || 0,
        cover,
        qualities: sortQualities(qualities.length ? qualities : [{ type: '128k' }]),
        meta: { songId: item.id, strMediaMid: file.media_mid, albumMid },
    };
}

const BOARDS: [string, string][] = [
    ['4', '流行指数榜'], ['26', '热歌榜'], ['27', '新歌榜'], ['62', '飙升榜'], ['58', '说唱榜'], ['57', '电音榜'], ['28', '网络歌曲榜'],
    ['5', '内地榜'], ['3', '欧美榜'], ['59', '香港地区榜'], ['16', '韩国榜'], ['60', '抖快榜'], ['29', '影视金曲榜'], ['17', '日本榜'],
    ['52', '腾讯音乐人原创榜'], ['36', 'K歌金曲榜'], ['61', '台湾地区榜'], ['65', '国风热歌榜'], ['72', '动漫音乐榜'], ['73', '游戏音乐榜'],
];

export const tx: PlatformSdk = {
    id: 'tx',
    name: 'QQ音乐',
    async search(keyword, page = 1, limit = 30) {
        let data: any = null;
        for (let i = 0; i < 3 && !data; i++) {
            const body = await requestJson(MUSICU, {
                json: {
                    comm: { ct: '19', cv: '1859', uin: '0' },
                    req: {
                        method: 'DoSearchForQQMusicDesktop',
                        module: 'music.search.SearchCgiService',
                        param: { grp: 1, num_per_page: limit, page_num: page, query: keyword, search_type: 0 },
                    },
                },
                headers: { Referer: 'https://y.qq.com/' },
            });
            if (body?.code === 0 && body.req?.code === 0) data = body.req.data;
        }
        const list = (data?.body?.song?.list || []).map(fromSong).filter(Boolean) as Track[];
        return { list, total: Number(data?.meta?.sum) || list.length, page, limit, source: 'tx' as const };
    },
    async getLyric(track) {
        const body = await requestJson(
            `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${track.songmid}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq&nobase64=0`,
            { headers: { Referer: 'https://y.qq.com/portal/player.html' } },
        );
        if (body?.code !== 0 || !body.lyric) throw new Error('暂无歌词');
        const decode = (text: string) => decodeEntities(utf8Decode(base64Decode(text || '')));
        return { lyric: decode(body.lyric), tlyric: body.trans ? decode(body.trans) : '' };
    },
    boards: BOARDS.map(([bangid, name]) => ({ id: `tx__${bangid}`, source: 'tx', name, bangid }) as Board),
    async getBoardList(bangid, page = 1) {
        const limit = 100;
        const body = await requestJson(MUSICU, {
            json: {
                toplist: { module: 'musicToplist.ToplistInfoServer', method: 'GetDetail', param: { topid: Number(bangid), num: limit, offset: (page - 1) * limit, period: '' } },
                comm: { uin: 0, format: 'json', ct: 20, cv: 1859 },
            },
        });
        const data = body?.toplist?.data;
        const list = (data?.songInfoList || []).map(fromSong).filter(Boolean) as Track[];
        return {
            list,
            total: Number(data?.data?.totalNum) || list.length,
            page,
            limit,
            info: { name: data?.data?.title, desc: data?.data?.intro, cover: data?.data?.frontPicUrl || data?.data?.headPicUrl },
        };
    },
    songListSorts: [
        { id: '5', name: '最热' },
        { id: '2', name: '最新' },
    ],
    async getSongLists(sortId = '5', page = 1) {
        const limit = 30;
        const body = await requestJson(
            `${MUSICU}?data=${encodeURIComponent(JSON.stringify({ comm: { cv: 1602, ct: 20 }, playlist: { method: 'get_playlist_by_tag', param: { id: 10000000, sin: (page - 1) * limit, size: limit, order: Number(sortId), cur_page: page }, module: 'playlist.PlayListPlazaServer' } }))}`,
        );
        const data = body?.playlist?.data;
        return {
            list: (data?.v_playlist || []).map((item: any) => ({
                id: String(item.tid),
                source: 'tx' as const,
                name: decodeEntities(item.title),
                cover: String(item.cover_url_big || item.cover_url_medium || '').replace(/^http:/, 'https:'),
                playCount: Number(item.access_num) || 0,
                author: item.creator_info?.nick,
                desc: item.desc,
            })),
            total: Number(data?.total) || 0,
            page,
            limit,
        };
    },
    async getSongListDetail(id) {
        // 登录 QQ 音乐后带上凭据，才能打开自己的私密歌单（如“我喜欢”）
        const uin = getTxCredential()?.uin || '0';
        const body = await requestJson(
            `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${id}&loginUin=${uin}&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`,
            { headers: txHeaders(`https://y.qq.com/n/yqq/playsquare/${id}.html`) },
        );
        const cd = body?.cdlist?.[0];
        if (!cd) throw new Error('歌单获取失败');
        const list = (cd.songlist || []).map(fromSong).filter(Boolean) as Track[];
        return {
            list,
            total: list.length,
            page: 1,
            limit: list.length || 1,
            info: { name: decodeEntities(cd.dissname), cover: String(cd.logo || '').replace(/^http:/, 'https:'), desc: decodeEntities(cd.desc), author: cd.nickname, playCount: cd.visitnum },
        };
    },
};

/** QQ 音乐专辑（albumMid）里的歌曲 */
export async function txAlbumDetail(albumMid: string): Promise<Track[]> {
    const body = await requestJson(MUSICU, {
        method: 'POST',
        json: { comm: { ct: 24, cv: 10000 }, albumSonglist: { method: 'GetAlbumSongList', param: { albumMid, albumID: 0, begin: 0, num: 500, order: 2 }, module: 'music.musichallAlbum.AlbumSongList' } },
        headers: { Referer: 'https://y.qq.com/' },
    });
    const data = body?.albumSonglist?.data;
    if (Number(body?.albumSonglist?.code) !== 0 || !data) throw new Error('专辑获取失败');
    return (data.songList || []).map((item: any) => fromSong(item?.songInfo)).filter(Boolean) as Track[];
}
