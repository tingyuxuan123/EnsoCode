export const frame = { width: 960, height: 680, title: "设置 · 模型中心 · 从本地应用导入" };

import { ProvidersPage } from '../components/settings/core/ProvidersPage';

export default function Screen() {
  return <ProvidersPage open="import" />;
}
