package com.gitcommit90.onehelm.mobile;

import android.content.Context;
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
    }
}
