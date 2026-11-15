package com.gitcommit90.onehelm.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.res.Configuration;
import android.os.Build;
import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.content.ActivityNotFoundException;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebView;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.CapConfig;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(InstanceGatewayPlugin.class);
        String selected = InstanceGatewayPlugin.selectedOrigin(this);
        if (selected != null) {
            config = new CapConfig.Builder(this)
                .setServerUrl(selected)
                .setErrorPath("error.html")
                .setAndroidScheme("https")
                .setAppendedUserAgentString("1HelmMobile")
                .setBackgroundColor((getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES ? "#121212" : "#f3f2ef")
                .setAllowMixedContent(false)
                .setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
                .setUseLegacyBridge(false)
                .setZoomableWebView(false)
                .create();
        }
        super.onCreate(savedInstanceState);
        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setWebChromeClient(new QueuedPermissionChromeClient(bridge));
            bridge.setWebViewClient(new FlushingWebViewClient(bridge));
            ErrorPageBridge.install(this, bridge);
            bridge.registerPluginInstance(new QueuedPushNotificationsPlugin());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel("1helm_activity", "1Helm activity", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Channel and resident-agent updates");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        flushCookies();
    }

    @Override
    public void onStop() {
        super.onStop();
        flushCookies();
    }

    // Android answers a second permission request made while one is open at once, as denied. Web prompts (the chrome client
    // below) and plugin prompts (push notifications) all go through this gate, so they open one after the other.
    interface PermissionTask {
        /** Starts the task. Returns true when it opened an Android permission request, false when it finished without one. */
        boolean start();
    }

    private final ArrayDeque<PermissionTask> permissionWaiting = new ArrayDeque<>();
    private boolean permissionOpen = false;

    void permissionGate(PermissionTask task) {
        permissionWaiting.add(task);
        if (!permissionOpen) runNextPermissionTask();
    }

    private void runNextPermissionTask() {
        while (!permissionOpen) {
            PermissionTask next = permissionWaiting.poll();
            if (next == null) return;
            boolean opened;
            try {
                opened = next.start();
            } catch (RuntimeException e) {
                opened = false;
            }
            permissionOpen = opened;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        try {
            super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        } finally {
            if (permissionOpen) {
                permissionOpen = false;
                runNextPermissionTask();
            }
        }
    }

    /** Push notification permission request, held until no other permission request is open. */
    @CapacitorPlugin(
        name = "PushNotifications",
        permissions = @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "receive")
    )
    public static class QueuedPushNotificationsPlugin extends PushNotificationsPlugin {
        @PluginMethod
        @Override
        public void requestPermissions(PluginCall call) {
            Activity activity = getActivity();
            boolean needsPrompt = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED;
            if (!needsPrompt || !(activity instanceof MainActivity)) {
                super.requestPermissions(call);
                return;
            }
            ((MainActivity) activity).permissionGate(() -> {
                super.requestPermissions(call);
                return true;
            });
        }
    }

    static void flushCookies() {
        try {
            CookieManager.getInstance().flush();
        } catch (RuntimeException ignored) {
        }
    }

    /** Writes cookies to disk after each page load so a sign-in survives a crash or kill. */
    private static class FlushingWebViewClient extends BridgeWebViewClient {
        FlushingWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            flushCookies();
        }
    }

    /**
     * Runs web permission prompts one at a time. Each PermissionRequest and each geolocation
     * callback is answered exactly once, and a request the page cancels is dropped.
     */
    private class QueuedPermissionChromeClient extends BridgeWebChromeClient {
        private abstract class Job {
            boolean cancelled = false;
            boolean answered = false;
            boolean geolocation = false;
            PermissionRequest request = null;
            final String[] needed;

            Job(String[] needed) {
                this.needed = needed;
            }

            abstract void answer(boolean granted);

            void finish(boolean granted) {
                if (answered) return;
                answered = true;
                if (!cancelled) {
                    try {
                        answer(granted);
                    } catch (RuntimeException ignored) {
                    }
                }
            }
        }

        private final List<Job> jobs = new ArrayList<>();
        private final ActivityResultLauncher<String[]> launcher;
        private Job current = null;

        QueuedPermissionChromeClient(Bridge bridge) {
            super(bridge);
            launcher = registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), this::onResult);
            chooserLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), this::onChooserResult);
        }

        private boolean has(String permission) {
            return ContextCompat.checkSelfPermission(MainActivity.this, permission) == PackageManager.PERMISSION_GRANTED;
        }

        private String[] missing(String[] permissions) {
            List<String> out = new ArrayList<>();
            for (String permission : permissions) if (!has(permission)) out.add(permission);
            return out.toArray(new String[0]);
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            List<String> list = new ArrayList<>();
            for (String resource : request.getResources()) {
                if ("android.webkit.resource.VIDEO_CAPTURE".equals(resource)) list.add(Manifest.permission.CAMERA);
                // MODIFY_AUDIO_SETTINGS is not requested: it is a normal permission this app does not declare, so it never reads as granted.
                if ("android.webkit.resource.AUDIO_CAPTURE".equals(resource)) list.add(Manifest.permission.RECORD_AUDIO);
            }
            if (list.isEmpty()) {
                request.grant(request.getResources());
                return;
            }
            Job job = new Job(list.toArray(new String[0])) {
                @Override
                void answer(boolean granted) {
                    if (granted) request.grant(request.getResources());
                    else request.deny();
                }
            };
            job.request = request;
            submit(job);
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            for (Job job : jobs) if (job.request == request) job.cancelled = true;
            super.onPermissionRequestCanceled(request);
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            Job job = new Job(new String[] { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }) {
                @Override
                void answer(boolean granted) {
                    callback.invoke(origin, granted, false);
                }
            };
            job.geolocation = true;
            submit(job);
        }

        // ---- File chooser (<input type=file>) ----
        // Capacitor's own chooser opens the camera only for inputs with a capture attribute, and otherwise opens the Files picker alone,
        // so an input with no capture never offered a photo (and the app never asked for the camera). This follows Chrome: an input that
        // accepts images (or has no accept list) offers the camera, an input that accepts video offers the camcorder, an input with
        // capture opens the camera directly, and every input can still pick files. If the camera is denied, the file picker still works.
        private final ActivityResultLauncher<Intent> chooserLauncher;
        private ValueCallback<Uri[]> chooserCallback = null;
        private Uri chooserPhoto = null;
        private File chooserPhotoFile = null;

        private void deliver(ValueCallback<Uri[]> cb, Uri[] result) {
            if (cb == null) return;
            if (chooserCallback == cb) chooserCallback = null;
            try {
                cb.onReceiveValue(result);
            } catch (RuntimeException ignored) {
            }
        }

        private List<String> mimeTypes(String[] accept) {
            List<String> out = new ArrayList<>();
            for (String a : accept) {
                if (a == null) continue;
                String t = a.trim().toLowerCase(Locale.ROOT);
                if (t.isEmpty()) continue;
                if (t.startsWith(".")) {
                    String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(t.substring(1));
                    if (m == null) continue;
                    t = m;
                }
                if (!out.contains(t)) out.add(t);
            }
            return out;
        }

        private boolean accepts(List<String> types, String family) {
            if (types.isEmpty()) return true;
            for (String t : types) if (t.startsWith(family + "/") || "*/*".equals(t)) return true;
            return false;
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, WebChromeClient.FileChooserParams params) {
            if (chooserCallback != null) deliver(chooserCallback, null);
            chooserCallback = filePathCallback;
            List<String> types = mimeTypes(params.getAcceptTypes());
            boolean images = accepts(types, "image");
            boolean videos = accepts(types, "video");
            boolean capture = params.isCaptureEnabled();
            boolean directVideo = capture && !types.isEmpty() && accepts(types, "video") && !accepts(types, "image");
            boolean directPhoto = capture && !types.isEmpty() && !directVideo && images;
            boolean wantCamera = images || videos;
            if (!wantCamera) {
                showChooser(filePathCallback, params, false, false, false, false);
                return true;
            }
            boolean direct = directPhoto || directVideo;
            // The camera permission is checked on every tap, never remembered, so a change made in Android Settings (turned on, turned
            // off, or "only this time" that has ended) is picked up at once. When the camera is off the Job asks for it again; Android
            // answers at once with a denial when it will not show the prompt any more, and the file picker still opens either way.
            Job job = new Job(new String[] { Manifest.permission.CAMERA }) {
                @Override
                void answer(boolean granted) {
                    if (chooserCallback != filePathCallback) return;
                    showChooser(filePathCallback, params, granted, images && !directVideo, videos && !directPhoto, direct);
                }
            };
            submit(job);
            return true;
        }

        private void showChooser(ValueCallback<Uri[]> cb, WebChromeClient.FileChooserParams params, boolean camera, boolean photo, boolean video, boolean directOnly) {
            Intent pick = params.createIntent();
            if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            List<String> types = mimeTypes(params.getAcceptTypes());
            if (types.size() > 1) {
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
            } else if (types.size() == 1) {
                pick.setType(types.get(0));
            }
            List<Intent> cameras = new ArrayList<>();
            chooserPhoto = null;
            chooserPhotoFile = null;
            if (camera) {
                try {
                    if (photo) {
                        Intent shot = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        if (shot.resolveActivity(getPackageManager()) != null) {
                            File dir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                            File f = File.createTempFile("JPEG_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date()) + "_", ".jpg", dir);
                            chooserPhotoFile = f;
                            chooserPhoto = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", f);
                            shot.putExtra(MediaStore.EXTRA_OUTPUT, chooserPhoto);
                            shot.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            cameras.add(shot);
                        }
                    }
                    if (video) {
                        Intent clip = new Intent(MediaStore.ACTION_VIDEO_CAPTURE);
                        if (clip.resolveActivity(getPackageManager()) != null) cameras.add(clip);
                    }
                } catch (Exception e) {
                    android.util.Log.w("1HelmChooser", "camera options unavailable: " + e);
                    cameras.clear();
                    chooserPhoto = null;
                    chooserPhotoFile = null;
                }
            }
            Intent launch;
            if (directOnly && cameras.size() > 0) launch = cameras.get(0);
            else if (!cameras.isEmpty()) {
                launch = Intent.createChooser(pick, null);
                launch.putExtra(Intent.EXTRA_INITIAL_INTENTS, cameras.toArray(new Intent[0]));
            } else launch = pick;
            try {
                chooserLauncher.launch(launch);
            } catch (RuntimeException e) {
                deliver(cb, null);
            }
        }

        private void onChooserResult(ActivityResult result) {
            ValueCallback<Uri[]> cb = chooserCallback;
            Uri photo = chooserPhoto;
            File photoFile = chooserPhotoFile;
            chooserPhoto = null;
            chooserPhotoFile = null;
            if (cb == null) return;
            Intent data = result.getData();
            if (result.getResultCode() != Activity.RESULT_OK) {
                deliver(cb, null);
                return;
            }
            boolean noPick = data == null || (data.getData() == null && data.getClipData() == null);
            if (noPick && photo != null && photoFile != null && photoFile.length() > 0) {
                deliver(cb, new Uri[] { photo });
                return;
            }
            if (data != null && data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                Uri[] out = new Uri[n];
                for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
                deliver(cb, out);
                return;
            }
            deliver(cb, WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), data));
        }

        private void submit(Job job) {
            jobs.add(job);
            permissionGate(() -> start(job));
        }

        private boolean start(Job job) {
            if (job.cancelled) {
                jobs.remove(job);
                return false;
            }
            String[] todo = missing(job.needed);
            // Location is granted when either fine or approximate is granted.
            if (todo.length == 0 || (job.geolocation && todo.length < job.needed.length)) {
                jobs.remove(job);
                job.finish(true);
                return false;
            }
            current = job;
            try {
                launcher.launch(todo);
            } catch (RuntimeException e) {
                current = null;
                jobs.remove(job);
                job.finish(false);
                return false;
            }
            return true;
        }

        private void onResult(Map<String, Boolean> results) {
            Job job = current;
            current = null;
            if (job == null) return;
            jobs.remove(job);
            boolean granted = job.geolocation
                ? has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION)
                : missing(job.needed).length == 0;
            job.finish(granted);
        }
    }
}
