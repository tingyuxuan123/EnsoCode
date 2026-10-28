export const frame = { width: 960, height: 680, title: "设置 · 模型中心 · 编辑模型服务" };

import { ProvidersPage } from '../components/settings/core/ProvidersPage';

export default function Screen() {
  return <ProvidersPage open="edit" />;
}
