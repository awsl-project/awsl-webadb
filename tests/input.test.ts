import { expect, test } from "bun:test";
import { videoPoint, wheelScroll } from "../src/lib/android-input";

test("letterboxed coordinates map to the device frame", () => {
  const rect = { left: 10, top: 20, width: 400, height: 400 };
  const viewport = { width: 100, height: 200 };
  expect(videoPoint(210, 220, rect, viewport)).toEqual({
    pointerX: 50,
    pointerY: 100,
    videoWidth: 100,
    videoHeight: 200,
  });
  expect(videoPoint(10, 20, rect, viewport)?.pointerX).toBe(0);
  expect(videoPoint(410, 420, rect, viewport)).toMatchObject({
    pointerX: 99,
    pointerY: 199,
  });
});
test("hidden canvases never produce invalid device coordinates", () => {
  expect(
    videoPoint(
      1,
      1,
      { left: 0, top: 0, width: 0, height: 0 },
      { width: 1080, height: 1920 },
    ),
  ).toBeNull();
});
test("pixel, line and page scrolling stays within protocol bounds", () => {
  expect(wheelScroll({ deltaX: 25, deltaY: 50, deltaMode: 0 })).toEqual({
    scrollX: -0.25,
    scrollY: -0.5,
    buttons: 0,
  });
  expect(wheelScroll({ deltaX: 0, deltaY: -2, deltaMode: 1 }).scrollY).toBe(
    0.64,
  );
  expect(wheelScroll({ deltaX: 0, deltaY: 1, deltaMode: 2 }).scrollY).toBe(-1);
});
