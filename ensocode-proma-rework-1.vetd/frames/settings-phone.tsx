export const frame = { width: 960, height: 680, title: "设置 · 设备（配对与连接）" };

import { DevicesPage } from '../components/settings/extra/Connections';

/** 允许连入、配对码与二维码（60 秒一次）、已配对设备（直连/中继、只读/可操作、重命名、断开）、连接到节点 */
export default function Screen() {
  return <DevicesPage />;
}
