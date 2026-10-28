export const frame = { width: 960, height: 680, title: "设置 · 通用 · 配置迁移与本地导入" };

import { ConfigSyncPage } from '../components/settings/core/ConfigSyncPage';

/** 导出加密配置包（密码 8 位、两次一致）、导入预览（合并 / 替换、信任确认、自动备份）、本地导入扫描 */
export default function Screen() {
  return <ConfigSyncPage />;
}
