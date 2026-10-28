export const frame = { width: 960, height: 680, title: "设置 · SSH 连接编辑" };

import { SshPage } from '../components/settings/extra/Connections';

/** 名称、主机、用户、端口、认证方式（密码留空保持原值）、取消 / 保存、测试失败 */
export default function Screen() {
  return <SshPage dialog="edit" />;
}
