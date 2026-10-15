package com.webadb.camera;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Looper;
import org.json.JSONObject;

public final class Probe {
    static Context context() throws Exception {
        if (Looper.getMainLooper() == null) Looper.prepareMainLooper();
        Class<?> threadClass = Class.forName("android.app.ActivityThread");
        Object thread = threadClass.getMethod("systemMain").invoke(null);
        Context system = (Context) threadClass.getMethod("getSystemContext").invoke(thread);
        Context shell = system.createPackageContext("com.android.shell", 0);
        java.lang.reflect.Field opPackage = shell.getClass().getDeclaredField("mOpPackageName");
        opPackage.setAccessible(true);
        opPackage.set(shell, "com.android.shell");
        java.lang.reflect.Field attribution = shell.getClass().getDeclaredField("mAttributionSource");
        attribution.setAccessible(true);
        attribution.set(shell, new android.content.AttributionSource.Builder(android.os.Process.myUid())
                .setPackageName("com.android.shell").build());
        android.app.Application application = new android.app.Application();
        java.lang.reflect.Method attach = android.app.Application.class.getDeclaredMethod("attach", Context.class);
        attach.setAccessible(true);
        attach.invoke(application, shell);
        java.lang.reflect.Field packageInfo = shell.getClass().getDeclaredField("mPackageInfo");
        packageInfo.setAccessible(true);
        Object loadedPackage = packageInfo.get(shell);
        java.lang.reflect.Field app = loadedPackage.getClass().getDeclaredField("mApplication");
        app.setAccessible(true);
        app.set(loadedPackage, application);
        return shell;
    }

    static boolean service(String name) throws Exception {
        return Class.forName("android.os.ServiceManager")
                .getMethod("checkService", String.class).invoke(null, name) != null;
    }

    static JSONObject inspect(Context context) throws Exception {
        JSONObject result = new JSONObject();
        result.put("sdk", Build.VERSION.SDK_INT);
        result.put("packageName", context.getPackageName());
        result.put("opPackageName", context.getOpPackageName());
        result.put("virtualDeviceService", service("virtualdevice"));
        result.put("virtualCameraService", service("virtual_camera"));
        result.put("createVirtualDevicePermission", context.checkPermission(
                "android.permission.CREATE_VIRTUAL_DEVICE", android.os.Process.myPid(),
                android.os.Process.myUid()) == PackageManager.PERMISSION_GRANTED);
        boolean api;
        try {
            Class.forName("android.companion.virtual.camera.VirtualCameraConfig");
            Class.forName("android.companion.virtual.VirtualDeviceManager$VirtualDevice")
                    .getMethod("createVirtualCamera", Class.forName(
                            "android.companion.virtual.camera.VirtualCameraConfig"));
            api = true;
        } catch (ReflectiveOperationException | LinkageError ignored) {
            api = false;
        }
        result.put("virtualCameraApi", api);
        return result;
    }

    public static void main(String[] args) throws Exception {
        try {
            System.out.println("WEBADB_CAMERA " + inspect(context()));
        } catch (Throwable error) {
            System.out.println("WEBADB_CAMERA " + new JSONObject().put("error", error.toString()));
        }
        System.exit(0);
    }
}
