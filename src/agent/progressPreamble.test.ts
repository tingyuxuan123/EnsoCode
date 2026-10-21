import { describe, expect, it } from 'vitest';
import { PROGRESS_PREAMBLE_RULE, progressPreambleExtension } from './progressPreamble';

type Options = { promptGuidelines: string[] };
type Handler = (event: { systemPromptOptions: Options }) => void;

function install(): Handler {
  let handler: Handler | undefined;
  (progressPreambleExtension as { factory: (pi: unknown) => void }).factory({
    on: (name: string, fn: Handler) => {
      if (name === 'before_agent_start') handler = fn;
    },
  } as never);
  if (!handler) throw new Error('before_agent_start not registered');
  return handler;
}

describe('progress preamble rule', () => {
  it('追加到已有规则之后，多轮触发不重复', () => {
    const handler = install();
    const options: Options = { promptGuidelines: ['Existing rule'] };
    handler({ systemPromptOptions: options });
    handler({ systemPromptOptions: options });
    expect(options.promptGuidelines).toEqual(['Existing rule', PROGRESS_PREAMBLE_RULE]);
  });

  it('要求工具调用前给出一句简短的下一步说明，并允许跳过琐碎读取', () => {
    expect(PROGRESS_PREAMBLE_RULE).toMatch(/before/i);
    expect(PROGRESS_PREAMBLE_RULE).toMatch(/tool call/i);
    expect(PROGRESS_PREAMBLE_RULE).toMatch(/skip/i);
    expect(PROGRESS_PREAMBLE_RULE).toMatch(/user's language/i);
  });
});
