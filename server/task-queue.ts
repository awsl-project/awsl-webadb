export function createTaskQueue() {
  const pending = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, work: () => Promise<T>): Promise<T> {
      const next = (pending.get(key) ?? Promise.resolve()).then(work);
      const settled = next.then(
        () => undefined,
        () => undefined,
      );
      pending.set(key, settled);
      void settled.then(() => {
        if (pending.get(key) === settled) pending.delete(key);
      });
      return next;
    },
    async drain(key: string) {
      while (pending.has(key)) await pending.get(key);
    },
  };
}
