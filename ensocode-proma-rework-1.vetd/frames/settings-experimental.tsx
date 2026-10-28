export const frame = { width: 960, height: 680, title: "设置 · 实验功能" };

import { ExperimentalPage } from '../components/settings/extra/Advanced';

/** Bot 模式开关与说明；关闭后侧栏分段与 Bot 两页一起隐藏 */
export default function Screen() {
  return <ExperimentalPage />;
}
