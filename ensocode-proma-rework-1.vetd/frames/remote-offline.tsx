export const frame = { width: 1440, height: 900, title: "远程 · 对方桌面离线" };

import { RemoteChat } from '../components/remote/RemoteChat';

/** 离线：可以翻历史，输入框锁定，发送与审批排队等重连 */
export default function RemoteOfflineFrame() {
  return <RemoteChat offline />;
}
