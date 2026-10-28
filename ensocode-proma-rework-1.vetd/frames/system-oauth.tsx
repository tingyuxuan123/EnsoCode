export const frame = { width: 1440, height: 900, title: "系统 · 订阅登录与子 Agent 授权" };

import { OauthLogin } from '../components/system/Onboarding';

/** OAuth：等待回调、手动回填、失败重试、成功；子 Agent 请求授权沿用同一套步骤 */
export default function SystemOauth() {
  return <OauthLogin />;
}
