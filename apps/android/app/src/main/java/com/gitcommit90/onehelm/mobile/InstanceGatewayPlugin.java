package com.gitcommit90.onehelm.mobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "InstanceGateway")
public class InstanceGatewayPlugin extends Plugin {
    static final String PREFS = "onehelm_instance_gateway";
    static final String SERVER = "selected_https_origin";

    static String validOrigin(String raw) {
        if (raw == null) return null;
        Uri uri = Uri.parse(raw.trim());
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) return null;
        String path = uri.getPath();
        if (path != null && !path.isEmpty() && !"/".equals(path)) return null;
        return new Uri.Builder().scheme("https").encodedAuthority(uri.getEncodedAuthority()).build().toString();
    }

    private static int effectivePort(Uri uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : "http".equalsIgnoreCase(uri.getScheme()) ? 80 : -1;
    }

    private static boolean sameOrigin(Uri left, Uri right) {
        return left != null && right != null && left.getScheme() != null && right.getScheme() != null
            && left.getHost() != null && right.getHost() != null
            && left.getScheme().equalsIgnoreCase(right.getScheme())
            && left.getHost().equalsIgnoreCase(right.getHost())
            && effectivePort(left) == effectivePort(right);
    }

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String scheme = url == null ? "" : String.valueOf(url.getScheme()).toLowerCase();
        if ("data".equals(scheme) || "blob".equals(scheme)) return false;
        if (!"http".equals(scheme) && !"https".equals(scheme)) return null;
        String selected = validOrigin(getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SERVER, null));
        // The bundled connection/error shell and the exact selected origin are
        // the only HTTP(S) documents allowed inside this bridge. External
        // links are opened by the shared frontend before navigation begins.
        return !(sameOrigin(url, Uri.parse("https://localhost")) || (selected != null && sameOrigin(url, Uri.parse(selected))));
    }

    @PluginMethod
    public void getServer(PluginCall call) {
        String origin = validOrigin(getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SERVER, null));
        JSObject result = new JSObject(); result.put("origin", origin == null ? "" : origin); call.resolve(result);
    }

    @PluginMethod
    public void selectServer(PluginCall call) {
        String origin = validOrigin(call.getString("origin"));
        if (origin == null) { call.reject("Choose a valid HTTPS root address."); return; }
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(SERVER, origin).apply();
        JSObject result = new JSObject(); result.put("origin", origin); call.resolve(result);
        getActivity().runOnUiThread(() -> { Intent intent = getActivity().getIntent(); getActivity().finish(); getActivity().startActivity(intent); });
    }

    @PluginMethod
    public void clearServer(PluginCall call) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(SERVER).apply(); call.resolve();
        getActivity().runOnUiThread(() -> { Intent intent = getActivity().getIntent(); getActivity().finish(); getActivity().startActivity(intent); });
    }
}
