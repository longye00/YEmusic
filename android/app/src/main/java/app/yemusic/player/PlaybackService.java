package app.yemusic.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.media.session.MediaButtonReceiver;

/**
 * 播放服务：播放器本身跑在 WebView 里（<audio> + WebAudio），这个前台服务负责让系统把应用视为“正在播放音乐”：
 *  - 前台服务 + 媒体通知（上一首 / 播放暂停 / 下一首、封面、进度条），后台与锁屏下不会被系统回收；
 *  - MediaSession：耳机线控 / 蓝牙按键 / 锁屏控件 → 转成命令回传给页面；
 *  - 播放期间持有 CPU 与 Wi-Fi 锁，熄屏后在线流不会卡顿。
 */
public class PlaybackService extends Service {
    static final String CHANNEL_ID = "yemusic_playback";
    private static final int NOTIFICATION_ID = 7001;

    /** 页面推送过来的“正在播放”状态 */
    static final class State {
        String title = "";
        String artist = "";
        String album = "";
        Bitmap cover;
        long durationMs;
        long positionMs;
        boolean playing;
        boolean hasTrack;
        /** 封面没有变化：沿用上一次的封面，页面不必重复传图 */
        boolean keepCover;
    }

    private static volatile PlaybackService instance;
    private static volatile State pending;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private MediaSessionCompat session;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private boolean foreground;
    private State state = new State();

    // ---------------------------------------------------------------- 对外接口

    /** 由插件在页面状态变化时调用（任意线程） */
    static void update(Context context, State next) {
        pending = next;
        PlaybackService running = instance;
        if (running != null) {
            MAIN.post(() -> running.apply(next));
            return;
        }
        if (!next.hasTrack || !next.playing) return; // 没有在播放就不需要拉起服务
        try {
            ContextCompat.startForegroundService(context, new Intent(context, PlaybackService.class));
        } catch (RuntimeException e) {
            // 后台启动前台服务被系统拒绝（Android 12+）：忽略，等用户回到前台后下一次状态更新再试
        }
    }

    static void stop(Context context) {
        pending = null;
        PlaybackService running = instance;
        if (running != null) MAIN.post(running::shutdown);
        else context.stopService(new Intent(context, PlaybackService.class));
    }

    // ---------------------------------------------------------------- 生命周期

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        ensureChannel();
        session = new MediaSessionCompat(this, "YEmusic");
        session.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { YeNativePlugin.emitCommand("play"); }
            @Override public void onPause() { YeNativePlugin.emitCommand("pause"); }
            @Override public void onStop() { YeNativePlugin.emitCommand("pause"); }
            @Override public void onSkipToNext() { YeNativePlugin.emitCommand("next"); }
            @Override public void onSkipToPrevious() { YeNativePlugin.emitCommand("prev"); }
            @Override public void onSeekTo(long pos) { YeNativePlugin.emitCommand("seek:" + (pos / 1000.0)); }
        });
        session.setActive(true);
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "YEmusic:playback");
            wakeLock.setReferenceCounted(false);
        }
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "YEmusic:playback");
            wifiLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && Intent.ACTION_MEDIA_BUTTON.equals(intent.getAction())) {
            MediaButtonReceiver.handleIntent(session, intent);
        }
        State next = pending;
        apply(next != null ? next : state);
        if (!foreground) {
            // startForegroundService 之后必须尽快 startForeground，即使还没有曲目信息
            try {
                startForegroundCompat(buildNotification());
                foreground = true;
            } catch (RuntimeException ignored) { }
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        shutdown();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        releaseLocks();
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        super.onDestroy();
    }

    private void shutdown() {
        releaseLocks();
        try { stopForeground(true); } catch (RuntimeException ignored) { }
        foreground = false;
        stopSelf();
    }

    // ---------------------------------------------------------------- 状态 / 通知

    private void apply(State next) {
        if (next == null || session == null) return;
        if (next.cover == null && next.keepCover) next.cover = state.cover;
        state = next;
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, next.title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, next.artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, next.album)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, next.durationMs > 0 ? next.durationMs : -1);
        if (next.cover != null) meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, next.cover);
        session.setMetadata(meta.build());
        long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO | PlaybackStateCompat.ACTION_STOP;
        session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(next.hasTrack ? (next.playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED) : PlaybackStateCompat.STATE_NONE,
                        Math.max(0, next.positionMs), next.playing ? 1f : 0f)
                .build());
        updateLocks(next.playing);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        Notification n = buildNotification();
        try {
            if (next.playing) {
                if (!foreground) {
                    startForegroundCompat(n);
                    foreground = true;
                } else if (nm != null) {
                    nm.notify(NOTIFICATION_ID, n);
                }
            } else {
                if (foreground) {
                    stopForeground(false); // 保留通知但允许用户划掉
                    foreground = false;
                }
                if (nm != null && next.hasTrack) nm.notify(NOTIFICATION_ID, n);
                else if (nm != null) nm.cancel(NOTIFICATION_ID);
            }
        } catch (RuntimeException ignored) {
            // 没有通知权限或系统拒绝前台服务：播放本身不受影响
        }
    }

    private void startForegroundCompat(Notification n) {
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIFICATION_ID, n);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "音乐播放", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("显示正在播放的歌曲并提供播放控制");
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        State s = state;
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent content = launch == null ? null : PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_music)
                .setContentTitle(s.hasTrack && !s.title.isEmpty() ? s.title : "YEmusic")
                .setContentText(s.hasTrack ? s.artist : "")
                .setSubText(s.hasTrack && !s.album.isEmpty() ? s.album : null)
                .setContentIntent(content)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setOngoing(s.playing)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setDeleteIntent(MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_STOP));
        if (s.cover != null) b.setLargeIcon(s.cover);
        b.addAction(R.drawable.ic_notif_prev, "上一首", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS));
        if (s.playing) b.addAction(R.drawable.ic_notif_pause, "暂停", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PAUSE));
        else b.addAction(R.drawable.ic_notif_play, "播放", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PLAY));
        b.addAction(R.drawable.ic_notif_next, "下一首", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT));
        androidx.media.app.NotificationCompat.MediaStyle style = new androidx.media.app.NotificationCompat.MediaStyle()
                .setShowActionsInCompactView(0, 1, 2);
        if (session != null) style.setMediaSession(session.getSessionToken());
        b.setStyle(style);
        return b.build();
    }

    private void updateLocks(boolean playing) {
        try {
            if (playing) {
                if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
                if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
            } else {
                releaseLocks();
            }
        } catch (RuntimeException ignored) { }
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (RuntimeException ignored) { }
    }
}
