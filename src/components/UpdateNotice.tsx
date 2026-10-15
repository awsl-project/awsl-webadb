import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";

export function UpdateNotice() {
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let mounted = true;
    const updateWorker = registerSW({
      immediate: true,
      onNeedRefresh() {
        if (mounted) setUpdate(() => () => updateWorker(true));
      },
      onRegisterError(error) {
        console.warn("离线缓存注册失败", error);
      },
    });
    return () => {
      mounted = false;
    };
  }, []);
  if (!update) return null;
  return (
    <aside className="update-notice" role="status">
      <span>新版本已就绪</span>
      <button
        onClick={() => {
          void update();
        }}
        type="button"
      >
        刷新更新
      </button>
      <button
        className="ghost-button"
        onClick={() => setUpdate(null)}
        type="button"
      >
        稍后
      </button>
    </aside>
  );
}
