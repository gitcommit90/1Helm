package com.gitcommit90.onehelm.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;
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

    // The origin this app may open: the stored choice.
    static String selectedOrigin(Context context) {
        return validOrigin(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SERVER, null));
    }

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
        String selected = selectedOrigin(getContext());
        // The bundled connection/error shell and the exact selected origin are
        // the only HTTP(S) documents allowed inside this bridge.
        if (sameOrigin(url, Uri.parse("https://localhost")) || (selected != null && sameOrigin(url, Uri.parse(selected)))) return false;
        // Anything else (Terms, Privacy, help pages, links in messages) opens in the phone's browser
        // instead of doing nothing; it never loads inside the app.
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(view);
        } catch (Exception ignored) {
            // No app can open it: leave the page where it is.
        }
        return true;
    }

    // The phone's ringer mode. Android has no silent switch and silent or vibrate mode does not mute media sound, so the 1HC page
    // reads this before it plays a notification chime and stays quiet unless the mode is "normal".
    private BroadcastReceiver ringerReceiver;

    private String ringerMode() {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return "normal";
        switch (am.getRingerMode()) {
            case AudioManager.RINGER_MODE_SILENT: return "silent";
            case AudioManager.RINGER_MODE_VIBRATE: return "vibrate";
            default: return "normal";
        }
    }

    @Override
    public void load() {
        ringerReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                JSObject result = new JSObject(); result.put("mode", ringerMode());
                notifyListeners("ringerModeChange", result);
            }
        };
        ContextCompat.registerReceiver(getContext(), ringerReceiver, new IntentFilter(AudioManager.RINGER_MODE_CHANGED_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        if (ringerReceiver != null) { try { getContext().unregisterReceiver(ringerReceiver); } catch (Exception ignored) { } ringerReceiver = null; }
    }

    @PluginMethod
    public void getRingerMode(PluginCall call) {
        JSObject result = new JSObject(); result.put("mode", ringerMode()); call.resolve(result);
    }

    // What Android itself says about location and the microphone. The web view forgets a page's answers on every launch and
    // reports "not asked yet" again, so the 1HC page asks this instead before showing its permission sheet.
    private String state(String permission) {
        if (ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED) return "granted";
        return getActivity() != null && getActivity().shouldShowRequestPermissionRationale(permission) ? "denied" : "prompt";
    }

    @PluginMethod
    public void nativePermissions(PluginCall call) {
        JSObject result = new JSObject();
        String fine = state(Manifest.permission.ACCESS_FINE_LOCATION), coarse = state(Manifest.permission.ACCESS_COARSE_LOCATION);
        result.put("location", "granted".equals(fine) || "granted".equals(coarse) ? "granted" : "denied".equals(coarse) ? "denied" : "prompt");
        result.put("microphone", state(Manifest.permission.RECORD_AUDIO));
        call.resolve(result);
    }

    @PluginMethod
    public void getServer(PluginCall call) {
        String origin = selectedOrigin(getContext());
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
