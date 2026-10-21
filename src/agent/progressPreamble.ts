import type { InlineExtension } from '@earendil-works/pi-coding-agent';

/** 工具调用前的进度前导语（对齐 Codex preamble）：让用户在运行中看到"接下来要做什么" */
export const PROGRESS_PREAMBLE_RULE =
  'Before a tool call, or a group of related tool calls, write one short sentence (8-15 words) in the user\'s language saying what you are about to do next, building on what you just learned — e.g. "Config found; next I\'ll run the tests to confirm the fix." Skip it for trivial single reads, and do not repeat it for every call in the same group.';

/** 写进 pi 的 rules 段（promptGuidelines），每轮 before_agent_start 触发，按内容去重 */
export const progressPreambleExtension: InlineExtension = {
  name: 'progress-preamble',
  hidden: true,
  factory: (pi) => {
    pi.on('before_agent_start', (event) => {
      const guidelines = event.systemPromptOptions.promptGuidelines;
      if (!guidelines.includes(PROGRESS_PREAMBLE_RULE)) guidelines.push(PROGRESS_PREAMBLE_RULE);
    });
  },
};
