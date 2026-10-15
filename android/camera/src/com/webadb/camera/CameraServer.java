package com.webadb.camera;

import android.companion.AssociationInfo;
import android.companion.CompanionDeviceManager;
import android.companion.virtual.VirtualDeviceManager;
import android.companion.virtual.VirtualDeviceParams;
import android.companion.virtual.camera.VirtualCamera;
import android.companion.virtual.camera.VirtualCameraCallback;
import android.companion.virtual.camera.VirtualCameraConfig;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.hardware.camera2.CameraMetadata;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.view.Surface;
import java.io.DataInputStream;
import java.io.EOFException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

public final class CameraServer implements AutoCloseable {
    private static final int MAX_FRAME = 2 * 1024 * 1024;
    private final Context context;
    private final Map<String, Surface> surfaces = new HashMap<>();
    private final Map<Integer, android.hardware.input.VirtualTouchscreen> touchscreens = new HashMap<>();
    private final Map<Integer, VirtualDisplay> displays = new HashMap<>();
    private final Map<Integer, android.media.ImageReader> displayReaders = new HashMap<>();
    private final Map<android.media.ImageReader, Bitmap> displayFrames = new HashMap<>();
    private final Map<android.media.ImageReader, Long> displayTimes = new HashMap<>();
    private final android.os.HandlerThread displayThread = new android.os.HandlerThread("webadb-display");
    private final Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG);
    private Bitmap frame;
    private final Automation automation = new Automation();
    private final java.util.Set<String> cameraPermissions = new java.util.HashSet<>();
    private VirtualDeviceManager.VirtualDevice device;
    private VirtualDisplay display;
    private VirtualCamera front;
    private VirtualCamera back;
    private String associationMac;
    private final java.util.concurrent.atomic.AtomicBoolean closed = new java.util.concurrent.atomic.AtomicBoolean();

    private CameraServer(Context context) { this.context = context; displayThread.start(); }

    private static void command(String... args) throws Exception {
        Process process = new ProcessBuilder(args).redirectErrorStream(true).start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (process.waitFor() != 0) throw new IllegalStateException(output.trim());
    }

    private JSONObject start(int width, int height, boolean withCamera) throws Exception {
        JSONObject capabilities = Probe.inspect(context);
        if ((withCamera && !capabilities.optBoolean("virtualCameraApi"))
                || !capabilities.optBoolean("createVirtualDevicePermission")) {
            throw new UnsupportedOperationException("系统缺少虚拟摄像头接口或创建权限");
        }
        byte[] random = new byte[5];
        new java.security.SecureRandom().nextBytes(random);
        associationMac = String.format("02:%02X:%02X:%02X:%02X:%02X",
                random[0], random[1], random[2], random[3], random[4]);
        System.out.println("WEBADB_CAMERA_ASSOCIATION " + associationMac);
        command("cmd", "companiondevice", "associate", "0", "com.android.shell", associationMac,
                "android.app.role.COMPANION_DEVICE_APP_STREAMING", "true");
        CompanionDeviceManager companions = context.getSystemService(CompanionDeviceManager.class);
        int associationId = -1;
        for (int attempt = 0; attempt < 50 && associationId < 0; attempt++) {
            for (AssociationInfo association : companions.getMyAssociations()) {
                if (association.getDeviceMacAddress() != null
                        && associationMac.equalsIgnoreCase(association.getDeviceMacAddress().toString())) {
                    associationId = association.getId();
                    break;
                }
            }
            if (associationId < 0) Thread.sleep(100);
        }
        if (associationId < 0) throw new IllegalStateException("未能创建本次摄像头会话的伴生关联");
        VirtualDeviceParams.Builder builder = new VirtualDeviceParams.Builder()
                .setName("WebADB File Camera")
                .setLockState(VirtualDeviceParams.LOCK_STATE_ALWAYS_UNLOCKED);
        builder.setDevicePolicy(VirtualDeviceParams.POLICY_TYPE_CAMERA,
                VirtualDeviceParams.DEVICE_POLICY_CUSTOM);
        device = context.getSystemService(VirtualDeviceManager.class)
                .createVirtualDevice(associationId, builder.build());
        if (withCamera) {
            back = createCamera("WebADB back", CameraMetadata.LENS_FACING_BACK);
            front = createCamera("WebADB front", CameraMetadata.LENS_FACING_FRONT);
        }
        display = createDisplay(width, height);
        device.wakeUp();
        return new JSONObject().put("type", "ready")
                .put("associationMac", associationMac)
                .put("displayId", display.getDisplay().getDisplayId())
                .put("backCameraId", back == null ? JSONObject.NULL : back.getId())
                .put("frontCameraId", front == null ? JSONObject.NULL : front.getId());
    }

    private VirtualDisplay createDisplay(int width, int height) {
        if (width < 320 || height < 320 || width > 2560 || height > 2560)
            throw new IllegalArgumentException("应用显示尺寸无效");
        int flags = DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC
                | DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
                | DisplayManager.VIRTUAL_DISPLAY_FLAG_TRUSTED
                | DisplayManager.VIRTUAL_DISPLAY_FLAG_SUPPORTS_TOUCH
                | DisplayManager.VIRTUAL_DISPLAY_FLAG_DESTROY_CONTENT_ON_REMOVAL;
        android.media.ImageReader reader = createReader(width, height);
        VirtualDisplay result;
        try {
            result = device.createVirtualDisplay(width, height, 320, reader.getSurface(), flags, Runnable::run, null);
            if (result == null) throw new IllegalStateException("创建应用显示失败");
        } catch (RuntimeException error) { reader.close(); throw error; }
        int id = result.getDisplay().getDisplayId();
        try {
            touchscreens.put(id, device.createVirtualTouchscreen(new android.hardware.input.VirtualTouchscreenConfig.Builder(width, height)
                    .setInputDeviceName("webadb-touch-" + id).setAssociatedDisplayId(id).build()));
        } catch (RuntimeException error) { result.release(); reader.close(); throw error; }
        displays.put(result.getDisplay().getDisplayId(), result);
        displayReaders.put(result.getDisplay().getDisplayId(), reader);
        return result;
    }

    private android.media.ImageReader createReader(int width, int height) {
        android.media.ImageReader reader = android.media.ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        reader.setOnImageAvailableListener(source -> {
            try (android.media.Image image = source.acquireLatestImage()) {
                if (image == null) return;
                synchronized (displayFrames) {
                    long now = android.os.SystemClock.elapsedRealtime();
                    if (now - displayTimes.getOrDefault(source, 0L) < 100) return;
                    displayTimes.put(source, now);
                    android.media.Image.Plane plane = image.getPlanes()[0];
                    int paddedWidth = plane.getRowStride() / plane.getPixelStride();
                    Bitmap pixels = Bitmap.createBitmap(paddedWidth, image.getHeight(), Bitmap.Config.ARGB_8888);
                    pixels.copyPixelsFromBuffer(plane.getBuffer());
                    Bitmap cropped = Bitmap.createBitmap(pixels, 0, 0, image.getWidth(), image.getHeight());
                    Bitmap scaled = cropped;
                    Bitmap old = displayFrames.put(source, scaled);
                    if (old != null) old.recycle();
                    if (pixels != scaled) pixels.recycle();
                    if (cropped != pixels && cropped != scaled) cropped.recycle();
                }
            } catch (IllegalStateException ignored) {}
        }, new android.os.Handler(displayThread.getLooper()));
        return reader;
    }

    private void discardReader(android.media.ImageReader reader) {
        if (reader == null) return;
        reader.close();
        synchronized (displayFrames) {
            Bitmap bitmap = displayFrames.remove(reader);
            if (bitmap != null) bitmap.recycle();
            displayTimes.remove(reader);
        }
    }

    private void resizeDisplay(int id, int width, int height) {
        if (width < 320 || height < 320 || width > 2560 || height > 2560)
            throw new IllegalArgumentException("应用显示尺寸无效");
        VirtualDisplay target = displays.get(id);
        android.media.ImageReader previous = displayReaders.get(id);
        if (target == null || previous == null) throw new IllegalArgumentException("应用显示已关闭");
        android.media.ImageReader replacement = createReader(width, height);
        android.hardware.input.VirtualTouchscreen oldTouch = touchscreens.remove(id);
        if (oldTouch != null) oldTouch.close();
        try {
            target.resize(width, height, 320);
            target.setSurface(replacement.getSurface());
            touchscreens.put(id, device.createVirtualTouchscreen(new android.hardware.input.VirtualTouchscreenConfig.Builder(width, height)
                    .setInputDeviceName("webadb-touch-" + id).setAssociatedDisplayId(id).build()));
            displayReaders.put(id, replacement);
            discardReader(previous);
        } catch (RuntimeException error) {
            target.resize(previous.getWidth(), previous.getHeight(), 320);
            target.setSurface(previous.getSurface());
            discardReader(replacement);
            touchscreens.put(id, device.createVirtualTouchscreen(new android.hardware.input.VirtualTouchscreenConfig.Builder(previous.getWidth(), previous.getHeight())
                    .setInputDeviceName("webadb-touch-" + id).setAssociatedDisplayId(id).build()));
            throw error;
        }
    }

    private VirtualCamera createCamera(String name, int facing) {
        return device.createVirtualCamera(new VirtualCameraConfig.Builder(name)
                .addStreamConfig(960, 1280, PixelFormat.RGBA_8888, 30)
                .setSensorOrientation(0).setLensFacing(facing)
                .setVirtualCameraCallback(Runnable::run, new CameraStreams(name)).build());
    }

    private final class CameraStreams implements VirtualCameraCallback {
        private final String name;
        CameraStreams(String name) { this.name = name; }
        private String key(int id) { return name + ":" + id; }

        @Override public void onStreamConfigured(int id, Surface surface, int width, int height, int format) {
            synchronized (CameraServer.this) {
                Surface old = surfaces.put(key(id), surface);
                if (old != null) old.release();
                draw(surface);
            }
        }
        @Override public void onProcessCaptureRequest(int id, long frameId) {
            synchronized (CameraServer.this) {
                Surface surface = surfaces.get(key(id));
                if (surface != null) draw(surface);
            }
        }
        @Override public void onStreamClosed(int id) {
            synchronized (CameraServer.this) {
                Surface surface = surfaces.remove(key(id));
                if (surface != null) surface.release();
            }
        }
    }

    private void draw(Surface surface) {
        if (!surface.isValid()) return;
        Canvas canvas = null;
        try {
            canvas = surface.lockCanvas(null);
            canvas.drawColor(Color.BLACK);
            if (frame != null) {
                float scale = Math.min((float) canvas.getWidth() / frame.getWidth(),
                        (float) canvas.getHeight() / frame.getHeight());
                float width = frame.getWidth() * scale;
                float height = frame.getHeight() * scale;
                float x = (canvas.getWidth() - width) / 2;
                float y = (canvas.getHeight() - height) / 2;
                canvas.drawBitmap(frame, null, new RectF(x, y, x + width, y + height), paint);
            }
        } catch (RuntimeException error) {
            System.err.println("Camera render: " + error);
        } finally {
            if (canvas != null) {
                try { surface.unlockCanvasAndPost(canvas); } catch (RuntimeException ignored) {}
            }
        }
    }

    private synchronized void acceptFrame(byte[] bytes) {
        Bitmap replacement = null;
        if (bytes.length != 0) {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth != 960 || bounds.outHeight != 1280) {
                throw new IllegalArgumentException("输入帧必须为 960 × 1280");
            }
            replacement = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (replacement == null) throw new IllegalArgumentException("无法解码输入帧");
        }
        Bitmap previous = frame;
        frame = replacement;
        if (previous != null) previous.recycle();
        for (Surface surface : surfaces.values()) draw(surface);
    }

    private static void send(OutputStream output, JSONObject event) throws Exception {
        output.write((event.toString() + "\n").getBytes(StandardCharsets.UTF_8));
        output.flush();
    }

    private void serve(LocalSocket socket, int width, int height, boolean withCamera) throws Exception {
        socket.setSoTimeout(15_000);
        OutputStream output = socket.getOutputStream();
        try {
            Thread deadline = new Thread(() -> {
                try {
                    Thread.sleep(12_000);
                    send(output, new JSONObject().put("type", "error").put("message", "系统虚拟设备或摄像头服务没有响应"));
                    close();
                    System.exit(1);
                } catch (InterruptedException done) {
                } catch (Exception error) { System.exit(1); }
            });
            deadline.setDaemon(true);
            deadline.start();
            try { send(output, start(width, height, withCamera)); }
            finally { deadline.interrupt(); }
            DataInputStream input = new DataInputStream(socket.getInputStream());
            long frames = 0;
            while (true) {
                int length;
                try { length = input.readInt(); } catch (EOFException done) { return; }
                if (length == -1) {
                    int commandLength = input.readInt();
                    if (commandLength < 1 || commandLength > 24576) throw new IllegalArgumentException("无效的显示命令");
                    byte[] commandBytes = new byte[commandLength];
                    input.readFully(commandBytes);
                    try {
                    JSONObject request = new JSONObject(new String(commandBytes, StandardCharsets.UTF_8));
                    if (request.getString("type").equals("createDisplay")) {
                        VirtualDisplay created = createDisplay(request.getInt("width"), request.getInt("height"));
                        device.wakeUp();
                        send(output, new JSONObject().put("type", "display").put("displayId", created.getDisplay().getDisplayId()));
                    } else if (request.getString("type").equals("resizeDisplay")) {
                        resizeDisplay(request.getInt("displayId"), request.getInt("width"), request.getInt("height"));
                        send(output, new JSONObject().put("type", "resized"));
                    } else if (request.getString("type").equals("touch")) {
                        android.hardware.input.VirtualTouchscreen touchscreen = touchscreens.get(request.getInt("displayId"));
                        if (touchscreen == null) throw new IllegalArgumentException("应用触控已关闭");
                        touchscreen.sendTouchEvent(new android.hardware.input.VirtualTouchEvent.Builder()
                                .setPointerId(0).setToolType(android.hardware.input.VirtualTouchEvent.TOOL_TYPE_FINGER)
                                .setAction(request.getInt("action")).setX((float) request.getDouble("x"))
                                .setY((float) request.getDouble("y")).setPressure(request.getInt("action") == 1 ? 0 : 1).build());
                        send(output, new JSONObject().put("type", "touch"));
                    } else if (request.getString("type").equals("displayFrame")) {
                        android.media.ImageReader reader = displayReaders.get(request.getInt("displayId"));
                        if (reader == null) throw new IllegalArgumentException("应用显示已关闭");
                        String encoded = "";
                        synchronized (displayFrames) {
                            Bitmap bitmap = displayFrames.get(reader);
                            if (bitmap != null) {
                                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                                Bitmap outputBitmap = bitmap;
                                if (!request.optBoolean("native") && bitmap.getWidth() > 720) {
                                    outputBitmap = Bitmap.createScaledBitmap(bitmap, 720,
                                            bitmap.getHeight() * 720 / bitmap.getWidth(), true);
                                }
                                outputBitmap.compress(Bitmap.CompressFormat.JPEG, 85, bytes);
                                if (outputBitmap != bitmap) outputBitmap.recycle();
                                encoded = android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP);
                            }
                        }
                        send(output, new JSONObject().put("type", "displayFrame").put("jpeg", encoded));
                    } else if (request.getString("type").equals("releaseDisplay")) {
                        android.hardware.input.VirtualTouchscreen touchscreen = touchscreens.remove(request.getInt("displayId"));
                        if (touchscreen != null) touchscreen.close();
                        VirtualDisplay removed = displays.remove(request.getInt("displayId"));
                        if (removed != null) removed.release();
                        android.media.ImageReader removedReader = displayReaders.remove(request.getInt("displayId"));
                        if (removedReader != null) {
                            removedReader.close();
                            synchronized (displayFrames) {
                                Bitmap old = displayFrames.remove(removedReader);
                                if (old != null) old.recycle();
                                displayTimes.remove(removedReader);
                            }
                        }
                        send(output, new JSONObject().put("type", "released"));
                    } else if (request.getString("type").equals("authorizeCamera")) {
                        String packageName = request.getString("packageName");
                        if (!packageName.equals("com.android.chrome") || back == null)
                            throw new IllegalArgumentException("仅支持验收 Chrome 的虚拟相机授权");
                        Context target = device.createContext();
                        if (target.getDeviceId() <= 0 || target.getDeviceId() != device.getDeviceId())
                            throw new IllegalStateException("拒绝修改主设备权限");
                        android.content.pm.PackageManager permissions = target.getPackageManager();
                        permissions.grantRuntimePermission(packageName, android.Manifest.permission.CAMERA, android.os.UserHandle.of(0));
                        cameraPermissions.add(packageName);
                        send(output, new JSONObject().put("type", "authorized").put("deviceId", device.getDeviceId()));
                    } else if (request.getString("type").equals("imePolicy")) {
                        android.view.WindowManagerGlobal.getWindowManagerService().setDisplayImePolicy(
                                request.getInt("displayId"), request.getBoolean("local")
                                        ? android.view.WindowManager.DISPLAY_IME_POLICY_LOCAL
                                        : android.view.WindowManager.DISPLAY_IME_POLICY_HIDE);
                        send(output, new JSONObject().put("type", "imePolicy"));
                    } else if (request.getString("type").equals("elements")) {
                        send(output, automation.read(request.getInt("displayId")));
                    } else if (request.getString("type").equals("clickElement") || request.getString("type").equals("setText") || request.getString("type").equals("insertText")) {
                        send(output, automation.act(request));
                    } else if (request.getString("type").equals("key")) {
                        send(output, automation.key(request.getInt("displayId"), request.getInt("keyCode"), request.optInt("metaState", 0)));
                    } else throw new IllegalArgumentException("未知的显示命令");
                    } catch (Exception error) {
                        send(output, new JSONObject().put("type", "error").put("message", error.toString()));
                    }
                    continue;
                }
                if (length < 0 || length > MAX_FRAME) throw new IllegalArgumentException("输入帧长度无效");
                byte[] bytes = new byte[length];
                input.readFully(bytes);
                if (withCamera && length > 0) { acceptFrame(bytes); frames++; }
                send(output, new JSONObject().put("type", "frame").put("frames", frames));
            }
        } catch (Throwable error) {
            error.printStackTrace();
            send(output, new JSONObject().put("type", "error").put("message", error.toString()));
        }
    }

    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        automation.close();
        if (device != null && device.getDeviceId() > 0) {
            for (String packageName : cameraPermissions) {
                try { device.createContext().getPackageManager().revokeRuntimePermission(packageName,
                        android.Manifest.permission.CAMERA, android.os.UserHandle.of(0)); }
                catch (RuntimeException ignored) {}
            }
        }
        cameraPermissions.clear();
        for (android.hardware.input.VirtualTouchscreen touchscreen : touchscreens.values()) {
            try { touchscreen.close(); } catch (RuntimeException ignored) {}
        }
        touchscreens.clear();
        for (VirtualDisplay current : displays.values()) {
            try { current.release(); } catch (RuntimeException ignored) {}
        }
        displays.clear();
        for (android.media.ImageReader reader : displayReaders.values()) reader.close();
        displayReaders.clear();
        displayThread.quitSafely();
        synchronized (displayFrames) {
            for (Bitmap bitmap : displayFrames.values()) bitmap.recycle();
            displayFrames.clear();
            displayTimes.clear();
        }
        if (front != null) { try { front.close(); } catch (RuntimeException ignored) {} }
        if (back != null) { try { back.close(); } catch (RuntimeException ignored) {} }
        if (device != null) { try { device.close(); } catch (RuntimeException ignored) {} }
        synchronized (this) {
            for (Surface surface : surfaces.values()) surface.release();
            surfaces.clear();
            if (frame != null) { frame.recycle(); frame = null; }
        }
        if (associationMac != null) {
            try { command("cmd", "companiondevice", "disassociate", "0", "com.android.shell", associationMac); }
            catch (Exception error) { System.err.println("Association cleanup: " + error); }
            associationMac = null;
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 4 || !args[0].matches("webadb-camera-[a-f0-9-]{36}")
                || !(args[3].equals("camera") || args[3].equals("display"))) {
            throw new IllegalArgumentException("无效的摄像头启动参数");
        }
        int width = Integer.parseInt(args[1]);
        int height = Integer.parseInt(args[2]);
        if (width < 320 || height < 320 || width > 2560 || height > 2560) {
            throw new IllegalArgumentException("应用显示尺寸无效");
        }
        try (LocalServerSocket listener = new LocalServerSocket(args[0]);
                CameraServer server = new CameraServer(Probe.context())) {
            Runtime.getRuntime().addShutdownHook(new Thread(server::close, "webadb-cleanup"));
            System.out.println("WEBADB_CAMERA_LISTENING");
            Thread watchdog = new Thread(() -> {
                try { Thread.sleep(20_000); listener.close(); } catch (Exception ignored) {}
            });
            watchdog.setDaemon(true);
            watchdog.start();
            try (LocalSocket socket = listener.accept()) { server.serve(socket, width, height, args[3].equals("camera")); }
        }
        System.exit(0);
    }
}
