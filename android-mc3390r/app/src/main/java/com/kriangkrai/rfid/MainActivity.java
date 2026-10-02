package com.kriangkrai.rfid;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.util.Log;
import android.content.pm.ApplicationInfo;
import android.media.AudioManager;
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
    private final BroadcastReceiver dataWedgeResult = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            Bundle info = intent.getBundleExtra("RESULT_INFO");
            if ("RFID_ONLY_PROFILE".equals(intent.getStringExtra("COMMAND_IDENTIFIER")) && info != null
                    && "APP_ALREADY_ASSOCIATED".equals(info.getString("RESULT_CODE"))) configureRfidOnlyProfile(false);
            for (String key : intent.getExtras().keySet()) {
                Object value = intent.getExtras().get(key);
                if (value instanceof Bundle) {
                    Bundle bundle = (Bundle) value;
                    for (String child : bundle.keySet()) Log.i("MC3390R.Barcode", key + "." + child + "=" + bundle.get(child));
                } else Log.i("MC3390R.Barcode", key + "=" + value);
            }

        }
    };
    private static IntentFilter dataWedgeFilter() {
        IntentFilter filter = new IntentFilter("com.symbol.datawedge.api.RESULT_ACTION");
        filter.addCategory(Intent.CATEGORY_DEFAULT);
        return filter;
    }
    private void configureRfidOnlyProfile() { configureRfidOnlyProfile(true); }
    private void configureRfidOnlyProfile(boolean associate) {
        Intent create = new Intent("com.symbol.datawedge.api.ACTION");
        create.putExtra("com.symbol.datawedge.api.CREATE_PROFILE", "MC3390R_RFID_ONLY");
        sendBroadcast(create);
        Bundle config = new Bundle();
        config.putString("PROFILE_NAME", "MC3390R_RFID_ONLY");
        config.putString("PROFILE_ENABLED", "true");
        config.putString("CONFIG_MODE", "UPDATE");
        Bundle app = new Bundle();
        app.putString("PACKAGE_NAME", getPackageName());
        app.putStringArray("ACTIVITY_LIST", new String[]{"*"});
        // Association is installed once; repeating it produces APP_ALREADY_ASSOCIATED.
        if (associate) config.putParcelableArray("APP_LIST", new Bundle[]{app});
        Bundle plugin = new Bundle(), params = new Bundle();
        plugin.putString("PLUGIN_NAME", "BARCODE");
        plugin.putString("RESET_CONFIG", "true");
        params.putString("scanner_input_enabled", "false");
        params.putString("scanner_selection", "auto");
        plugin.putBundle("PARAM_LIST", params);
        java.util.ArrayList<Bundle> plugins = new java.util.ArrayList<>();
        plugins.add(plugin);
        config.putParcelableArrayList("PLUGIN_CONFIG", plugins);
        Intent command = new Intent("com.symbol.datawedge.api.ACTION");
        command.putExtra("com.symbol.datawedge.api.SET_CONFIG", config);
        command.putExtra("SEND_RESULT", "true");
        command.putExtra("COMMAND_IDENTIFIER", "RFID_ONLY_PROFILE");
        sendBroadcast(command);
    }


    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerReceiver(dataWedgeResult, dataWedgeFilter());
        configureRfidOnlyProfile();
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
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
        configureRfidOnlyProfile();
        if (web != null) web.onResume();
        if (bridge != null) bridge.resume();
    }
    @Override protected void onPause() {
        if (bridge != null) bridge.pause();
        if (web != null) web.onPause();
        super.onPause();
    }
    @Override protected void onDestroy() {
        unregisterReceiver(dataWedgeResult);
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
