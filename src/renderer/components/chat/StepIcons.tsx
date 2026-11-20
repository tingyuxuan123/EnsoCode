import type { ComponentType } from 'react';

export type StepIconComponent = ComponentType<{
  className?: string;
  'aria-hidden'?: boolean;
}>;

/**
 * 脚本工具编排（codemode / exec / workflow）专属微标：
 * `{ ▶ }` 语义明确且无外框，放进 22px 圆角徽标内不会出现“框套框”。
 */
export function ScriptOrchestrationIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.45}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-step-glyph="script-orchestration"
      className={className}
    >
      <path d="M5.1 2.7C3.75 2.7 3.55 3.6 3.55 4.7v1.65c0 .9-.4 1.4-1.2 1.65.8.25 1.2.75 1.2 1.65V11.3c0 1.1.2 2 1.55 2" />
      <path d="M10.9 2.7c1.35 0 1.55.9 1.55 2v1.65c0 .9.4 1.4 1.2 1.65-.8.25-1.2.75-1.2 1.65V11.3c0 1.1-.2 2-1.55 2" />
      <path d="M6.75 5.45 10.4 8l-3.65 2.55Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * 思考 / 推理步骤专属微标：
 * 极简双星灵光，13px 小尺寸下线条通透克制，替代笔画拥挤的 Brain 图标。
 */
export function ThinkingSparkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.45}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-step-glyph="thinking"
      className={className}
    >
      <path d="M7.3 2.35c.5 3.1 1.55 4.15 4.65 4.65-3.1.5-4.15 1.55-4.65 4.65-.5-3.1-1.55-4.15-4.65-4.65 3.1-.5 4.15-1.55 4.65-4.65Z" />
      <path
        d="M12.65 10.55c.23 1.32.68 1.77 2 2-1.32.23-1.77.68-2 2-.23-1.32-.68-1.77-2-2 1.32-.23 1.77-.68 2-2Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
