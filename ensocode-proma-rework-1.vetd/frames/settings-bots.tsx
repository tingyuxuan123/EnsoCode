export const frame = { width: 960, height: 680, title: "设置 · Bot 模式" };

import { BotSettingsPage } from '../components/settings/extra/Advanced';

/** 并发上限、助理模型（不可用时回退）、群聊选人模型、快速聊天模型与超时 */
export default function Screen() {
  return <BotSettingsPage />;
}
