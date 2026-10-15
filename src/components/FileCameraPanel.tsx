import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Image,
  Info,
  Link,
  LoaderCircle,
  Pause,
  Play,
  Upload,
  Video,
} from "lucide-react";
import { formatError } from "../utils";
import {
  CAMERA_HEIGHT,
  CAMERA_WIDTH,
  type CameraState,
} from "../../shared/sessions";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

interface Props {
  running: boolean;
  enabled: boolean;
  camera?: CameraState;
  pending: boolean;
  onStartFile: (file: File, kind: "image" | "video") => Promise<void>;
  onStartUrl: (
    url: string,
    kind: "image" | "video" | "stream",
  ) => Promise<void>;
  onStop: () => Promise<void>;
  onPause: (paused: boolean) => Promise<void>;
}

type SourceKind = "image" | "video" | "url";
type MediaKind = "image" | "video" | "stream";
const sources = [
  { value: "image", label: "图片", icon: Image },
  { value: "video", label: "视频", icon: Video },
  { value: "url", label: "媒体链接", icon: Link },
] as const;

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
  const [kind, setKind] = useState<SourceKind>("image");
  const [source, setSource] = useState<{
    file: File;
    url: string;
    kind: "image" | "video";
  } | null>(null);
  const [urlKind, setUrlKind] = useState<"" | MediaKind>("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
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
  const selectedFile = source?.kind === kind ? source : null;
  const canStart =
    running &&
    !pending &&
    (kind === "url" ? Boolean(url.trim() && urlKind) : Boolean(selectedFile));
  const status = pending
    ? "正在准备来源"
    : enabled
      ? camera?.paused
        ? "已暂停"
        : "后台推流中"
      : "未推流";
  const currentType =
    camera?.sourceKind === "stream"
      ? "实时视频流"
      : camera?.sourceKind === "video"
        ? "循环视频"
        : "静态图片";
  const start = () => {
    if (!canStart) return;
    void run(() =>
      kind === "url"
        ? onStartUrl(url.trim(), urlKind as MediaKind)
        : onStartFile(selectedFile!.file, kind),
    );
  };
  return (
    <section
      className="file-camera-panel flex min-h-0 flex-1 flex-col"
      aria-label="系统摄像头来源"
    >
      <div className="camera-source-body grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto overscroll-contain p-5 min-[650px]:grid-cols-[minmax(0,1fr)_220px] min-[901px]:p-6">
        <div className="min-w-0 space-y-5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <strong className="font-medium">推流来源</strong>
            <span className="text-muted-foreground">选择后手动开始</span>
          </div>
          <Tabs
            value={kind}
            onValueChange={(value) => {
              setKind(value as SourceKind);
              setError("");
            }}
          >
            <TabsList className="w-full" aria-label="推流来源">
              {sources.map(({ value, label, icon: SourceIcon }) => (
                <TabsTrigger key={value} value={value} disabled={pending}>
                  <SourceIcon className="size-4" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={kind} className="mt-3">
              {kind === "url" ? (
                <div className="space-y-4">
                  <label className="grid gap-2 text-xs">
                    <span>
                      链接类型{" "}
                      <span className="text-muted-foreground">必选</span>
                    </span>
                    <NativeSelect
                      aria-label="链接类型"
                      className="h-11 text-base sm:text-sm"
                      required
                      value={urlKind}
                      disabled={pending}
                      onChange={(event) =>
                        setUrlKind(event.currentTarget.value as typeof urlKind)
                      }
                    >
                      <NativeSelectOption value="" disabled>
                        请选择链接类型
                      </NativeSelectOption>
                      <NativeSelectOption value="image">
                        图片直链 · 持续静止画面
                      </NativeSelectOption>
                      <NativeSelectOption value="video">
                        视频直链 · 循环播放
                      </NativeSelectOption>
                      <NativeSelectOption value="stream">
                        实时视频流 · HLS / RTSP / RTMP
                      </NativeSelectOption>
                    </NativeSelect>
                  </label>
                  <label className="grid gap-2 text-xs">
                    <span>媒体地址</span>
                    <Input
                      aria-label="媒体或视频流链接"
                      type="url"
                      className="h-11 text-base sm:text-sm"
                      placeholder={
                        urlKind === "image"
                          ? "https://…/image.jpg"
                          : urlKind === "video"
                            ? "https://…/video.mp4"
                            : "rtsp://… 或 https://…/live.m3u8"
                      }
                      value={url}
                      disabled={pending}
                      onChange={(event) => setUrl(event.currentTarget.value)}
                    />
                    <span className="leading-relaxed text-muted-foreground">
                      填写媒体直链，普通网页地址无法播放。
                    </span>
                  </label>
                </div>
              ) : (
                <>
                  <input
                    ref={inputRef}
                    aria-label={
                      kind === "image" ? "摄像头图片文件" : "摄像头视频文件"
                    }
                    className="sr-only"
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
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => inputRef.current?.click()}
                    className="h-auto min-h-36 w-full flex-col gap-3 border-dashed p-5 whitespace-normal"
                  >
                    <Upload className="size-6 text-primary" />
                    <span className="max-w-full text-center text-sm break-all">
                      {selectedFile
                        ? selectedFile.file.name
                        : `选择${kind === "image" ? "图片" : "视频"}文件`}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {selectedFile
                        ? `${(selectedFile.file.size / 1024 / 1024).toFixed(1)} MB · 点击更换`
                        : kind === "image"
                          ? "最大 20 MB · 持续供帧"
                          : "最大 1 GB · 循环播放"}
                    </span>
                  </Button>
                </>
              )}
            </TabsContent>
          </Tabs>
          <div className="flex items-center gap-3 border-y border-border py-4">
            <Camera className="size-5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <strong className="font-mono text-xs font-medium">
                {CAMERA_WIDTH} × {CAMERA_HEIGHT}
              </strong>
              <p className="m-0 text-xs leading-relaxed text-muted-foreground">
                竖屏 3:4 · 等比缩放补黑 · 无音频
              </p>
            </div>
          </div>
          {!running && (
            <p className="m-0 text-xs text-muted-foreground">
              连接设备后即可开始推流。
            </p>
          )}
          {enabled && (
            <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
              <p className="m-0 text-xs text-muted-foreground">
                当前输出 · {currentType}
              </p>
              <p
                className="m-0 truncate font-mono text-xs"
                title={camera?.sourceName}
              >
                {camera?.sourceName}
              </p>
            </div>
          )}
          {(error || camera?.error) && (
            <p
              className="m-0 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
              role="alert"
            >
              {error || camera?.error}
            </p>
          )}
        </div>
        <div className="mx-auto w-full max-w-[220px] space-y-3 self-start">
          <div className="flex items-center justify-between text-xs">
            <strong className="font-medium">
              {enabled ? "当前输出画面" : "画面预览"}
            </strong>
            <span className="font-mono text-muted-foreground">3:4</span>
          </div>
          <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border border-border bg-[#15181d]">
            {enabled && camera?.lastFrameAt ? (
              <img
                className="size-full object-contain"
                src={`/api/system-camera/frame?transportId=${camera.transportId}&t=${camera.lastFrameAt}`}
                alt="后台实际推流画面"
              />
            ) : selectedFile ? (
              selectedFile.kind === "image" ? (
                <img
                  className="size-full object-contain"
                  src={selectedFile.url}
                  alt="待推流图片"
                />
              ) : (
                <video
                  className="size-full object-contain"
                  src={selectedFile.url}
                  muted
                  playsInline
                  controls
                  preload="metadata"
                />
              )
            ) : (
              <div className="flex flex-col items-center gap-3 text-[#9da5b4]">
                {kind === "url" ? (
                  <Link className="size-6" />
                ) : (
                  <Image className="size-6" />
                )}
                <span className="text-xs">
                  {kind === "url" ? "开始后显示实际画面" : "选择文件后预览"}
                </span>
              </div>
            )}
          </div>
          <div
            className="camera-stream-status flex items-center justify-between gap-2 text-xs text-muted-foreground"
            data-state={enabled ? (camera?.paused ? "paused" : "live") : "idle"}
          >
            <Badge variant="secondary" className="gap-1.5" role="status">
              <span
                className={`size-1.5 rounded-full ${enabled ? (camera?.paused ? "bg-[var(--oh-amber)]" : "bg-[var(--oh-green)]") : "bg-muted-foreground"}`}
              />
              {status}
            </Badge>
            <span aria-hidden="true">
              {enabled ? `${camera?.frames || 0} 帧` : "等待开始"}
            </span>
          </div>
        </div>
      </div>
      <footer className="file-camera-actions flex shrink-0 items-center justify-end gap-2 border-t border-border bg-muted px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
        <span className="mr-auto hidden items-center gap-2 text-xs text-muted-foreground min-[700px]:flex">
          <Info className="size-4" />
          收起后继续推流
        </span>
        <Button
          disabled={!canStart}
          onClick={start}
          className="flex-[1.3] px-2 sm:flex-none sm:px-4"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {pending ? "准备中" : enabled ? "切换并推流" : "开始推流"}
        </Button>
        {enabled && (
          <Button
            variant="outline"
            className="flex-1 px-2 sm:flex-none sm:px-4"
            disabled={pending || camera?.managedBy !== "server"}
            onClick={() => void run(() => onPause(!camera?.paused))}
          >
            {camera?.paused ? (
              <Play className="size-4" />
            ) : (
              <Pause className="size-4" />
            )}
            {camera?.paused ? "继续" : "暂停"}
          </Button>
        )}
        <Button
          variant="outline"
          className="flex-1 px-2 text-destructive hover:text-destructive sm:flex-none sm:px-4"
          disabled={!enabled || pending}
          onClick={() => void run(onStop)}
        >
          停止推流
        </Button>
      </footer>
    </section>
  );
}
