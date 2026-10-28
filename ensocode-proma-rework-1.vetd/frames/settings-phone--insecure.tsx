export const frame = { width: 960, height: 680, title: "设置 · 设备（安全存储不可用）" };

import { DevicesPage } from '../components/settings/extra/Connections';

/** 系统不支持安全存储时的警告：配对密钥将以未加密方式保存 */
export default function Screen() {
  return <DevicesPage insecure />;
}
