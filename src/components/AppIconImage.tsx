import { cn } from "@/lib/utils";
import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface AppIconImageProps {
  src?: string;
  loading?: "eager" | "lazy";
}

export function AppIconImage({ src, loading = "eager" }: AppIconImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimerRef = useRef(0);

  useEffect(() => {
    window.clearTimeout(retryTimerRef.current);
    setAttempt(0);
    setFailed(false);
    return () => window.clearTimeout(retryTimerRef.current);
  }, [src]);

  if (!src || failed) {
    return null;
  }

  const separator = src.includes("?") ? "&" : "?";
  const retrySrc = attempt ? `${src}${separator}retry=${attempt}` : src;
  return (
    <img
      key={retrySrc}
      src={retrySrc}
      alt=""
      loading={loading}
      onError={() => {
        if (attempt >= 2) {
          setFailed(true);
          return;
        }
        retryTimerRef.current = window.setTimeout(
          () => setAttempt((current) => current + 1),
          700 * (attempt + 1),
        );
      }}
    />
  );
}

export function AppIcon({
  name,
  src,
  className,
  loading,
  userId = 0,
  running = false,
}: AppIconImageProps & {
  name: string;
  className?: string;
  userId?: number;
  running?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative inline-grid size-12 shrink-0 rounded-xl text-sm font-medium",
        className,
      )}
    >
      <span className="relative grid size-full place-items-center overflow-hidden rounded-[inherit] border border-border bg-muted [&>img]:absolute [&>img]:inset-0 [&>img]:size-full [&>img]:object-contain [&:has(img)>span]:invisible">
        <span>{name.trim().slice(0, 1)}</span>
        <AppIconImage src={src} loading={loading} />
      </span>
      {userId !== 0 && (
        <span
          className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-md bg-primary text-primary-foreground ring-2 ring-background"
          aria-label={`分身 · 用户 ${userId}`}
          title={`分身 · 用户 ${userId}`}
        >
          <Copy className="size-3" aria-hidden="true" />
        </span>
      )}
      {running && (
        <span
          className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-green-500 ring-2 ring-background"
          aria-label="运行中"
        />
      )}
    </span>
  );
}
