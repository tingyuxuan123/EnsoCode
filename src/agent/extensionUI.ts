import type { ExtensionRunner, ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent';
import type { AskManager } from './ask';

/**
 * 只接 Pi 扩展的协议式选择/确认，不调用 bindExtensions：后者还会触发 session_start
 * 和资源发现，Enso 的 Claude hooks 已由现有生命周期管理，不能在这里重跑。
 * 其余终端 UI 保持 SDK 的 no-op；不声称支持 custom/editor/picker。
 */
export function bindExtensionUI(
  runner: Pick<ExtensionRunner, 'getUIContext' | 'setUIContext'>,
  asks: AskManager,
  isCurrent: () => boolean
): void {
  const select = async (
    title: string,
    options: string[],
    opts?: ExtensionUIDialogOptions
  ): Promise<string | undefined> => {
    if (!isCurrent() || opts?.signal?.aborted) return undefined;
    try {
      const answer = await asks.select(title, options, {
        signal: opts?.signal,
        timeoutMs: opts?.timeout,
      });
      // 答复与会话释放可能发生在同一轮事件循环；过期会话不能采纳迟到授权。
      return isCurrent() && !opts?.signal?.aborted ? answer : undefined;
    } catch {
      return undefined;
    }
  };
  runner.setUIContext(
    {
      ...runner.getUIContext(),
      select,
      confirm: async (title, message, opts) =>
        (await select(`${title}\n\n${message}`, ['Allow', 'Deny'], opts)) === 'Allow',
    },
    'rpc'
  );
}
