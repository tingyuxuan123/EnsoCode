export const frame = { width: 1440, height: 900, title: "当前进度 · 展开状态" };

import WorkbenchScreen from './index';

export default function TaskProgressScreen() {
  return <WorkbenchScreen initialDock="progress" />;
}
