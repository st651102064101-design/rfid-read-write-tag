package com.kriangkrai.rfid;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** The bridge is exposed exclusively to our packaged UI, never a remote website. */
public final class MainActivity extends Activity {
    private static final String PAGE = "file:///android_asset/index.html";
    private WebView web;
    private RfidBridge bridge;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setTitle("RFID Live & Write");
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        bridge = new RfidBridge(getApplicationContext(), web);
        web.addJavascriptInterface(bridge, "AndroidRfid");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !localPage(request.getUrl().toString());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !localPage(url);
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (localPage(url)) bridge.pageReady();
            }
        });
        setContentView(web);
        web.loadUrl(PAGE);
    }

    private static boolean localPage(String url) { return url.equals(PAGE) || url.startsWith(PAGE + "#"); }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        if (bridge != null) bridge.resume();
    }
    @Override protected void onPause() {
        if (bridge != null) bridge.pause();
        if (web != null) web.onPause();
        super.onPause();
    }
    @Override protected void onDestroy() {
        if (bridge != null) bridge.dispose();
        if (web != null) { web.removeJavascriptInterface("AndroidRfid"); web.destroy(); }
        super.onDestroy();
    }
    @Override public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript("!!(window.NativeRfid && window.NativeRfid.back && window.NativeRfid.back())",
                handled -> { if (!"true".equals(handled)) MainActivity.super.onBackPressed(); });
    }
}
