export const frame = { width: 960, height: 680, title: "设置 · Bot 模板编辑" };

import { BotTemplatesPage } from '../components/settings/extra/Advanced';

/** 团队模板编辑：群名、群主、共享 / 独立 / 基于 Code 项目工作区、成员与委派关系、校验错误 */
export default function Screen() {
  return <BotTemplatesPage open="team" />;
}
