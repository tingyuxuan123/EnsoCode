export const frame = { width: 1440, height: 900, title: "临时对话视图 · 侧栏分段" };

import WorkbenchScreen from './index';

/**
 * 侧栏顶部「项目 | 临时对话」（/conversations）：新建入口变成「开始临时会话」，
 * 列表只剩不归属项目的会话，保留到手动删除；项目分组与筛选不出现。
 */
export default function Screen() {
  return <WorkbenchScreen running={false} />;
}
