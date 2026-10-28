export const frame = { width: 960, height: 680, title: "设置 · SSH 连接" };

import { SshPage } from '../components/settings/extra/Connections';

/** 连接列表（密码 / 密钥 agent）、添加、测试成功、主机指纹、SSH 超时、编辑与删除 */
export default function Screen() {
  return <SshPage />;
}
