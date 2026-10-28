export const frame = { width: 1440, height: 900, title: "右侧面板 · 浏览器设备预览与下载" };

import { PanelFrame } from '../components/panel/PanelFrame';

/** 设备预览：预设尺寸、旋转、缩放；下载面板：进度、暂停/取消、失败重试、删除记录 */
export default function PanelBrowserDevice() {
  return <PanelFrame kind="browser" title="浏览器" preset={{ state: 'downloads' }} />;
}
