import type { CameraAspect } from "./camera-formats";

export const CAMERA_WIDTH = 960;
export const CAMERA_HEIGHT = 1280;

export interface AppSessionState {
  id: string;
  transportId: string;
  packageName: string;
  userId: number;
  displayId: number;
  width: number;
  height: number;
  revision: number;
  focusedAt: number;
  minimized: boolean;
  nativeKeyboard: boolean;
  cameraTest: boolean;
}

export interface CameraState {
  aspect: CameraAspect;
  transportId: string;
  enabled: boolean;
  sourceName: string;
  sourceKind: "image" | "video" | "stream" | "";
  managedBy: "browser" | "server";
  paused: boolean;
  error: string;
  producerId: string;
  frames: number;
  lastFrameAt: number;
  width: number;
  height: number;
}

export interface SessionSnapshot {
  sessions: AppSessionState[];
  cameras: CameraState[];
}

export interface AppElement {
  id: string;
  parentId: string | null;
  text: string;
  resourceId: string;
  description: string;
  className: string;
  clickable: boolean;
  editable: boolean;
  enabled: boolean;
  visible: boolean;
  checked: boolean;
  bounds: [number, number, number, number];
}
