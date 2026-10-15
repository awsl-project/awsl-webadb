import { useEffect, useState } from "react";
import { formatError } from "../utils";
import {
  CAMERA_HEIGHT,
  CAMERA_WIDTH,
  type CameraState,
} from "../../shared/sessions";

interface Props {
  running: boolean;
  enabled: boolean;
  camera?: CameraState;
  pending: boolean;
  onStartFile: (file: File, kind: "image" | "video") => Promise<void>;
  onStartUrl: (url: string, kind: "image" | "video" | "stream") => Promise<void>;
  onStop: () => Promise<void>;
  onPause: (paused: boolean) => Promise<void>;
}

export function FileCameraPanel({
  running,
  enabled,
  camera,
  pending,
  onStartFile,
  onStartUrl,
  onStop,
  onPause,
}: Props) {
  const [kind, setKind] = useState<"image" | "video" | "url">("image");
  const [source, setSource] = useState<{
    file: File;
    url: string;
    kind: "image" | "video";
  } | null>(null);
  const [urlKind, setUrlKind] = useState<"" | "image" | "video" | "stream">("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source.url);
    },
    [source],
  );
  const run = async (operation: () => Promise<void>) => {
    setError("");
    try {
      await operation();
    } catch (error) {
      setError(formatError(error));
    }
  };
  const preview = enabled && camera?.lastFrameAt;
  const canStart =
    running &&
    !pending &&
    (kind === "url" ? Boolean(url.trim() && urlKind) : source?.kind === kind);
  return (
    <section className="file-camera-panel" aria-label="系统摄像头来源">
      <div className="camera-source-tabs" role="group" aria-label="推流来源">
        {(
          [
            ["image", "图片"],
            ["video", "视频"],
            ["url", "媒体链接"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={kind === value}
            disabled={pending}
            onClick={() => {
              setKind(value);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="camera-output-spec">
        <span>竖屏摄像头</span>
        <strong>
          {CAMERA_WIDTH} × {CAMERA_HEIGHT}
        </strong>
        <span>3:4 · 等比补黑</span>
      </div>
      <div className="file-camera-preview">
        {preview ? (
          <img
            src={`/api/system-camera/frame?transportId=${camera.transportId}&t=${camera.lastFrameAt}`}
            alt="后台实际推流画面"
          />
        ) : source && source.kind === kind ? (
          source.kind === "image" ? (
            <img src={source.url} alt="待推流图片" />
          ) : (
            <video
              src={source.url}
              muted
              playsInline
              controls
              preload="metadata"
            />
          )
        ) : (
          <div className="camera-preview-empty">
            <span className="material-symbols-rounded" aria-hidden="true">
              add_photo_alternate
            </span>
            <span>
              {kind === "url"
                ? "输入媒体直链或视频流地址"
                : `选择${kind === "image" ? "图片" : "视频"}`}
            </span>
            <small>手动开始 · 后台持续运行</small>
          </div>
        )}
        <span
          className={`camera-stream-status ${enabled ? "live" : ""}`}
          role="status"
        >
          {pending
            ? "正在准备来源…"
            : enabled
              ? `${camera?.paused ? "已暂停" : "后台推流中"} · ${camera?.frames || 0} 帧`
              : "未推流"}
        </span>
      </div>
      {enabled ? (
        <p className="camera-active-source" title={camera?.sourceName}>
          当前来源：{camera?.sourceName}
        </p>
      ) : null}
      {kind === "url" ? (
        <div className="camera-url-fields">
          <label className="camera-url-field">
            <span>链接类型</span>
            <select
              aria-label="链接类型"
              required
              value={urlKind}
              disabled={pending}
              onChange={(event) =>
                setUrlKind(event.currentTarget.value as typeof urlKind)
              }
            >
              <option value="" disabled>
                请选择链接类型
              </option>
              <option value="image">图片直链 · 持续静止画面</option>
              <option value="video">视频直链 · 循环播放</option>
              <option value="stream">实时视频流 · HLS / RTSP / RTMP</option>
            </select>
          </label>
          <label className="camera-url-field">
            <span>图片、视频或直播流直链</span>
            <input
              aria-label="媒体或视频流链接"
              type="url"
              placeholder="https://…/live.m3u8 或 rtsp://…"
              value={url}
              disabled={pending}
              onChange={(event) => setUrl(event.currentTarget.value)}
            />
            <small>
              支持图片直链、视频直链、HLS / RTSP / RTMP 流；不支持普通网页地址
            </small>
          </label>
        </div>
      ) : (
        <div className="file-camera-selection">
          <label className={`file-camera-picker ${pending ? "disabled" : ""}`}>
            <span className="material-symbols-rounded" aria-hidden="true">
              folder_open
            </span>
            <span>选择{kind === "image" ? "图片" : "视频"}</span>
            <input
              aria-label={
                kind === "image" ? "摄像头图片文件" : "摄像头视频文件"
              }
              type="file"
              accept={kind === "image" ? "image/*" : "video/*"}
              disabled={pending}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                event.currentTarget.value = "";
                setError("");
                if (
                  !file.size ||
                  file.size > (kind === "image" ? 20 : 1024) * 1024 * 1024
                ) {
                  setError(
                    kind === "image"
                      ? "请选择 20 MB 以内的图片"
                      : "请选择 1 GB 以内的视频",
                  );
                  return;
                }
                setSource({ file, url: URL.createObjectURL(file), kind });
              }}
            />
          </label>
          <span
            className="file-camera-name"
            title={source?.kind === kind ? source.file.name : ""}
          >
            {source?.kind === kind ? source.file.name : "尚未选择文件"}
          </span>
        </div>
      )}
      <div className="file-camera-actions">
        <button
          className="camera-start"
          type="button"
          disabled={!canStart}
          onClick={() =>
            void run(() =>
              kind === "url"
                ? onStartUrl(
                    url.trim(),
                    urlKind as "image" | "video" | "stream",
                  )
                : onStartFile(source!.file, kind),
            )
          }
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            play_arrow
          </span>
          {enabled ? "切换并推流" : "开始推流"}
        </button>
        {enabled ? (
          <button
            type="button"
            disabled={pending || camera?.managedBy !== "server"}
            onClick={() => void run(() => onPause(!camera?.paused))}
          >
            {camera?.paused ? "继续" : "暂停"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={!enabled || pending}
          onClick={() => void run(onStop)}
        >
          停止推流
        </button>
      </div>
      {error || camera?.error ? (
        <div className="inline-error" role="alert">
          {error || camera?.error}
        </div>
      ) : null}
      <p className="camera-help">
        来源由后端持有，关闭网页或终端后继续。图片持续供帧，视频循环播放，直播读取最新画面；只推送画面，无音频。
      </p>
    </section>
  );
}
