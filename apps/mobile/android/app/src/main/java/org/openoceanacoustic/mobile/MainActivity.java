// Copyright (c) 2026 OpenOceanAcoustic and contributors
// SPDX-License-Identifier: AGPL-3.0-only

package org.openoceanacoustic.mobile;

import android.graphics.Color;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.provider.Settings;
import android.view.WindowManager;
import androidx.appcompat.app.AlertDialog;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.net.CookieHandler;

public class MainActivity extends BridgeActivity {
    private Insets safeInsets = Insets.NONE;
    private int keyboardHeight = 0;

    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MobileTransport.class);
        // NativeHttp owns the jar; never inherit Capacitor/WebView's process cookie handler.
        CookieHandler.setDefault(null);
        super.onCreate(savedInstanceState);
        CookieHandler.setDefault(null);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        applyAppearance(false);
        bridge.getWebView().getSettings().setSaveFormData(false);
        ViewCompat.setOnApplyWindowInsetsListener(bridge.getWebView(), (view, insets) -> {
            safeInsets = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            keyboardHeight = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            emitInsets();
            return insets;
        });
        ViewCompat.requestApplyInsets(bridge.getWebView());
        if (!bridge.isMinimumWebViewInstalled()) {
            new AlertDialog.Builder(this)
                .setTitle("请更新系统 WebView")
                .setMessage("OpenOceanAcoustic 需要 Android System WebView 95 或更新版本。请通过应用商店更新 Android System WebView 或 Chrome，然后重新打开应用。")
                .setCancelable(false)
                .setPositiveButton("前往更新", (dialog, which) -> {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.webview"))); }
                    catch (ActivityNotFoundException unavailable) { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
                    finish();
                })
                .setNegativeButton("退出", (dialog, which) -> finish())
                .show();
        }
    }

    void applyAppearance(boolean dark) {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) getWindow().setNavigationBarColor(Color.rgb(15, 23, 42));
        getWindow().getDecorView().setBackgroundColor(dark ? Color.rgb(15, 23, 42) : Color.rgb(248, 250, 252));
    }

    com.getcapacitor.JSObject insetValues() {
        float density = getResources().getDisplayMetrics().density;
        com.getcapacitor.JSObject result = new com.getcapacitor.JSObject();
        result.put("top", safeInsets.top / density);
        result.put("bottom", safeInsets.bottom / density);
        result.put("left", safeInsets.left / density);
        result.put("right", safeInsets.right / density);
        result.put("keyboard", keyboardHeight / density);
        return result;
    }

    private void emitInsets() {
        if (bridge == null || bridge.getWebView() == null) return;
        String values = insetValues().toString();
        bridge.getWebView().evaluateJavascript("(()=>{const v=" + values + ";const s=document.documentElement.style;s.setProperty('--native-inset-top',v.top+'px');s.setProperty('--native-inset-bottom',v.bottom+'px');s.setProperty('--native-inset-left',v.left+'px');s.setProperty('--native-inset-right',v.right+'px');s.setProperty('--native-keyboard-height',v.keyboard+'px');window.dispatchEvent(new CustomEvent('mobileInsets',{detail:v}));})()", null);
    }

    @Override public void onResume() {
        super.onResume();
        if (bridge != null) ViewCompat.requestApplyInsets(bridge.getWebView());
    }
}
