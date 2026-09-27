export function installShutdown(options: {
  closeAsync: () => Promise<void>;
  closeSync: () => void;
  timeoutMs?: number;
  exit?: (code: number) => void;
  report?: (error: unknown) => void;
}) {
  const exit = options.exit ?? ((code) => process.exit(code));
  const report = options.report ?? console.error;
  let cleaned = false;
  let stopping: Promise<void> | undefined;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    options.closeSync();
  };
  const stop = (code = 0): Promise<void> => {
    if (stopping) return stopping;
    stopping = Promise.resolve().then(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(options.closeAsync),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('退出清理超过10秒，强制释放本地资源')),
              options.timeoutMs ?? 10000,
            );
          }),
        ]);
      } catch (error) {
        code = 1;
        report(error);
      } finally {
        clearTimeout(timer);
        try {
          cleanup();
        } catch (error) {
          code = 1;
          report(error);
        }
        dispose();
        exit(code);
      }
    });
    return stopping;
  };
  const signal = () => {
    void stop();
  };
  const dispose = () => {
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
    process.removeListener('exit', cleanup);
  };
  process.on('SIGINT', signal);
  process.on('SIGTERM', signal);
  process.once('exit', cleanup);
  return { stop, dispose };
}
