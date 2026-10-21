export interface AppQuitDrainStep {
  begin?: () => void;
  shouldWait: () => boolean;
  wait: () => Promise<void>;
}

/**
 * 多个 native drain 必须共用一次 preventDefault / app.quit。
 * 各自挂 will-quit 的话，先结束的那步会在另一步还没 idle 时拆 Node 环境。
 *
 * 重入 quit 必须推迟到下一个宏任务：Electron 在 will-quit 监听器返回后才把 preventDefault
 * 落成「取消退出」，同一宏任务内（含微任务）再调 app.quit() 会被当成退出中而丢弃，
 * 所有 waiter 立即完成时（如 dev 下 Ctrl+C 已杀掉 agent worker）主进程就会挂住。
 */
export function createAppQuitDrain(steps: AppQuitDrainStep[]): {
  onWillQuit: (event: { preventDefault: () => void }, quit: () => void) => void;
} {
  let draining = false;
  return {
    onWillQuit(event, quit) {
      if (draining) return;
      for (const step of steps) step.begin?.();
      const waiting = steps.filter((step) => step.shouldWait());
      if (waiting.length === 0) return;
      draining = true;
      event.preventDefault();
      void Promise.all(waiting.map((step) => step.wait()))
        .catch(() => {})
        .finally(() => setTimeout(quit, 0));
    },
  };
}

export function attachAppQuitDrain(
  app: {
    on(event: 'will-quit', listener: (event: { preventDefault: () => void }) => void): void;
    quit(): void;
  },
  steps: AppQuitDrainStep[]
): void {
  const drain = createAppQuitDrain(steps);
  app.on('will-quit', (event) => drain.onWillQuit(event, () => app.quit()));
}
