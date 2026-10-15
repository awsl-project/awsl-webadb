package com.webadb.camera;

import android.app.UiAutomation;
import android.app.UiAutomationConnection;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.HandlerThread;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlSerializer;

final class Automation implements AutoCloseable {
    private boolean threadStarted;
    private final HandlerThread thread = new HandlerThread("webadb-accessibility");
    private UiAutomation automation;

    private UiAutomation service() throws Exception {
        if (automation != null) return automation;
        if (!threadStarted) { thread.start(); threadStarted = true; }
        UiAutomation client = new UiAutomation(thread.getLooper(), new UiAutomationConnection());
        client.connectWithTimeout(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES, 3000);
        AccessibilityServiceInfo info = client.getServiceInfo();
        info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
                | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
                | AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
        client.setServiceInfo(info);
        automation = client;
        Thread.sleep(200);
        return client;
    }

    private void collect(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> nodes, int depth) {
        if (node == null || depth > 50 || nodes.size() >= 2000) return;
        nodes.add(node);
        for (int index = 0; index < node.getChildCount(); index++) collect(node.getChild(index), nodes, depth + 1);
    }

    private List<AccessibilityNodeInfo> nodes(int displayId) throws Exception {
        List<AccessibilityNodeInfo> nodes = new ArrayList<>();
        UiAutomation client = service();
        try { client.waitForIdle(100, 1000); } catch (java.util.concurrent.TimeoutException ignored) {}
        List<AccessibilityWindowInfo> windows = client.getWindowsOnAllDisplays().get(displayId);
        if (windows != null) for (AccessibilityWindowInfo window : windows) collect(window.getRoot(), nodes, 0);
        return nodes;
    }

    JSONObject read(int displayId) throws Exception {
        List<AccessibilityNodeInfo> nodes = nodes(displayId);
        JSONArray elements = new JSONArray();
        StringWriter text = new StringWriter();
        XmlSerializer xml = android.util.Xml.newSerializer();
        xml.setOutput(text);
        xml.startDocument("UTF-8", true);
        xml.startTag(null, "hierarchy").attribute(null, "display-id", String.valueOf(displayId));
        for (int index = 0; index < nodes.size(); index++) {
            AccessibilityNodeInfo node = nodes.get(index);
            Rect bounds = new Rect();
            node.getBoundsInScreen(bounds);
            JSONObject element = new JSONObject().put("id", "e" + index)
                    .put("text", node.getText() == null ? "" : node.getText().toString())
                    .put("resourceId", node.getViewIdResourceName() == null ? "" : node.getViewIdResourceName())
                    .put("description", node.getContentDescription() == null ? "" : node.getContentDescription().toString())
                    .put("className", String.valueOf(node.getClassName()))
                    .put("packageName", String.valueOf(node.getPackageName()))
                    .put("clickable", node.isClickable()).put("editable", node.isEditable())
                    .put("enabled", node.isEnabled()).put("visible", node.isVisibleToUser()).put("checked", node.isChecked())
                    .put("bounds", new JSONArray(new int[]{bounds.left, bounds.top, bounds.right, bounds.bottom}));
            AccessibilityNodeInfo parent = node.getParent();
            int parentIndex = parent == null ? -1 : nodes.indexOf(parent);
            element.put("parentId", parentIndex < 0 ? JSONObject.NULL : "e" + parentIndex);
            elements.put(element);
            xml.startTag(null, "node");
            java.util.Iterator<String> keys = element.keys();
            while (keys.hasNext()) { String key = keys.next(); xml.attribute(null, key, String.valueOf(element.get(key))); }
            xml.endTag(null, "node");
        }
        xml.endTag(null, "hierarchy");
        xml.endDocument();
        return new JSONObject().put("type", "elements").put("xml", text.toString()).put("elements", elements);
    }

    JSONObject act(JSONObject request) throws Exception {
        int displayId = request.getInt("displayId");
        List<AccessibilityNodeInfo> matches = new ArrayList<>();
        List<AccessibilityNodeInfo> nodes = nodes(displayId);
        for (int index = 0; index < nodes.size(); index++) {
            AccessibilityNodeInfo node = nodes.get(index);
            if (!node.isVisibleToUser() || !node.isEnabled()) continue;
            boolean selected = request.has("nodeId") && request.getString("nodeId").equals("e" + index)
                    || request.has("text") && request.getString("text").contentEquals(node.getText() == null ? "" : node.getText())
                    || request.has("resourceId") && request.getString("resourceId").equals(node.getViewIdResourceName())
                    || request.has("description") && request.getString("description").contentEquals(node.getContentDescription() == null ? "" : node.getContentDescription());
            if (!request.has("nodeId") && !request.has("text") && !request.has("resourceId") && !request.has("description")) selected = node.isFocused() && node.isEditable();
            if (selected) matches.add(node);
        }
        if (matches.size() != 1) throw new IllegalArgumentException("元素定位需要唯一匹配，当前匹配 " + matches.size() + " 项");
        AccessibilityNodeInfo node = matches.get(0);
        boolean result;
        if (request.getString("type").equals("setText") || request.getString("type").equals("insertText")) {
            if (!node.isFocused()) node.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            Bundle args = new Bundle();
            String value = request.getString("value");
            if (request.getString("type").equals("insertText")) {
                String current = node.getText() == null ? "" : node.getText().toString();
                int start = node.getTextSelectionStart();
                int end = node.getTextSelectionEnd();
                if (start < 0 || end < start || end > current.length()) start = end = current.length();
                value = current.substring(0, start) + value + current.substring(end);
            }
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value);
            result = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        } else {
            while (!node.isClickable() && node.getParent() != null) node = node.getParent();
            result = node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
        if (!result) throw new IllegalStateException("应用没有执行此元素操作，可改用截图坐标操作");
        return new JSONObject().put("type", "action").put("ok", true);
    }

    JSONObject key(int displayId, int keyCode, int metaState) throws Exception {
        for (int action : new int[]{KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP}) {
            KeyEvent event = new KeyEvent(0, android.os.SystemClock.uptimeMillis(), action, keyCode, 0, metaState);
            event.setDisplayId(displayId);
            if (!service().injectInputEvent(event, true)) throw new IllegalStateException("按键注入失败");
        }
        return new JSONObject().put("type", "action").put("ok", true);
    }

    @Override public void close() {
        if (automation != null) { try { automation.disconnect(); } catch (RuntimeException ignored) {} }
        thread.quitSafely();
    }
}
