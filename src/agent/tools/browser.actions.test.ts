import type { JsonSchema } from '@shared/capabilities/types';
import { describe, expect, it, vi } from 'vitest';
import { matchesJsonSchema } from '../../tooling/productCapabilityCoverage.fixture';
import { BrowserInvoker, createBrowserTools, withNavigateApproval } from './browser';

const identity = { sessionId: 's1', generation: '11111111-1111-4111-8111-111111111111' };
const setup = () => {
  const invoker = new BrowserInvoker(identity, () => {});
  const invoke = vi.spyOn(invoker, 'invoke').mockResolvedValue({ completed: 2 });
  const tool = createBrowserTools(invoker).find((tool) => tool.name === 'browser_act')!;
  return { tool, invoke };
};

describe('browser_act', () => {
  it('keeps action descriptions for display but never sends display metadata to Main', async () => {
    const { tool, invoke } = setup();
    const raw = {
      description: '完成登录',
      steps: [{ action: 'click', target: '登录', description: '进入登录页' }],
    };
    const prepared = tool.prepareArguments!(raw as never) as typeof raw;
    expect(prepared.description).toBe('完成登录');
    expect(prepared.steps[0].description).toBe('进入登录页');
    await tool.execute('c', raw as never, undefined, undefined, undefined as never);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      'act',
      { steps: [{ action: 'click', target: '登录' }] },
      undefined
    );
  });
  it('accepts real GPT arguments with every optional field filled, without forwarding irrelevant fields', async () => {
    const { tool, invoke } = setup();
    const fillers = {
      ref: '',
      target: '',
      role: '',
      nth: 1,
      text: '',
      submit: false,
      key: '',
      direction: 'down',
      amount: 1,
      values: [],
      checked: false,
      timeoutMs: 10000,
      url: '',
    };
    const raw = {
      steps: [
        { ...fillers, action: 'click', target: 'Start', role: 'button' },
        { ...fillers, action: 'fill', target: 'Query', role: 'textbox', text: 'hello' },
        { ...fillers, action: 'wait', text: 'Result: hello' },
      ],
    };
    const prepared = tool.prepareArguments!(raw as never);
    expect(matchesJsonSchema(tool.parameters as JsonSchema, prepared)).toBe(true);
    await tool.execute('c', raw as never, undefined, undefined, undefined as never);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      'act',
      {
        steps: [
          { action: 'click', target: 'Start', role: 'button', nth: 1 },
          { action: 'fill', target: 'Query', role: 'textbox', nth: 1, text: 'hello' },
          { action: 'wait', text: 'Result: hello', timeoutMs: 10000 },
        ],
      },
      undefined
    );
  });
  it('normalizes nested model arguments before schema validation and sends one request', async () => {
    const { tool, invoke } = setup();
    expect(tool).toBeDefined();
    const raw = {
      tabId: '',
      steps: JSON.stringify([
        { action: 'TYPE', target: 'Query', text: 'hello', submit: 'false' },
        { action: 'wait', text: 'ready', timeoutMs: '2000' },
      ]),
    };
    const prepared = tool.prepareArguments!(raw as never);
    expect(matchesJsonSchema(tool.parameters as JsonSchema, prepared)).toBe(true);
    await tool.execute('c', raw as never, undefined, undefined, undefined as never);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      'act',
      {
        steps: [
          { action: 'type', target: 'Query', text: 'hello', submit: false },
          { action: 'wait', text: 'ready', timeoutMs: 2000 },
        ],
      },
      undefined
    );
  });

  it('refuses a bad later step before issuing the first browser request', async () => {
    const { tool, invoke } = setup();
    expect(tool).toBeDefined();
    await expect(
      tool.execute(
        'c',
        {
          steps: [
            { action: 'click', ref: 'e1' },
            { action: 'type', ref: 'e2' },
          ],
        } as never,
        undefined,
        undefined,
        undefined as never
      )
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([{ timeoutMs: 8000 }, { timeoutMs: 8000, text: '  ' }])(
    'explains an empty wait condition before sending any input: %j',
    async (wait) => {
      const { tool, invoke } = setup();
      await expect(
        tool.execute(
          'c',
          {
            steps: [
              { action: 'type', ref: 'e1', text: 'question', submit: true },
              { action: 'wait', ...wait },
            ],
          } as never,
          undefined,
          undefined,
          undefined as never
        )
      ).rejects.toThrow(/step 2: Wait requires non-empty text\. No steps were executed\./);
      expect(invoke).not.toHaveBeenCalled();
    }
  );

  it('approves external navigation in a batch before any action; localhost remains exempt', async () => {
    const { tool, invoke } = setup();
    expect(tool).toBeDefined();
    const ask = vi.fn().mockResolvedValue('deny');
    const wrapped = withNavigateApproval({ needsApproval: () => true, ask } as never, tool);
    await expect(
      wrapped.execute(
        'c',
        {
          steps: [
            { action: 'click', ref: 'e1' },
            { action: 'navigate', url: 'https://example.com' },
          ],
        } as never,
        undefined,
        undefined,
        undefined as never
      )
    ).rejects.toThrow();
    expect(ask).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    await wrapped.execute(
      'c',
      { steps: [{ action: 'navigate', url: 'http://localhost:8888' }] } as never,
      undefined,
      undefined,
      undefined as never
    );
    expect(invoke).toHaveBeenCalledOnce();
  });
});
