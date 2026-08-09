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
