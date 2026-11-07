/** 后台信号：失败不影响用户操作，且 host 新连接会重置其状态，不必提示 */
const SILENT_COMMANDS = new Set(['presence']);

/** A rejected local send is not a delivery acknowledgement. Keep the reason visible. */
export function phoneCommandRejection(
  command: string,
  error: string
): {
  notice: string | null;
  clearQueueEchoes: boolean;
} {
  return {
    notice: SILENT_COMMANDS.has(command)
      ? null
      : `操作未发送（${command}）：${error}。请确认连接与桌面状态后重试。`,
    clearQueueEchoes: command === 'queue-send-now' || command === 'queue-interrupt-send',
  };
}
