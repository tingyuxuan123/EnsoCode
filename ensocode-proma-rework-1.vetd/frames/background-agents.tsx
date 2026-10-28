export const frame = { width: 1440, height: 900, title: "后台 Agent · 展开状态" };

import WorkbenchScreen from './index';

/** 后台 Agent 弹层：最近/进行中/已完成/全部；运行中、已完成、失败、协作者待命；查看过程 / 停止子代理 / 在侧栏打开 */
export default function BackgroundAgentsScreen() {
  return <WorkbenchScreen initialDock="agents" />;
}
