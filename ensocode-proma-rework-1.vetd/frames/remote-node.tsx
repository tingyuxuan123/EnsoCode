export const frame = { width: 1440, height: 900, title: "远程 · 远端工作台（已连接）" };

import { RemoteChat } from '../components/remote/RemoteChat';

/** 已连接：远端分组/项目/归档、会话与协作者；顶部说明 agent、密钥与历史都在对方机器上 */
export default function RemoteNodeFrame() {
  return <RemoteChat />;
}
