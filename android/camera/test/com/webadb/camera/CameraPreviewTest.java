package com.webadb.camera;

import java.util.Arrays;

public final class CameraPreviewTest {
    private static void expect(int width, int height, int[] expected) {
        int[] actual = CameraServer.legacyPreviewSize(width, height);
        if (!Arrays.equals(actual, expected))
            throw new AssertionError(width + "x" + height + ": " + Arrays.toString(actual));
    }

    public static void main(String[] args) {
        expect(960, 1280, new int[] { 810, 1080 });
        expect(720, 1280, new int[] { 606, 1080 });
        expect(1280, 1280, new int[] { 1080, 1080 });
        expect(2, 1280, new int[] { 2, 1080 });
        expect(960, 1080, null);
        expect(1280, 960, null);
        expect(1280, 720, null);
        expect(640, 480, null);
        System.out.println("Camera1 preview compatibility: 8 cases passed");
    }
}
