import type { JsonSchema } from '@shared/capabilities/types';
import type { SpawnModelConfig } from '@shared/types';
import type { AgentControlToolResponse, AgentWorkerEvent } from '@shared/types/agent';
import { describe, expect, it, vi } from 'vitest';
import { matchesJsonSchema } from '../tooling/productCapabilityCoverage.fixture';
import { AgentControlInvoker } from './agentControl';
import { createUnifiedSubagentTool, type UnifiedSubagentDeps } from './subagent';

const cheapConfig: SpawnModelConfig = {
  api: 'openai-completions',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'k',
  modelId: 'gpt-cheap',
  settingsProviderId: 'p1',
};

function setup(overrides: Partial<UnifiedSubagentDeps> = {}) {
  const deps: UnifiedSubagentDeps = {
    agentTypes: [],
    models: [{ name: 'OpenAI/gpt-cheap', config: cheapConfig }],
    invoke: vi.fn(async (request) => ({ ok: true as const, value: { request } })),
    ...overrides,
  };
  return { deps, tool: createUnifiedSubagentTool(deps) };
}

describe('unified subagent tool', () => {
  it('已声明可选字段的 null 占位不会穿透到非 nullable schema', () => {
    const { tool } = setup();
    const prepared = tool.prepareArguments?.({
      operation: 'spawn',
      prompt: 'p',
      name: null,
      mode: null,
      wait: null,
      schema: null,
      gate: null,
    });
    expect(prepared).toEqual({ operation: 'spawn', description: 'p', prompt: 'p' });
    expect(matchesJsonSchema(tool.parameters as unknown as JsonSchema, prepared)).toBe(true);
    expect(tool.prepareArguments?.({ operation: 'report', runId: 'r', agentId: null })).toEqual({
      operation: 'report',
      runId: 'r',
    });
    expect(() =>
      tool.prepareArguments?.({ operation: 'report', runId: 'r', invented: null })
    ).toThrow(/invented/i);
  });
  it('wait 的空 runIds 占位不遮蔽有效 runId，无有效身份仍拒绝', () => {
    const { tool } = setup();
    expect(tool.prepareArguments?.({ operation: 'wait', runId: 'r', runIds: [] })).toEqual({
      operation: 'wait',
      runId: 'r',
    });
    expect(() => tool.prepareArguments?.({ operation: 'wait', runIds: [] })).toThrow(/runId/i);
  });
  it('agent_type 先 trim，仍使用精确名称而非猜测别名', () => {
    const { tool } = setup({
      agentTypes: [
        {
          name: 'scout',
          description: '',
          systemPrompt: '',
          tools: 'readonly',
          allowModelOverride: true,
        },
      ],
    });
    const prepared = tool.prepareArguments?.({
      operation: 'spawn',
      agent_type: ' scout ',
      prompt: 'p',
      model: 'OpenAI/gpt-cheap',
    });
    expect(prepared).toMatchObject({ agent_type: 'scout' });
    expect(matchesJsonSchema(tool.parameters as unknown as JsonSchema, prepared)).toBe(true);
  });
  it('父代理按类型看到准确的 shell、编辑范围和模型要求，不泄露凭证', () => {
    const { tool } = setup({
      agentTypes: [
        {
          name: 'scout',
          description: 'Recon',
          systemPrompt: '',
          tools: 'readonly',
          allowModelOverride: true,
        },
        {
          name: 'worker',
          description: 'Implementation',
          systemPrompt: '',
          tools: 'all',
          allowModelOverride: false,
        },
        {
          name: 'tester',
          description: 'Tests',
          systemPrompt: '',
          tools: 'all',
          writeScope: ['**/*.test.ts'],
          allowModelOverride: true,
        },
      ],
    });
    const description = (tool.parameters as { properties: { agent_type: { description: string } } })
      .properties.agent_type.description;
    expect(description).toContain('scout');
    expect(description).toContain('read, grep, find, ls');
    expect(description).toContain('no shell');
    expect(description).toContain('model required');
    expect(description).toContain('model override not allowed');
    expect(description).toContain('**/*.test.ts');
    expect(description).not.toContain(cheapConfig.baseUrl);
    expect(description).not.toContain('apiKey');
    expect(tool.promptGuidelines?.join('\n')).toContain('git log/show/diff');
  });

  it('缺少默认 worker 的必选模型在 prepareArguments 阶段明确拒绝，不创建子代理', () => {
    const { tool, deps } = setup({
      agentTypes: [
        {
          name: 'worker',
          description: '',
          systemPrompt: '',
          tools: 'all',
          allowModelOverride: true,
        },
      ],
    });
    expect(() =>
      tool.prepareArguments?.({ operation: 'spawn', description: 'review', prompt: 'review' })
    ).toThrow(/worker.*requires a model/i);
    expect(deps.invoke).not.toHaveBeenCalled();
  });

  it('模型后缀与 JSON schema 在参数校验前归一化，产物满足自身 schema 且幂等', () => {
    const { tool } = setup();
    const input = {
      operation: 'spawn',
      prompt: 'review',
      model: 'OpenAI/gpt-cheap:high',
      schema: '{"type":"object"}',
    };
    const prepared = tool.prepareArguments?.(input);
    expect(prepared).toMatchObject({
      model: 'OpenAI/gpt-cheap',
      thinking: 'high',
      schema: { type: 'object' },
    });
    expect(matchesJsonSchema(tool.parameters as unknown as JsonSchema, prepared)).toBe(true);
    expect(tool.prepareArguments?.(prepared)).toEqual(prepared);
    expect(input.model).toBe('OpenAI/gpt-cheap:high');
  });

  it('非 spawn 的有效多余字段在执行前指出字段，空串占位则安全丢弃', async () => {
    const { tool, deps } = setup();
    expect(() =>
      tool.prepareArguments?.({ operation: 'report', runId: 'r', description: 'unrelated' })
    ).toThrow(/description.*report|report.*description/i);
    await expect(
      tool.execute(
        'mixed',
        { operation: 'wait', runId: 'r', agentId: 'a' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/agentId.*wait|wait.*agentId/i);
    const prepared = tool.prepareArguments?.({
      operation: 'report',
      runId: 'r',
      description: '',
      prompt: ' ',
    });
    expect(prepared).toEqual({ operation: 'report', runId: 'r' });
    expect(matchesJsonSchema(tool.parameters as unknown as JsonSchema, prepared)).toBe(true);
    expect(deps.invoke).not.toHaveBeenCalled();
  });

  it('非对象参数直接报告对象要求而不是抛 TypeError', () => {
    const { tool } = setup();
    for (const value of [null, [], 'spawn']) {
      expect(() => tool.prepareArguments?.(value)).toThrow(/object/i);
    }
  });

  it('模型只看到 subagent，一个 schema 覆盖全部生命周期操作', () => {
    const { tool } = setup();
    expect(tool.name).toBe('subagent');
    const operation = (tool.parameters as { properties: { operation: { enum: string[] } } })
      .properties.operation;
    expect(operation.enum).toEqual([
      'spawn',
      'send',
      'wait',
      'report',
      'list',
      'message',
      'stop',
      'dismiss',
    ]);
    expect(`${tool.description}\n${tool.promptSnippet}`).not.toMatch(/coworker tool/i);
    expect(`${tool.description}\n${tool.promptSnippet}`).toMatch(
      /spawn requires non-empty description and prompt/i
    );
    const parameters = tool.parameters as {
      oneOf?: unknown;
      anyOf?: unknown;
      allOf?: unknown;
      properties: {
        description: { description?: string };
        prompt: { description?: string };
        runIds: { description?: string; uniqueItems?: boolean };
      };
    };
    const fields = parameters.properties;
    expect(parameters.oneOf).toBeUndefined();
    expect(parameters.anyOf).toBeUndefined();
    expect(parameters.allOf).toBeUndefined();
    expect(JSON.stringify(parameters)).not.toMatch(/"uniqueItems"/);
    expect(fields.runIds.description).toMatch(/duplicate/i);
    expect(`${fields.description.description}\n${fields.prompt.description}`).toMatch(/spawn/i);
    expect(fields.description.description).toMatch(/required/i);
    expect(fields.prompt.description).toMatch(/required/i);
    expect(tool.promptGuidelines?.join('\n')).toMatch(
      /spawn requires non-empty description and prompt/i
    );
    const model = (
      tool.parameters as { properties: { model?: { enum?: string[]; description?: string } } }
    ).properties.model;
    expect(model?.enum).toEqual(['OpenAI/gpt-cheap']);
    expect(model?.description).toMatch(/exact/i);
    expect(tool.promptGuidelines?.join('\n')).toMatch(/model enum/i);
  });

  it('用户为每个模型写的选型描述会进入 model 参数说明和使用准则', () => {
    const { tool } = setup({
      models: [
        { name: 'DeepSeek/v4-flash', config: cheapConfig, description: '只读调研、大量读代码' },
        { name: 'Claude/opus', config: cheapConfig, description: '代码评审、架构设计' },
        { name: 'OpenAI/gpt-cheap', config: cheapConfig },
      ],
    });
    const model = (tool.parameters as { properties: { model?: { description?: string } } })
      .properties.model;
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';
    for (const text of [model?.description ?? '', guidelines]) {
      expect(text).toContain('DeepSeek/v4-flash: 只读调研、大量读代码');
      expect(text).toContain('Claude/opus: 代码评审、架构设计');
    }
    expect(guidelines).not.toContain('OpenAI/gpt-cheap:');
  });

  it('spawn 漏掉 description 时用 name 或 prompt 补标签，斜杠模型名仍然合法', async () => {
    const { deps, tool } = setup({
      agentTypes: [
        {
          name: 'reviewer',
          description: 'reviewer',
          systemPrompt: '',
          tools: 'readonly',
          allowModelOverride: true,
        },
      ],
    });
    await tool.execute(
      'call-missing-description',
      {
        operation: 'spawn',
        agent_type: 'reviewer',
        mode: 'task',
        model: 'OpenAI/gpt-cheap',
        name: 'issue98review',
        prompt: 'review this',
      },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'issue98review',
        prompt: 'review this',
        model: 'OpenAI/gpt-cheap',
      }),
      undefined
    );
    await tool.execute(
      'call-label-from-prompt',
      { operation: 'spawn', model: 'OpenAI/gpt-cheap', prompt: 'review the diff\nthen stop' },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({
        description: 'review the diff',
        prompt: 'review the diff\nthen stop',
      }),
      undefined
    );
    await expect(
      tool.execute(
        'call-missing-prompt',
        {
          operation: 'spawn',
          model: 'OpenAI/gpt-cheap',
          description: '   ',
          prompt: '',
        },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/prompt/);
  });

  it('spawn 先归一化默认 task/异步，再交给 typed Main RPC', async () => {
    const { deps, tool } = setup();
    const result = await tool.execute(
      'call-1',
      { operation: 'spawn', description: 'review', prompt: 'review this' },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.invoke).toHaveBeenCalledWith(
      {
        operation: 'spawn',
        mode: 'task',
        description: 'review',
        prompt: 'review this',
        wait: false,
      },
      undefined
    );
    expect(result.details).toMatchObject({ request: { operation: 'spawn', mode: 'task' } });
  });

  it('spawn/send 带 wait:true 被 abort 时只打断等待，仍返回 Main 的回执', async () => {
    const emitted: AgentWorkerEvent[] = [];
    const invoker = new AgentControlInvoker(
      { sessionId: 'parent', generation: '11111111-1111-4111-8111-111111111111' },
      (event) => emitted.push(event),
      () => 'req-wait'
    );
    const { tool } = setup({ invoke: (request, signal) => invoker.invoke(request, signal) });
    const controller = new AbortController();
    const running = tool.execute(
      'call-abort',
      { operation: 'send', agentId: 'agent-1', message: 'more', wait: true },
      controller.signal,
      undefined,
      {} as never
    );
    controller.abort();
    expect(emitted.at(-1)).toMatchObject({ type: 'agent-control-cancel', requestId: 'req-wait' });
    const receipt = {
      agentId: 'agent-1',
      runId: 'run-1',
      delivery: 'steer',
      status: 'running',
      report: { runs: [], timedOut: false, interrupted: true },
    };
    invoker.resolve('req-wait', { ok: true, value: receipt });
    await expect(running).resolves.toMatchObject({ details: receipt });
  });

  it('list/message normalize pagination and server-bound sender inputs', async () => {
    const { deps, tool } = setup();
    await tool.execute('list', { operation: 'list', limit: 5 }, undefined, undefined, {} as never);
    await tool.execute(
      'message',
      { operation: 'message', to: 'agent-1', text: 'status?' },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.invoke).toHaveBeenNthCalledWith(1, { operation: 'list', limit: 5 }, undefined);
    expect(deps.invoke).toHaveBeenNthCalledWith(
      2,
      { operation: 'message', to: 'agent-1', text: 'status?' },
      undefined
    );
  });

  it('send 默认 auto/异步，next 可冻结新一轮 schema/gate', async () => {
    const { deps, tool } = setup();
    const schema = { type: 'object' };
    await tool.execute(
      'call-2',
      {
        operation: 'send',
        agentId: 'agent-1',
        message: 'next task',
        delivery: 'next',
        schema,
        gate: { commandRef: 'tests' },
      },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'send',
        delivery: 'next',
        wait: false,
        schema,
        gate: { commandRef: 'tests' },
      }),
      undefined
    );
  });

  it('无效参数组合在 RPC 前拒绝，gate 不接受自由 shell 字符串', async () => {
    const { deps, tool } = setup();
    await expect(
      tool.execute(
        'call-3',
        { operation: 'wait', agentId: 'agent-1' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/invalid/i);
    await expect(
      tool.execute(
        'call-4',
        {
          operation: 'spawn',
          description: 'x',
          prompt: 'x',
          gate: 'pnpm test',
        },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/invalid/i);
    await expect(
      tool.execute(
        'call-argv',
        {
          operation: 'spawn',
          description: 'x',
          prompt: 'x',
          gate: { argv: ['pnpm', 'test'] },
        },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/invalid/i);
    expect(deps.invoke).not.toHaveBeenCalled();
  });

  it('Main 结构化拒绝转成工具错误，不解析自然语言找 ID', async () => {
    const { tool } = setup({
      invoke: vi.fn(async () => ({
        ok: false as const,
        code: 'mode-disabled' as const,
        error: 'task mode disabled',
      })),
    });
    await expect(
      tool.execute(
        'call-5',
        { operation: 'spawn', description: 'x', prompt: 'x' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/mode-disabled.*task mode disabled/i);
  });

  it('模型后缀先归一化 thinking，并严格校验模型目录', async () => {
    const { deps, tool } = setup();
    await tool.execute(
      'call-model',
      {
        operation: 'spawn',
        description: 'x',
        prompt: 'x',
        model: 'OpenAI/gpt-cheap:high',
      },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'OpenAI/gpt-cheap', thinking: 'high' }),
      undefined
    );
    await expect(
      tool.execute(
        'call-unknown-model',
        { operation: 'spawn', description: 'x', prompt: 'x', model: 'unknown' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/unknown model/i);
  });

  it('保留 agent_type 的必选模型与锁定模型边界', async () => {
    const required = setup({
      agentTypes: [
        {
          name: 'scout',
          description: 'scout',
          systemPrompt: '',
          tools: 'readonly',
          allowModelOverride: true,
        },
      ],
    });
    await expect(
      required.tool.execute(
        'call-required',
        { operation: 'spawn', description: 'x', prompt: 'x', agent_type: 'scout' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/requires a model/i);
    expect(required.deps.invoke).not.toHaveBeenCalled();

    const locked = setup({
      agentTypes: [
        {
          name: 'reviewer',
          description: 'reviewer',
          systemPrompt: '',
          tools: 'readonly',
          allowModelOverride: false,
        },
      ],
    });
    await expect(
      locked.tool.execute(
        'call-locked',
        {
          operation: 'spawn',
          description: 'x',
          prompt: 'x',
          agent_type: 'reviewer',
          model: 'OpenAI/gpt-cheap',
        },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/does not allow custom model/i);
    expect(locked.deps.invoke).not.toHaveBeenCalled();
  });

  it('无可选模型时不暴露 model 参数', () => {
    const { tool } = setup({ models: [] });
    const properties = (tool.parameters as { properties: Record<string, unknown> }).properties;
    expect(properties).not.toHaveProperty('model');
  });

  it('不传 agent_type 时按默认 worker 预检必选模型，不留到 Main 才失败', async () => {
    const { deps, tool } = setup({
      agentTypes: [
        {
          name: 'worker',
          description: 'worker',
          systemPrompt: '',
          tools: 'all',
          allowModelOverride: true,
        },
      ],
    });
    expect(tool.promptGuidelines?.join('\n')).toMatch(/without agent_type.*worker.*model/i);
    await expect(
      tool.execute(
        'call-default-worker',
        { operation: 'spawn', description: 'x', prompt: 'x' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/"worker".*requires a model.*OpenAI\/gpt-cheap/i);
    expect(deps.invoke).not.toHaveBeenCalled();
    await tool.execute(
      'call-default-worker-ok',
      { operation: 'spawn', description: 'x', prompt: 'x', model: 'OpenAI/gpt-cheap' },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'OpenAI/gpt-cheap' }),
      undefined
    );
  });

  it('参数不合法时指出具体字段，Agent 与 Run 身份用错时给出正确字段', async () => {
    const { deps, tool } = setup();
    const run = (params: Record<string, unknown>) =>
      tool.execute('call-invalid', params, undefined, undefined, {} as never);
    await expect(run({ operation: 'wait', agentId: 'agent-1' })).rejects.toThrow(
      /wait.*runId.*not agentId/i
    );
    await expect(run({ operation: 'report', agentId: 'agent-1' })).rejects.toThrow(
      /report.*runId.*not agentId/i
    );
    await expect(run({ operation: 'stop' })).rejects.toThrow(/stop.*runId/i);
    await expect(run({ operation: 'send', runId: 'run-1', message: 'go' })).rejects.toThrow(
      /send.*agentId.*not runId/i
    );
    await expect(run({ operation: 'dismiss', runId: 'run-1' })).rejects.toThrow(
      /dismiss.*agentId.*not runId/i
    );
    await expect(run({ operation: 'send', agentId: 'agent-1', message: ' ' })).rejects.toThrow(
      /message/i
    );
    await expect(
      run({ operation: 'spawn', description: 'x', prompt: 'x', schema: 'not json' })
    ).rejects.toThrow(/schema.*object/i);
    await expect(run({ operation: 'wait', runIds: ['r', 'r'] })).rejects.toThrow(/distinct/i);
    await expect(
      run({ operation: 'spawn', description: 'x', prompt: 'x', gate: 'pnpm test' })
    ).rejects.toThrow(/gate.*commandRef/i);
    await expect(run({ operation: 'nope' })).rejects.toThrow(/operation/i);
    expect(deps.invoke).not.toHaveBeenCalled();
  });

  it('可选字符串传空串视为未传，schema 传 JSON 字符串先解析成对象', async () => {
    const { deps, tool } = setup();
    const run = (params: Record<string, unknown>) =>
      tool.execute('call-lenient', params, undefined, undefined, {} as never);
    await run({
      operation: 'spawn',
      name: '',
      description: 'x',
      prompt: 'x',
      schema: '{"type":"object"}',
    });
    expect(deps.invoke).toHaveBeenLastCalledWith(
      {
        operation: 'spawn',
        mode: 'task',
        description: 'x',
        prompt: 'x',
        wait: false,
        schema: { type: 'object' },
      },
      undefined
    );
    await run({ operation: 'send', agentId: 'a', message: 'go', expectedRunId: '' });
    expect(deps.invoke).toHaveBeenLastCalledWith(
      { operation: 'send', agentId: 'a', message: 'go', delivery: 'auto', wait: false },
      undefined
    );
    await run({ operation: 'list', cursor: '' });
    expect(deps.invoke).toHaveBeenLastCalledWith({ operation: 'list', limit: 20 }, undefined);
  });

  it('wait 超过上限的 timeoutMs 在 schema 校验前截到 10 分钟，不报错', async () => {
    const { tool, deps } = setup();
    expect(
      tool.prepareArguments?.({ operation: 'wait', runId: 'r', timeoutMs: 86_400_000 })
    ).toEqual({ operation: 'wait', runId: 'r', timeoutMs: 600_000 });
    await tool.execute(
      'call-clamp',
      { operation: 'wait', runId: 'r', timeoutMs: 3_600_000 },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.invoke).toHaveBeenCalledWith(
      { operation: 'wait', runIds: ['r'], until: 'all', timeoutMs: 600_000 },
      undefined
    );
  });

  it('插话解除等待：回执带说明，子代理继续跑', async () => {
    const detach = new AbortController();
    let reason: 'steer' | undefined;
    const untrack = vi.fn();
    const { tool } = setup({
      trackWait: () => ({ signal: detach.signal, reason: () => reason, untrack }),
      invoke: vi.fn(
        async (_request, _signal, detachSignal?: AbortSignal) =>
          new Promise<AgentControlToolResponse>((resolve) => {
            detachSignal?.addEventListener('abort', () =>
              resolve({
                ok: true as const,
                value: {
                  runs: [],
                  timedOut: false,
                  interrupted: true,
                  pending: [{ agentId: 'a', runId: 'r', status: 'running', elapsedMs: 1 }],
                },
              })
            );
          })
      ),
    });
    const running = tool.execute(
      'call-steer',
      { operation: 'wait', runId: 'r' },
      undefined,
      undefined,
      {} as never
    );
    reason = 'steer';
    detach.abort();
    const result = await running;
    expect(untrack).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      interrupted: true,
      note: expect.stringContaining('the user sent a new message'),
    });
  });

  it('等待超时回执说明不算失败；不等待的操作不登记', async () => {
    const trackWait = vi.fn();
    const { tool } = setup({
      trackWait,
      invoke: vi.fn(async () => ({
        ok: true as const,
        value: {
          agentId: 'a',
          runId: 'r',
          report: { runs: [], timedOut: true, interrupted: false },
        },
      })),
    });
    trackWait.mockReturnValue({
      signal: new AbortController().signal,
      reason: () => undefined,
      untrack: () => {},
    });
    const waited = await tool.execute(
      'call-timeout',
      { operation: 'send', agentId: 'a', message: 'go', wait: true },
      undefined,
      undefined,
      {} as never
    );
    expect(waited.details).toMatchObject({ note: expect.stringContaining('not a failure') });
    await tool.execute(
      'call-async',
      { operation: 'send', agentId: 'a', message: 'go' },
      undefined,
      undefined,
      {} as never
    );
    expect(trackWait).toHaveBeenCalledTimes(1);
  });
});
