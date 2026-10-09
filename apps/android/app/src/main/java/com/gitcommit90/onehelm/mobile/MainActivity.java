package com.gitcommit90.onehelm.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(InstanceGatewayPlugin.class);
        String selected = InstanceGatewayPlugin.validOrigin(getSharedPreferences(InstanceGatewayPlugin.PREFS, Context.MODE_PRIVATE).getString(InstanceGatewayPlugin.SERVER, null));
        if (selected != null) {
            config = new CapConfig.Builder(this)
                .setServerUrl(selected)
                .setErrorPath("error.html")
                .setAndroidScheme("https")
                .setAppendedUserAgentString("1HelmMobile")
                .setBackgroundColor("#111318")
                .setAllowMixedContent(false)
                .setWebContentsDebuggingEnabled(false)
                .setUseLegacyBridge(false)
                .setZoomableWebView(false)
                .create();
        }
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel("1helm_activity", "1Helm activity", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Channel and resident-agent updates");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }
}
