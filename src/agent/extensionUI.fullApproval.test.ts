import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  ExtensionRunner,
  ExtensionToolContext,
  ExtensionUIContext,
  RegisteredTool,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { ApprovalMode, AskRequestInfo } from '@shared/types/agent';
import { afterEach, describe, expect, it } from 'vitest';
import { AskManager } from './ask';
import { bindExtensionUI } from './extensionUI';

const APP_QUESTION = 'Allow Computer Use to use "TextEdit"?';
const APP_CHOICES = ['Allow once', 'Allow for this session', 'Always allow', 'Decline'];

interface ApprovalBridge {
  prepareTool(toolName: string): void;
  approvalModeChanged(): void;
}

// The new signature is intentional; keep these tests compilable before and after the API lands.
const bind = bindExtensionUI as unknown as (
  runner: ExtensionRunner,
  asks: AskManager,
  isCurrent: () => boolean,
  options: {
    approvalMode: () => ApprovalMode;
    lcuExtensionPath: string;
    getToolDefinition?: (name: string) => ToolDefinition | undefined;
    requiresConfirmation?: () => boolean;
  }
) => ApprovalBridge | undefined;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function flushPromises() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function harness(initialMode: ApprovalMode = 'full', checkExecutedDefinition = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'enso-lcu-approval-'));
  const installed = path.join(root, 'installed', 'extension.mjs');
  const unrelated = path.join(root, 'other', 'extension.mjs');
  mkdirSync(path.dirname(installed));
  mkdirSync(path.dirname(unrelated));
  writeFileSync(installed, '// trusted fixture');
  writeFileSync(unrelated, '// unrelated fixture');
  const alias = path.join(root, 'installed-alias.ts');
  symlinkSync(installed, alias);
  const canonicalInstalled = realpathSync(installed);
  let current = true;
  let mode = initialMode;
  let protectedFloor = false;
  const requests: AskRequestInfo[] = [];
  const resolved: string[] = [];
  const asks = new AskManager(
    (info) => {
      requests.push(info);
    },
    (id) => resolved.push(id)
  );
  const tools: RegisteredTool[] = [];
  const executedDefinitions = new Map<string, ToolDefinition>();
  const pending: Promise<unknown>[] = [];
  const noop = () => undefined;
  let ui = new Proxy(
    {
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
    },
    { get: (target, key) => Reflect.get(target, key) ?? noop }
  ) as unknown as ExtensionUIContext;
  const runner = {
    getUIContext: () => ui,
    setUIContext: (next: ExtensionUIContext) => {
      ui = next;
    },
    getAllRegisteredTools: () => tools,
  } as unknown as ExtensionRunner;
  const bridge = bind(runner, asks, () => current, {
    approvalMode: () => mode,
    lcuExtensionPath: canonicalInstalled,
    requiresConfirmation: () => protectedFloor,
    ...(checkExecutedDefinition
      ? { getToolDefinition: (name: string) => executedDefinitions.get(name) }
      : {}),
  });

  function addTool(
    name = 'js',
    sourcePath = canonicalInstalled,
    label = `LCU ${name}`,
    executeOverride?: ToolDefinition['execute']
  ) {
    const definition: ToolDefinition = {
      name,
      label,
      description: 'Fixture that asks through the execution context supplied by the SDK.',
      parameters: { type: 'object', properties: {} } as ToolDefinition['parameters'],
      async execute(_id, params, signal, _update, context) {
        const { question, choices } = params as { question: string; choices: string[] };
        const choice = await context.ui.select(question, choices, { signal });
        return { content: [], details: { choice } };
      },
    };
    if (executeOverride) definition.execute = executeOverride;
    const previous = tools.findIndex((tool) => tool.definition.name === name);
    if (previous !== -1) tools.splice(previous, 1);
    tools.push({
      definition,
      sourceInfo: { path: sourcePath, source: 'fixture', scope: 'temporary', origin: 'top-level' },
    });
    executedDefinitions.set(name, definition);
    // Like the SDK tool wrapper, dereference execute at call time, not registration time.
    const dispatch = (
      question = APP_QUESTION,
      choices = [...APP_CHOICES],
      signal?: AbortSignal
    ) => {
      bridge?.prepareTool(name);
      const result = (executedDefinitions.get(name) ?? definition)
        .execute('fixture-call', { question, choices }, signal, undefined, {
          ui,
          hasUI: true,
          mode: 'rpc',
          cwd: root,
        } as ExtensionToolContext)
        .then((result) => (result.details as { choice: string | undefined }).choice);
      pending.push(result);
      return result;
    };
    return Object.assign(dispatch, { definition });
  }

  cleanups.push(async () => {
    asks.cancelAll();
    await Promise.allSettled(pending);
    rmSync(root, { recursive: true, force: true });
    // Every emitted card is closed exactly once, including cancelled/failing tests.
    expect([...resolved].sort()).toEqual(requests.map((request) => request.requestId).sort());
    expect(new Set(resolved).size).toBe(resolved.length);
    expect(asks.snapshot()).toEqual([]);
  });
  return {
    asks,
    requests,
    resolved,
    bridge,
    addTool,
    unrelated,
    alias,
    overrideExecuted: (name: string, definition: ToolDefinition) => {
      executedDefinitions.set(name, definition);
    },
    get ui() {
      return ui;
    },
    expire: () => {
      current = false;
    },
    setMode: (next: ApprovalMode) => {
      mode = next;
      bridge?.approvalModeChanged();
    },
    setProtectedFloor: (value: boolean) => {
      protectedFloor = value;
    },
  };
}

