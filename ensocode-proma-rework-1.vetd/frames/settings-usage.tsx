export const frame = { width: 960, height: 680, title: "设置 · 用量" };

import { UsagePage } from '../components/settings/extra/Usage';

/** 今天 / 近 7 天 / 近 30 天 / 近 90 天、八项指标与同期对比、每日趋势、按模型 / 项目 / 成员、缺失单价警告 */
export default function Screen() {
  return <UsagePage />;
}
