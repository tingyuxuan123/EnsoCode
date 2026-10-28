export const frame = { width: 1440, height: 900, title: "运行控制 · 计划模式" };

import { useEffect } from 'react';
import { AssistantHeader, TimelineEvent, UserMessage, WorkedRow } from '../components/Conversation';
import { PlanBar } from '../components/RunBars';
import { useWorkbench } from '../components/Workbench';
import WorkbenchScreen from './index';

function PlanTimeline() {
  return (
    <>
      <UserMessage>/plan 重构设置页的导航和分组，先给我一份计划。</UserMessage>
      <TimelineEvent icon="icon-[lucide--clipboard-list]">已进入 Plan 模式：只读调研，产出计划交你审批</TimelineEvent>
      <AssistantHeader />
      <WorkedRow />
      <p className="text-[15px] leading-[27px]">调研完成：21 个分类里，记忆与工作流跟随内置工具开关显隐，Bot 模式与 Bot 模板跟随实验开关。计划已提交，请在下方审批。</p>
    </>
  );
}

/** 计划待审批：展开预览、修改意见、放弃并退出、批准并执行（可另选执行档位）；批准后变为「执行计划」细条 */
export default function PlanModeScreen() {
  const { setPlanMode } = useWorkbench();
  useEffect(() => setPlanMode(true), []);
  return <WorkbenchScreen running={false} showDock={false} timeline={<PlanTimeline />} bars={<PlanBar />} />;
}
