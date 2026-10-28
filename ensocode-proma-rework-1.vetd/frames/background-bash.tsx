export const frame = { width: 1440, height: 900, title: "后台 Bash · 展开状态" };

import WorkbenchScreen from './index';

/** 后台 Bash 弹层：运行中（可停止）/ 失败（红点）/ 已完成，带输出尾部 */
export default function BackgroundBashScreen() {
  return <WorkbenchScreen initialDock="bash" />;
}
