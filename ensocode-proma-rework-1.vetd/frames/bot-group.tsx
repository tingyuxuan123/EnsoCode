export const frame = { width: 1440, height: 900, title: "Bot · 群聊与话题" };

import { BotChat } from '../components/bot/BotChat';

/** 群聊：话题条、成员发言、任务事件、委派卡住、例程执行；底部排队插话与「不 @ 时智能选人」 */
export default function BotGroupScreen() {
  return <BotChat mode="group" panel />;
}
