export const frame = { width: 960, height: 680, title: "设置 · 模型中心 · ChatGPT 自动接替池" };

import { ProvidersPage } from '../components/settings/core/ProvidersPage';

export default function Screen() {
  return <ProvidersPage open="pool" />;
}
