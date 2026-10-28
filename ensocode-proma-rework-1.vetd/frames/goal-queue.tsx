export const frame = { width: 1440, height: 900, title: "运行控制 · 自主目标、插话队列与项目信任" };

import { GoalBar, MessageQueue, TrustBar } from '../components/RunBars';
import WorkbenchScreen from './index';

/** 运行中：项目扩展信任条 → 插话队列（撤回/编辑/立即发送/打断发送/移除）→ 目标条（暂停/继续/清除）；输入框提示「插入本轮」 */
export default function GoalQueueScreen() {
  return (
    <WorkbenchScreen
      queuedCount={2}
      bars={
        <>
          <TrustBar />
          <MessageQueue />
          <GoalBar />
        </>
      }
    />
  );
}