function answer(h: ReturnType<typeof harness>, choice: string, index = h.requests.length - 1) {
  const request = h.requests[index];
  expect(request).toBeDefined();
  h.asks.respond(request.requestId, choice);
}

async function expectAutoOnce(h: ReturnType<typeof harness>, result: Promise<string | undefined>) {
  let settled = false;
  void result.then(() => {
    settled = true;
  });
  await flushPromises();
  expect(h.asks.snapshot(), 'trusted app authorization must not create a manual card').toEqual([]);
  expect(settled, 'trusted app authorization must resolve without a human answer').toBe(true);
  await expect(result).resolves.toBe('Allow once');
}

describe('LCU full 审批仅作用于可信工具执行上下文', () => {
  it('full 下通用 select 仍保留原始选项并且只接受人工选择', async () => {
    const h = harness();
    const result = h.ui.select(APP_QUESTION, [...APP_CHOICES]);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]).toMatchObject({
      question: APP_QUESTION,
      options: APP_CHOICES,
      selectionOnly: true,
    });
    answer(h, 'Decline');
    await expect(result).resolves.toBe('Decline');
    expect(h.resolved).toEqual([h.requests[0].requestId]);
  });

  it('full 下通用 confirm 仍需人工确认', async () => {
    const h = harness();
    const result = h.ui.confirm('确认', APP_QUESTION);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].options).toContain('Allow');
    answer(h, 'Allow');
    await expect(result).resolves.toBe(true);
    expect(h.resolved).toEqual([h.requests[0].requestId]);
  });

  it('返回工具准备和实时审批模式通知接口', () => {
    const h = harness();
    expect(h.bridge).toEqual({
      prepareTool: expect.any(Function),
      approvalModeChanged: expect.any(Function),
    });
  });

  it.each(['js', 'js_reset'])(
    'full 对可信 %s 原生应用授权只返回 Allow once，不发卡片',
    async (name) => {
      const h = harness();
      await expectAutoOnce(h, h.addTool(name)());
      expect(h.requests).toEqual([]);
      expect(h.resolved).toEqual([]);
    }
  );

  it('可信来源使用规范化文件身份而不是未经解析的路径拼写', async () => {
    const h = harness();
    await expectAutoOnce(h, h.addTool('js', h.alias)());
    expect(h.requests).toEqual([]);
  });

  it.each([
    ['Allow once', 'Decline'],
    ['Allow once', 'Allow for this session', 'Decline'],
    ['Allow once', 'Always allow', 'Decline'],
  ])('原生可选 session/always 标签缺省仍只授权一次（变体 %#）', async (...choices) => {
    const h = harness();
    await expectAutoOnce(h, h.addTool()(APP_QUESTION, choices));
  });

  it.each<ApprovalMode>(['supervised', 'assistant', 'auto-edits'])(
    '%s 对可信应用授权保持原始人工选项',
    async (mode) => {
      const h = harness(mode);
      const result = h.addTool()();
      expect(h.requests).toHaveLength(1);
      expect(h.requests[0]).toMatchObject({ options: APP_CHOICES, selectionOnly: true });
      answer(h, 'Allow for this session');
      await expect(result).resolves.toBe('Allow for this session');
      expect(h.resolved).toEqual([h.requests[0].requestId]);
    }
  );

  it('同名同标签但来源不是已安装 LCU 的工具不能借用 full 授权', async () => {
    const h = harness();
    const result = h.addTool('js', h.unrelated)();
    expect(h.requests).toHaveLength(1);
    answer(h, 'Decline');
    await expect(result).resolves.toBe('Decline');
  });

  it('可信扩展的其他工具即使问题完全相同也必须人工选择', async () => {
    const h = harness();
    const result = h.addTool('unrelated_tool')();
    expect(h.requests).toHaveLength(1);
    answer(h, 'Decline');
    await expect(result).resolves.toBe('Decline');
  });

  it('可信 js 缺少 LCU js 标签仍然人工选择', async () => {
    const h = harness();
    const result = h.addTool('js', undefined, 'Other js')();
    expect(h.requests).toHaveLength(1);
    answer(h, 'Decline');
    await expect(result).resolves.toBe('Decline');
  });

  it('实际会话执行定义匹配可信注册定义时才自动授权', async () => {
    const h = harness('full', true);
    await expectAutoOnce(h, h.addTool()());
  });

  it('会话实际执行定义被覆盖时，即使注册列表可信也不能自动授权', async () => {
    const h = harness('full', true);
    const trusted = h.addTool();
    const other = h.addTool('other', h.unrelated);
    h.overrideExecuted('js', other.definition);
    const result = trusted();
    expect(h.requests).toHaveLength(1);
    answer(h, 'Decline');
    await expect(result).resolves.toBe('Decline');
  });

  it('工具重新注册后重新核验来源，不继承旧可信定义的 full 权限', async () => {
    const h = harness();
    await expectAutoOnce(h, h.addTool()());
    const replacement = h.addTool('js', h.unrelated);
    const result = replacement();
    expect(h.requests).toHaveLength(1);
    answer(h, 'Decline');
    await expect(result).resolves.toBe('Decline');
  });

  it('可信工具 execute 返回后泄漏的 context 不再自动授权', async () => {
    const h = harness();
    let captured: ExtensionToolContext | undefined;
    const execute = h.addTool(
      'js',
      undefined,
      undefined,
      async (_id, _params, _signal, _update, ctx) => {
        captured = ctx;
        return { content: [], details: { choice: undefined } };
      }
    );
    await execute();
    expect(captured).toBeDefined();
    const late = captured!.ui.select(APP_QUESTION, [...APP_CHOICES]);
    let settled = false;
    void late.then(() => {
      settled = true;
    });
    await flushPromises();
    if (h.requests.length > 0) {
      expect(h.requests).toHaveLength(1);
      answer(h, 'Decline');
      await expect(late).resolves.toBe('Decline');
    } else {
      expect(settled, 'inactive tool contexts may cancel, never hang or authorize').toBe(true);
      await expect(late).resolves.toBeUndefined();
    }
  });

  it.each<ApprovalMode>(['full', 'supervised'])(
    '并行 LCU 较后调用已结束但较早调用仍待授权时，%s 不误取消',
    async (mode) => {
      const h = harness(mode);
      const held = Promise.withResolvers<void>();
      let captured: ExtensionToolContext | undefined;
      const execute = h.addTool(
        'js',
        undefined,
        undefined,
        async (_id, params, _signal, _update, ctx) => {
          captured = ctx;
          if ((params as { question: string }).question === 'hold') await held.promise;
          return { content: [], details: { choice: undefined } };
        }
      );
      const first = execute('hold');
      try {
        await execute('short');
        const approval = captured!.ui.select(APP_QUESTION, [...APP_CHOICES]);
        if (mode === 'full') {
          await expectAutoOnce(h, approval);
        } else {
          expect(h.requests).toHaveLength(1);
          answer(h, 'Decline');
          await expect(approval).resolves.toBe('Decline');
        }
      } finally {
        held.resolve();
        await first;
      }
    }
  );

  it.each([
    ['Allow Computer Use to access "https://example.com"?', APP_CHOICES],
    ['Which browser should Computer Use open?', ['Safari', 'Chrome']],
    ['An unrelated extension question?', APP_CHOICES],
    ['Allow Computer Use to use TextEdit?', APP_CHOICES],
    [APP_QUESTION, ['Allow once', 'Always allow', 'Allow for this session', 'Decline']],
    [APP_QUESTION, ['Allow once', 'Unknown permission', 'Decline']],
    [APP_QUESTION, ['Allow once', 'Allow this conversation', 'Always allow', 'Deny']],
    [`Prefix ${APP_QUESTION}`, APP_CHOICES],
    [`${APP_QUESTION} suffix`, APP_CHOICES],
  ])('可信 js 的非原生精确问题仍人工选择：%s', async (question, choices) => {
    const h = harness();
    const result = h.addTool()(question as string, choices as string[]);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]).toMatchObject({ question, options: choices, selectionOnly: true });
    answer(h, choices[choices.length - 1]);
    await expect(result).resolves.toBe(choices[choices.length - 1]);
  });

  it('full 的重复授权从不缓存 session/always，降档后相同应用重新发卡片', async () => {
    const h = harness();
    const execute = h.addTool();
    await expectAutoOnce(h, execute());
    await expectAutoOnce(h, execute());
    expect(h.requests).toEqual([]);
    h.setMode('supervised');
    const manual = execute();
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].options).toEqual(APP_CHOICES);
    answer(h, 'Decline');
    await expect(manual).resolves.toBe('Decline');
  });

  it('预先 abort 的可信授权不自动允许，也不发卡片', async () => {
    const h = harness();
    await expect(
      h.addTool()(APP_QUESTION, [...APP_CHOICES], AbortSignal.abort())
    ).resolves.toBeUndefined();
    expect(h.requests).toEqual([]);
  });

  it('旧代可信授权不自动允许，也不发卡片', async () => {
    const h = harness();
    const execute = h.addTool();
    h.expire();
    await expect(execute()).resolves.toBeUndefined();
    expect(h.requests).toEqual([]);
  });

  it('自动选择返回前代次失效时丢弃迟到授权', async () => {
    const h = harness();
    const result = h.addTool()();
    h.expire();
    h.asks.cancelAll();
    await expect(result).resolves.toBeUndefined();
  });

  it('切 full 仅结算可信待选应用，移除卡片且保留通用同文案选择和普通 ask', async () => {
    const h = harness('supervised');
    const trusted = h.addTool()();
    const generic = h.ui.select(APP_QUESTION, [...APP_CHOICES]);
    const ordinary = h.asks.ask('普通用户问题', ['A', 'B']);
    // Keep failure cleanup from producing an unrelated unhandled rejection.
    void ordinary.catch(() => undefined);
    expect(h.requests).toHaveLength(3);
    const [trustedCard, genericCard, ordinaryCard] = h.requests;
    h.setMode('full');
    h.setMode('full');
    await flushPromises();
    expect(h.asks.snapshot().map((request) => request.requestId)).toEqual([
      genericCard.requestId,
      ordinaryCard.requestId,
    ]);
    expect(h.resolved).toEqual([trustedCard.requestId]);
    await expect(trusted).resolves.toBe('Allow once');
    answer(h, 'Decline', 1);
    answer(h, 'B', 2);
    await expect(generic).resolves.toBe('Decline');
    await expect(ordinary).resolves.toBe('B');
    expect(h.resolved).toEqual(h.requests.map((request) => request.requestId));
  });

  it('切 full 后再降档，后续问题必须重新人工选择', async () => {
    const h = harness('supervised');
    const execute = h.addTool();
    const first = execute();
    h.setMode('full');
    await expectAutoOnce(h, first);
    expect(h.resolved).toEqual([h.requests[0].requestId]);
    h.setMode('auto-edits');
    const second = execute();
    expect(h.requests).toHaveLength(2);
    expect(h.asks.snapshot()).toEqual([h.requests[1]]);
    answer(h, 'Decline');
    await expect(second).resolves.toBe('Decline');
  });

  it('用户先拒绝再同 tick 切 full，不能覆盖已经提交的拒绝', async () => {
    const h = harness('supervised');
    const result = h.addTool()();
    expect(h.requests).toHaveLength(1);
    answer(h, 'Decline');
    h.setMode('full');
    await expect(result).resolves.toBe('Decline');
    expect(h.resolved).toEqual([h.requests[0].requestId]);
    expect(h.asks.snapshot()).toEqual([]);
  });

  it('受保护动作底线开启时 full 也保留真人应用授权', async () => {
    const h = harness();
    h.setProtectedFloor(true);
    const result = h.addTool()();
    expect(h.requests).toHaveLength(1);
    answer(h, 'Decline');
    await expect(result).resolves.toBe('Decline');
  });

  it('待选卡自动结算后立即降档，尚未交付的自动允许失效', async () => {
    const h = harness('supervised');
    const result = h.addTool()();
    h.setMode('full');
    h.setMode('supervised');
    await expect(result).resolves.toBeUndefined();
    expect(h.resolved).toHaveLength(1);
  });

  it.each(['abort', 'cancel', 'stale'] as const)(
    '待选请求 %s 后切 full 仍 fail-closed，且只清理一次',
    async (guard) => {
      const h = harness('supervised');
      const controller = new AbortController();
      const result = h.addTool()(APP_QUESTION, [...APP_CHOICES], controller.signal);
      expect(h.requests).toHaveLength(1);
      if (guard === 'abort') controller.abort();
      if (guard === 'cancel') h.asks.cancelAll();
      if (guard === 'stale') h.expire();
      h.setMode('full');
      // A generation shutdown also closes its outstanding human cards.
      h.asks.cancelAll();
      await expect(result).resolves.toBeUndefined();
      expect(h.asks.snapshot()).toEqual([]);
      expect(h.resolved).toEqual([h.requests[0].requestId]);
    }
  );
});
