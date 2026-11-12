package com.gitcommit90.onehelm.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.Bridge;

/**
 * Native side of the bundled error page (apps/mobile-gateway/error.html). Capacitor shows that page when the selected server
 * cannot be reached. The page is served from https://localhost and Capacitor's JavaScript (window.Capacitor) is not present
 * there, so the page talks to the app through this interface, named HelmNative. Every action that changes anything is
 * accepted only while the web view is showing the bundled error page, so a page from the server cannot use it.
 */
final class ErrorPageBridge {
    private final Activity activity;
    private final Bridge bridge;

    private ErrorPageBridge(Activity activity, Bridge bridge) {
        this.activity = activity;
        this.bridge = bridge;
    }

    static void install(Activity activity, Bridge bridge) {
        WebView web = bridge == null ? null : bridge.getWebView();
        if (web == null) return;
        web.addJavascriptInterface(new ErrorPageBridge(activity, bridge), "HelmNative");
    }

    private boolean onErrorPage(WebView web) {
        String url = web.getUrl();
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return "https".equalsIgnoreCase(uri.getScheme()) && "localhost".equalsIgnoreCase(uri.getHost()) && "/error.html".equals(uri.getPath());
    }

    /** The server the app is set to open (an https root address), or an empty string. */
    @JavascriptInterface
    public String origin() {
        String url = bridge.getAppUrl();
        return url == null ? "" : url.replaceAll("/+$", "");
    }

    @JavascriptInterface
    public boolean canStartOver() {
        return true;
    }

    /** Loads the selected server again in this web view. */
    @JavascriptInterface
    public void retry() {
        activity.runOnUiThread(() -> {
            WebView web = bridge.getWebView();
            String url = bridge.getAppUrl();
            if (web == null || url == null || !onErrorPage(web)) return;
            web.loadUrl(url);
        });
    }

    /** Forgets the saved server and restarts the app on the server choice screen. */
    @JavascriptInterface
    public void startOver() {
        activity.runOnUiThread(() -> {
            WebView web = bridge.getWebView();
            if (web == null || !onErrorPage(web)) return;
            activity.getSharedPreferences(InstanceGatewayPlugin.PREFS, Context.MODE_PRIVATE).edit().remove(InstanceGatewayPlugin.SERVER).apply();
            Intent intent = activity.getIntent();
            activity.finish();
            activity.startActivity(intent);
        });
    }
}
