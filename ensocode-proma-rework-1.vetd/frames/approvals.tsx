export const frame = { width: 1440, height: 900, title: "运行控制 · 工具审批（输入框上方）" };

import { ApprovalBar, MessageQueue } from '../components/RunBars';
import WorkbenchScreen from './index';

/** 真实位置：ChatView 中输入框上方。审批挂起时输入框锁定；队首 1/N；受保护操作单次授权；代审中；超时。 */
export default function ApprovalsScreen() {
  return (
    <WorkbenchScreen
      locked
      bars={
        <>
          <ApprovalBar />
          <MessageQueue initial={[{ id: 'm1', text: '补充检查小窗口宽度下的输入区换行。', images: 0 }]} />
        </>
      }
    />
  );
}
