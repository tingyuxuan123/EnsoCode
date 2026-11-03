/** A rejected local send is not a delivery acknowledgement. Keep the reason visible. */
export function phoneCommandRejection(
  command: string,
  error: string
): {
  notice: string;
  clearQueueEchoes: boolean;
} {
  return {
    notice: `操作未发送（${command}）：${error}。请确认连接与桌面状态后重试。`,
    clearQueueEchoes: command === 'queue-send-now' || command === 'queue-interrupt-send',
  };
}
