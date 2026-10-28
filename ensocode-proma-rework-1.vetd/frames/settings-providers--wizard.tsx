export const frame = { width: 960, height: 680, title: "设置 · 模型中心 · 添加模型 / 提供商" };

import { ProvidersPage } from '../components/settings/core/ProvidersPage';

export default function Screen() {
  return <ProvidersPage open="wizard" />;
}
