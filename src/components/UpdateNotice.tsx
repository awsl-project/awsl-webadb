import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";

export function UpdateNotice() {
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let mounted = true;
    let removeUpdateChecks = () => {};
    const updateWorker = registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        if (!mounted || !registration) return;
        const checkForUpdate = () => {
          if (document.visibilityState !== "visible" || !navigator.onLine) return;
          void registration.update().catch((error) => {
            console.warn("离线缓存更新检查失败", error);
          });
        };
        window.addEventListener("focus", checkForUpdate);
        document.addEventListener("visibilitychange", checkForUpdate);
        const timer = window.setInterval(checkForUpdate, 5 * 60 * 1000);
        removeUpdateChecks = () => {
          window.removeEventListener("focus", checkForUpdate);
          document.removeEventListener("visibilitychange", checkForUpdate);
          window.clearInterval(timer);
        };
        checkForUpdate();
      },
      onNeedRefresh() {
        if (mounted) setUpdate(() => () => updateWorker(true));
      },
      onRegisterError(error) {
        console.warn("离线缓存注册失败", error);
      },
    });
    return () => {
      mounted = false;
      removeUpdateChecks();
    };
  }, []);
  if (!update) return null;
  return (
    <aside className="update-notice" role="status">
      <span>新版本已就绪</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void update();
        }}
        type="button"
      >
        刷新更新
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="ghost-button"
        onClick={() => setUpdate(null)}
        type="button"
      >
        稍后
      </Button>
    </aside>
  );
}
