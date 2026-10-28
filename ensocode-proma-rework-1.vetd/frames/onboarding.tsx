export const frame = { width: 1440, height: 900, title: "首次使用 · 引导（第 1 步 / 共 8 步）" };

import { Onboarding } from '../components/system/Onboarding';

/** 8 步引导：欢迎 → 模型中心 → 技能 → MCP → 指令 → 预设 → 子代理类型 → 完成；每步可跳过 */
export default function OnboardingFrame() {
  return <Onboarding start={0} />;
}
