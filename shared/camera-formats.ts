export const CAMERA_FORMATS = [
  { value: "original", label: "原始比例", width: 0, height: 0 },
  { value: "3:4", label: "3:4 · 竖屏", width: 960, height: 1280 },
  { value: "4:3", label: "4:3 · 横屏", width: 1280, height: 960 },
  { value: "9:16", label: "9:16 · 竖屏", width: 720, height: 1280 },
  { value: "16:9", label: "16:9 · 横屏", width: 1280, height: 720 },
  { value: "1:1", label: "1:1 · 方形", width: 1280, height: 1280 },
] as const;

export type CameraAspect = (typeof CAMERA_FORMATS)[number]["value"];

export function cameraFormat(value: unknown = "original") {
  const format = CAMERA_FORMATS.find((item) => item.value === value);
  if (!format)
    throw new Error("比例应为 original、3:4、4:3、9:16、16:9 或 1:1");
  return format;
}
