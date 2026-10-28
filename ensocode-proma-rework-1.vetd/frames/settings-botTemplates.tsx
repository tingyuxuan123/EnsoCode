export const frame = { width: 960, height: 680, title: "设置 · Bot 模板" };

import { BotTemplatesPage } from '../components/settings/extra/Advanced';

/** 成员模板 / 团队模板：内置 / 自定义 / 已修改 / 已隐藏、隐藏、恢复默认、删除、导入导出 JSON */
export default function Screen() {
  return <BotTemplatesPage />;
}
