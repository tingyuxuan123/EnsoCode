export const frame = { width: 960, height: 680, title: "设置 · 模型中心 · 订阅登录" };

import { ProvidersPage } from '../components/settings/core/ProvidersPage';

export default function Screen() {
  return <ProvidersPage open="oauth" />;
}
