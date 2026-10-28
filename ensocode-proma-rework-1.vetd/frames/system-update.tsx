export const frame = { width: 1440, height: 900, title: "系统 · 版本更新横幅" };

import WorkbenchScreen from './index';

/** 标题栏下的更新横幅：检查中 / 发现新版 / 下载进度 / 已就绪（重启更新）/ 失败重试；可在横幅内切换状态 */
export default function SystemUpdate() {
  return <WorkbenchScreen running={false} />;
}
