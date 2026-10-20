/** 用户消息正文默认最大可见高度（px）：与 ZCode 的 user row 对齐 */
export const USER_QUERY_MAX_HEIGHT = 120;

/** 溢出判定余量：亚像素误差不能让刚好卡线的正文闪出展开按钮 */
const OVERFLOW_TOLERANCE = 1;

/** 完整正文高度（scrollHeight，不受 max-height 影响）超过可见高度时才可折叠 */
export function shouldCollapseUserQuery(scrollHeight: number): boolean {
  return Number.isFinite(scrollHeight) && scrollHeight > USER_QUERY_MAX_HEIGHT + OVERFLOW_TOLERANCE;
}
