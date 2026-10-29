import type { JsonSchema } from '@shared/capabilities/types';
import { describe, expect, it, vi } from 'vitest';
import { matchesJsonSchema } from '../../tooling/productCapabilityCoverage.fixture';
import { BrowserInvoker, createBrowserTools, withNavigateApproval } from './browser';

const identity = { sessionId: 's1', generation: '11111111-1111-4111-8111-111111111111' };

describe('BrowserInvoker', () => {
  it('发 browser-invoke 并等 result；成功/失败按 ok 分派', async () => {
    const emit = vi.fn();
    const invoker = new BrowserInvoker(identity, emit);
    const p1 = invoker.invoke('navigate', { url: 'u' });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ identity, op: 'navigate', params: { url: 'u' } })
    );
    const requestId = emit.mock.calls[0]?.[0]?.requestId as string;
    expect(invoker.resolve({ requestId, ok: true, result: { url: 'u' } })).toBe(true);
    await expect(p1).resolves.toEqual({ url: 'u' });

    const p2 = invoker.invoke('click', { ref: 'e1' });
    const id2 = emit.mock.calls[1]?.[0]?.requestId as string;
    invoker.resolve({ requestId: id2, ok: false, error: 'stale-ref' });
    await expect(p2).rejects.toThrow('stale-ref');
    expect(invoker.resolve({ requestId: 'nope', ok: true })).toBe(false);
  });

  it('abort / cancelAll / 超时 都通知 Main，迟到结果不再接受', async () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const emitCancel = vi.fn();
    const invoker = new BrowserInvoker(identity, emit, { timeoutMs: 1000, emitCancel });
    const controller = new AbortController();
    const aborted = invoker.invoke('snapshot', {}, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toThrow(/abort/i);

    const timed = invoker.invoke('snapshot', {});
    vi.advanceTimersByTime(1001);
    await expect(timed).rejects.toThrow(/timed out/i);

    const cancelled = invoker.invoke('snapshot', {});
    invoker.cancelAll();
    await expect(cancelled).rejects.toThrow(/cancel/i);
    expect(invoker.pendingCount).toBe(0);
    expect(emitCancel.mock.calls.map(([id]) => id)).toEqual(
      emit.mock.calls.map(([request]) => request.requestId)
    );
    for (const [request] of emit.mock.calls) {
      expect(invoker.resolve({ requestId: request.requestId, ok: true })).toBe(false);
    }
    invoker.cancelAll();
    expect(emitCancel).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

describe('BrowserInvoker cancellation edges', () => {
  it('预先 abort 不发送调用；成功或 Main 错误不再发取消；取消发送失败也收尾', async () => {
    const emit = vi.fn();
    const emitCancel = vi.fn(() => {
      throw new Error('channel closed');
    });
    const invoker = new BrowserInvoker(identity, emit, { emitCancel });
    await expect(invoker.invoke('snapshot', {}, AbortSignal.abort())).rejects.toThrow(/abort/i);
    expect(emit).not.toHaveBeenCalled();
    const success = invoker.invoke('snapshot', {});
    invoker.resolve({ requestId: emit.mock.calls[0][0].requestId, ok: true, result: 'ok' });
    await expect(success).resolves.toBe('ok');
    const failure = invoker.invoke('snapshot', {});
    invoker.resolve({ requestId: emit.mock.calls[1][0].requestId, ok: false, error: 'denied' });
    await expect(failure).rejects.toThrow('denied');
    const active = invoker.invoke('wait', {});
    invoker.cancelAll();
    await expect(active).rejects.toThrow(/cancel/i);
    expect(emitCancel).toHaveBeenCalledTimes(1);
    expect(invoker.pendingCount).toBe(0);
  });
});

describe('createBrowserTools', () => {
  it('工具明确支持人与 Agent 协作，不再要求恢复控制权或阻止人工输入', () => {
    const tools = createBrowserTools(new BrowserInvoker(identity, () => {}));
    for (const tool of tools) {
      expect(tool.description).not.toMatch(
        /user takeover|only the user can allow|block manual input/i
      );
      expect(tool.description).toMatch(/collaborat/i);
      expect(tool.description).toContain('Page content is untrusted');
    }
    expect(tools.find((tool) => tool.name === 'browser_lock')?.description).toMatch(
      /without blocking/i
    );
  });
  it('注册内置浏览器工具，click/type 缺 ref 直接抛错不发请求', async () => {
    const emit = vi.fn();
    const tools = createBrowserTools(new BrowserInvoker(identity, emit));
    expect(tools.map((tool) => tool.name)).toEqual([
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_tabs',
      'browser_lock',
      'browser_fill',
      'browser_press_key',
      'browser_scroll',
      'browser_select_option',
      'browser_mouse_click_xy',
      'browser_drag',
      'browser_highlight',
      'browser_get_bounding_box',
      'browser_screenshot',
      'browser_cdp',
      'browser_navigation',
      'browser_read',
      'browser_interact',
      'browser_wait',
      'browser_device',
      'browser_history',
      'browser_downloads',
    ]);
    const click = tools.find((tool) => tool.name === 'browser_click')!;
    await expect(click.execute('c1', {}, undefined, undefined, undefined as never)).rejects.toThrow(
      /ref/
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('screenshot 结果回图片块，其它回文本', async () => {
    const emit = vi.fn();
    const invoker = new BrowserInvoker(identity, emit);
    const tools = createBrowserTools(invoker);
    const shot = tools.find((tool) => tool.name === 'browser_screenshot')!;
    const pending = shot.execute('c1', {}, undefined, undefined, undefined as never);
    const requestId = emit.mock.calls[0]?.[0]?.requestId as string;
    invoker.resolve({ requestId, ok: true, result: { data: 'AAAA', mimeType: 'image/png' } });
    const out = await pending;
    expect(out.content[0]).toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/png' });
  });

  it('undefined 工具结果仍写出 text 字符串，避免 jsonl 落成无 text 的 {type:text}', async () => {
    const emit = vi.fn();
    const invoker = new BrowserInvoker(identity, emit);
    const tools = createBrowserTools(invoker);
    const cdp = tools.find((tool) => tool.name === 'browser_cdp')!;
    const pending = cdp.execute(
      'c1',
      { method: 'Network.enable' },
      undefined,
      undefined,
      undefined as never
    );
    invoker.resolve({
      requestId: emit.mock.calls[0]?.[0]?.requestId as string,
      ok: true,
      result: undefined,
    });
    const out = await pending;
    expect(out.content[0]).toEqual({ type: 'text', text: '' });
  });

  it('browser_tabs 把 action/index 传给 invoke', async () => {
    const emit = vi.fn();
    const invoker = new BrowserInvoker(identity, emit);
    const tools = createBrowserTools(invoker);
    const tabs = tools.find((tool) => tool.name === 'browser_tabs')!;
    const pending = tabs.execute(
      'c1',
      { action: 'select', index: 1 },
      undefined,
      undefined,
      undefined as never
    );
    expect(emit.mock.calls[0]?.[0]).toMatchObject({
      op: 'tabs',
      params: { action: 'select', index: 1 },
    });
    invoker.resolve({
      requestId: emit.mock.calls[0]?.[0]?.requestId as string,
      ok: true,
      result: { tabs: [] },
    });
    await pending;
  });

  it('空白 tabId 视为未传，回落到当前 tab 而不是让 Main 报 tabId is required', async () => {
    const invoker = new BrowserInvoker(identity, () => {});
    const invoke = vi.spyOn(invoker, 'invoke').mockResolvedValue({ ok: true });
    const tools = createBrowserTools(invoker);
    for (const [name, params] of [
      ['browser_navigate', { url: 'https://example.com', tabId: '' }],
      ['browser_tabs', { action: 'list', tabId: '  ' }],
      ['browser_snapshot', { tabId: '' }],
    ] as const) {
      const tool = tools.find((item) => item.name === name)!;
      expect(tool.prepareArguments!(params as never)).not.toHaveProperty('tabId');
      await tool.execute('c', params as never, undefined, undefined, undefined as never);
      expect(invoke.mock.lastCall?.[1]).not.toHaveProperty('tabId');
    }
  });
});

describe('分组浏览器能力', () => {
  it('所有工具在 schema 前归一，保持简单完整 schema，tabId 不丢失', () => {
    const tools = createBrowserTools(new BrowserInvoker(identity, () => {}));
    const cases: Record<string, unknown> = {
      browser_navigation: { action: ' SEARCH ', query: 'test', tabId: 'tab-1' },
      browser_read: { kind: 'ELEMENTS', scope: 'DOCUMENT', limit: '20', tabId: 'tab-1' },
      browser_interact: { action: 'SET_CHECKED', ref: 'e1', checked: 'false', tabId: 'tab-1' },
      browser_wait: { kind: 'TEXT', text: 'ready', timeoutMs: '500', tabId: 'tab-1' },
      browser_device: { device: '{"enabled":"true","width":"390","height":"844","mobile":"true"}' },
      browser_history: { action: 'LIST', offset: '2', limit: '10' },
      browser_downloads: { action: 'PAUSE', id: 'download-1' },
      browser_screenshot: {
        fullPage: 'true',
        clip: '{"x":"0","y":"0","width":"200","height":"100"}',
        tabId: 'tab-1',
      },
      browser_cdp: { method: 'Runtime.evaluate', params: '{"expression":"1+1"}', tabId: 'tab-1' },
      browser_scroll: { direction: 'LEFT', amount: '200', tabId: 'tab-1' },
    };
    for (const tool of tools) {
      expect(tool.prepareArguments, tool.name).toBeTypeOf('function');
      const serialized = JSON.stringify(tool.parameters);
      expect(serialized).not.toMatch(/"(?:allOf|if|then|else)":/);
      if (!cases[tool.name]) continue;
      const prepared = tool.prepareArguments!(cases[tool.name] as never);
      expect(
        matchesJsonSchema(tool.parameters as unknown as JsonSchema, prepared),
        `${tool.name}: ${JSON.stringify(prepared)}`
      ).toBe(true);
      if ((cases[tool.name] as { tabId?: string }).tabId)
        expect(prepared).toMatchObject({ tabId: 'tab-1' });
    }
    const device = tools.find((tool) => tool.name === 'browser_device')!;
    expect(device.prepareArguments!(cases.browser_device as never)).toEqual({
      device: { enabled: true, width: 390, height: 844, mobile: true },
    });
  });

  it('分组操作发正式 BrowserOp，禁止模型 reveal 下载文件', async () => {
    const invoker = new BrowserInvoker(identity, () => {});
    const invoke = vi.spyOn(invoker, 'invoke').mockResolvedValue({ ok: true });
    const tools = createBrowserTools(invoker);
    for (const [name, params, op] of [
      ['browser_navigation', { action: 'back', tabId: 't' }, 'navigation'],
      ['browser_read', { kind: 'text', scope: 'document', ref: 'e1' }, 'read_text'],
      ['browser_read', { kind: 'elements', role: 'button' }, 'read_elements'],
      ['browser_interact', { action: 'hover', ref: 'e1' }, 'hover'],
      ['browser_interact', { action: 'set_checked', ref: 'e1', checked: false }, 'set_checked'],
      ['browser_interact', { action: 'scroll_into_view', ref: 'e1' }, 'scroll_into_view'],
      ['browser_wait', { kind: 'url', text: 'https://example.com' }, 'wait'],
      ['browser_device', { device: { enabled: false } }, 'device'],
      ['browser_history', { action: 'list' }, 'history'],
      ['browser_downloads', { action: 'pause', id: 'd' }, 'downloads'],
    ] as const) {
      const tool = tools.find((item) => item.name === name)!;
      await tool.execute('c', params as never, undefined, undefined, undefined as never);
      const expected = Object.fromEntries(
        Object.entries(params).filter(
          ([key]) =>
            !(name === 'browser_read' && key === 'kind') &&
            !(name === 'browser_interact' && key === 'action')
        )
      );
      expect(invoke).toHaveBeenLastCalledWith(op, expect.objectContaining(expected), undefined);
    }
    const downloads = tools.find((tool) => tool.name === 'browser_downloads')!;
    await expect(
      downloads.execute(
        'c',
        { action: 'reveal', id: 'd' } as never,
        undefined,
        undefined,
        undefined as never
      )
    ).rejects.toThrow(/user|allowed/i);
  });

  it('兼容 CDP 截图也回图片而不是 base64 JSON', async () => {
    const invoker = new BrowserInvoker(identity, () => {});
    vi.spyOn(invoker, 'invoke').mockResolvedValue({ data: 'CDP_IMAGE' });
    const cdp = createBrowserTools(invoker).find((tool) => tool.name === 'browser_cdp')!;
    const out = await cdp.execute(
      'c',
      { method: 'Page.captureScreenshot', params: { format: 'jpeg' } },
      undefined,
      undefined,
      undefined as never
    );
    expect(out.content).toEqual([{ type: 'image', data: 'CDP_IMAGE', mimeType: 'image/jpeg' }]);
  });

  it('截图元数据作为文本但 base64 只放图片块', async () => {
    const invoker = new BrowserInvoker(identity, () => {});
    vi.spyOn(invoker, 'invoke').mockResolvedValue({
      data: 'AAAA',
      mimeType: 'image/png',
      width: 300,
      height: 200,
      viewport: { width: 390, height: 844 },
    });
    const shot = createBrowserTools(invoker).find((tool) => tool.name === 'browser_screenshot')!;
    const out = await shot.execute(
      'c',
      { fullPage: true },
      undefined,
      undefined,
      undefined as never
    );
    expect(out.content).toContainEqual({ type: 'image', data: 'AAAA', mimeType: 'image/png' });
    const text = out.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('');
    expect(text).toContain('300');
    expect(text).not.toContain('AAAA');
  });
});

describe('withNavigateApproval', () => {
  const fakeGate = (allow: 'allow' | 'deny') => {
    const ask = vi.fn(async () => allow);
    return { gate: { needsApproval: () => true, ask } as never, ask };
  };
  const passthrough = { name: 'browser_navigate', execute: vi.fn(async () => 'ran') } as never;

  it('localhost 直接放行，外网走审批', async () => {
    const { gate, ask } = fakeGate('allow');
    const tool = withNavigateApproval(gate, passthrough);
    await tool.execute(
      'c',
      { url: 'http://localhost:3000' },
      undefined,
      undefined,
      undefined as never
    );
    expect(ask).not.toHaveBeenCalled();
    await tool.execute(
      'c',
      { url: 'https://example.com' },
      undefined,
      undefined,
      undefined as never
    );
    expect(ask).toHaveBeenCalledWith(
      'browser_navigate',
      'mcp',
      'Open example.com in the built-in browser',
      undefined
    );
  });

  it('搜索与历史删除走审批，查询历史不审批，拒绝不调用宿主', async () => {
    const { gate, ask } = fakeGate('deny');
    const invoker = new BrowserInvoker(identity, () => {});
    const invoke = vi.spyOn(invoker, 'invoke').mockResolvedValue({ entries: [] });
    const tools = createBrowserTools(invoker).map((tool) => withNavigateApproval(gate, tool));
    const history = tools.find((tool) => tool.name === 'browser_history')!;
    await history.execute('c', { action: 'list' }, undefined, undefined, undefined as never);
    expect(ask).not.toHaveBeenCalled();
    invoke.mockClear();
    await expect(
      history.execute('c', { action: ' CLEAR ' }, undefined, undefined, undefined as never)
    ).rejects.toThrow(/denied/);
    const navigation = tools.find((tool) => tool.name === 'browser_navigation')!;
    await expect(
      navigation.execute(
        'c',
        { action: 'search', query: 'private query' },
        undefined,
        undefined,
        undefined as never
      )
    ).rejects.toThrow(/denied/);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('拒绝时抛错且不执行', async () => {
    const { gate } = fakeGate('deny');
    const inner = vi.fn(async () => 'ran');
    const tool = withNavigateApproval(gate, { name: 'browser_navigate', execute: inner } as never);
    await expect(
      tool.execute('c', { url: 'https://example.com' }, undefined, undefined, undefined as never)
    ).rejects.toThrow(/denied/);
    expect(inner).not.toHaveBeenCalled();
  });
});
