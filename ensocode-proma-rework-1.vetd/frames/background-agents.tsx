export const frame = { width: 1440, height: 900, title: "后台 Agent · 展开状态" };

import WorkbenchScreen from './index';

export default function BackgroundAgentsScreen() {
  return <WorkbenchScreen initialDock="agents" />;
}
