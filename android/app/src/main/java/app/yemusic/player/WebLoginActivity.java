package app.yemusic.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.regex.Pattern;

/**
 * 应用内网页登录：打开平台自己的手机版登录页，用户在里面按平台的方式登录
 * （手机号 / 密码 / 平台 App 授权），会话 Cookie 一出现就把 Cookie 交回页面侧并自动关闭。
 * 取代「在别的设备复制 Cookie 再粘贴」的做法；Cookie 只在本进程内读取，不外传。
 */
public class WebLoginActivity extends Activity {
    public interface Listener {
        void onLoginResult(String cookie, boolean cancelled);
    }

    private static volatile Listener listener;

    static void setListener(Listener next) {
        listener = next;
    }

    /** 手机版 Chrome 的 UA：平台桌面登录页在手机上排版会乱，移动页才有手机号 / 密码入口 */
    private static final String UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";
    /** 轮询间隔：登录页是单页应用，路由切换不触发 onPageFinished，只能定时看 Cookie */
    private static final long POLL_MS = 900;
    /** 轮询上限（约 5 分钟）：用户没登完就自己关窗，不留后台任务 */
    private static final int POLL_MAX = 330;

    private WebView web;
    private String platform;
    private String currentUrl;
    private boolean settled = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private int ticks = 0;

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (settled || web == null) return;
            if (++ticks > POLL_MAX) {
                finishWith(null, true);
                return;
            }
            String cookie = cookiesFor(platform);
            if (loginComplete(platform, cookie)) {
                finishWith(cookie, false);
                return;
            }
            handler.postDelayed(this, POLL_MS);
        }
    };

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        platform = getIntent().getStringExtra("platform");
        final String url = getIntent().getStringExtra("url");
        final String title = getIntent().getStringExtra("title");
        currentUrl = url == null ? "about:blank" : url;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#1a1a1d"));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        final int pad = dp(14);
        bar.setPadding(pad, pad, pad, pad / 2);
        TextView label = new TextView(this);
        label.setText(title == null ? "登录" : title);
        label.setTextColor(Color.parseColor("#f2f2f4"));
        label.setTextSize(15);
        label.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button cancel = new Button(this);
        cancel.setText("取消");
        cancel.setTextColor(Color.parseColor("#9a9aa2"));
        cancel.setBackgroundColor(Color.TRANSPARENT);
        cancel.setOnClickListener(v -> finishWith(null, true));
        bar.addView(label);
        bar.addView(cancel);

        web = new WebView(this);
        web.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUserAgentString(UA);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String pageUrl, android.graphics.Bitmap favicon) {
                if (pageUrl != null) currentUrl = pageUrl;
            }

            @Override
            public void onPageFinished(WebView view, String pageUrl) {
                if (pageUrl != null) currentUrl = pageUrl;
                // 整页加载完先查一次：有的平台登录后直接跳到首页，Cookie 这时已经写好
                String cookie = cookiesFor(platform);
                if (!settled && loginComplete(platform, cookie)) {
                    finishWith(cookie, false);
                    return;
                }
                if (!settled && ticks == 0) handler.postDelayed(poll, POLL_MS);
            }
        });
        root.addView(bar);
        root.addView(web);
        setContentView(root);
        web.loadUrl(currentUrl);
    }

    private void finishWith(String cookie, boolean cancelled) {
        if (settled) return;
        settled = true;
        handler.removeCallbacks(poll);
        Listener l = listener;
        listener = null;
        if (l != null) l.onLoginResult(cookie, cancelled);
        finish();
    }

    @Override
    public void onBackPressed() {
        // 登录页内部的多步流程（选方式 → 填验证码）用返回键回上一步，退到第一页才关窗
        if (!settled && web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        finishWith(null, true);
    }

    @Override
    protected void onDestroy() {
        finishWith(null, true);
        if (web != null) {
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private static boolean has(String cookie, String key) {
        return Pattern.compile("(^|;\\s*)" + Pattern.quote(key)).matcher(cookie).find();
    }

    /** 各平台的 Cookie 域：登录后可能跳到别的子域，凭据写在主域上，只读当前 URL 会漏掉 */
    private static final String[][] COOKIE_DOMAINS = {
            { "wy", "https://music.163.com", "https://music.163.com/m/" },
            { "tx", "https://y.qq.com", "https://i.y.qq.com/n2/m/account/account.html" },
            { "kg", "https://www.kugou.com", "https://m.kugou.com/" },
    };

    /** 汇总当前页与各平台主域的 Cookie（去重），任一处出现会话凭据即认为登录完成 */
    private String cookiesFor(String platform) {
        CookieManager cm = CookieManager.getInstance();
        StringBuilder sb = new StringBuilder();
        String page = cm.getCookie(currentUrl);
        if (page != null) sb.append(page).append("; ");
        for (String[] row : COOKIE_DOMAINS) {
            if (!row[0].equals(platform)) continue;
            for (int i = 1; i < row.length; i++) {
                String c = cm.getCookie(row[i]);
                if (c != null) sb.append(c).append("; ");
            }
        }
        return sb.toString();
    }

    /** 各平台登录完成的判定：会话凭据那几个 Cookie 都齐了才算登录成功 */
    static boolean loginComplete(String platform, String cookie) {
        if (cookie == null || cookie.isEmpty()) return false;
        if ("wy".equals(platform)) return has(cookie, "MUSIC_U=");
        if ("tx".equals(platform)) {
            return (has(cookie, "uin=") || has(cookie, "wxuin=") || has(cookie, "p_uin="))
                    && (has(cookie, "qqmusic_key=") || has(cookie, "qm_keyst="));
        }
        if ("kg".equals(platform)) {
            return (has(cookie, "userid=") || has(cookie, "KugooID="))
                    && (has(cookie, "token=") || has(cookie, "t="));
        }
        return false;
    }
}
