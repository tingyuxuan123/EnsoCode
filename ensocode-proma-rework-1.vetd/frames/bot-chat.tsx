export const frame = { width: 1440, height: 900, title: "Bot · 成员私聊（右侧资料面板）" };

import { BotChat } from '../components/bot/BotChat';

/** 私聊：工作中插话、转交给另一位成员、委派结果；右侧面板 资料 / 能力 / 记忆 / 例行 / 历史 */
export default function BotChatScreen() {
  return <BotChat mode="dm" panel />;
}
