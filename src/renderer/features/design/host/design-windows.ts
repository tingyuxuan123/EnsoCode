import { create } from 'zustand';

/** 主窗口：已弹到独立设计窗口的根会话（Main 权威，经 list/onChanged 同步）。 */
export const useDesignWindows = create<{ sessions: readonly string[] }>(() => ({ sessions: [] }));

let bindings = 0;
let unbind: (() => void) | undefined;
/** 引用计数订阅：多个挂载点共用一份同步。 */
export function bindDesignWindows(): () => void {
  if (bindings++ === 0) {
    const api = window.electronAPI.designWindow;
    let changed = false;
    const stop = api.onChanged((sessions) => {
      changed = true;
      useDesignWindows.setState({ sessions });
    });
    void api
      .list()
      .then((sessions) => {
        // 初始查询比推送晚到时，不用旧快照覆盖。
        if (!changed) useDesignWindows.setState({ sessions });
      })
      .catch((error) => console.warn('[design] window list failed', error));
    unbind = stop;
  }
  return () => {
    if (--bindings === 0) {
      unbind?.();
      unbind = undefined;
    }
  };
}

/**
 * 与 Main 的 workspaceRoot 同口径：coworker（`root::cw-x`）与子会话 tab 都归到根会话。
 * Main 仍会再按权威记录校验，这里只决定主窗口显示画布还是占位。
 */
export function designWindowRoot(
  id: string,
  conversations: Record<string, { parentId?: string } | undefined>
): string {
  const base = id.split('::')[0];
  return conversations[base]?.parentId ?? base;
}

/** Main 每次最多接 500 条活动；空列表也要发，运行状态才能送达。 */
export function chunkDesignActivity<T>(events: readonly T[], size = 500): T[][] {
  if (events.length === 0) return [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < events.length; i += size) chunks.push(events.slice(i, i + size));
  return chunks;
}
