import type { PluginInspectEntry } from '@shared/browser/inspection';
import type { PluginBrowserBridgeInput } from '@shared/extensionPlugins/browserBridge';
import { describe, expect, it, vi } from 'vitest';
import {
  createPluginBrowserBridge,
  type PluginBrowserAuthorizeResult,
  type PluginBrowserBridgeDeps,
  type PluginBrowserRunInput,
} from './pluginBrowserBridge';

const input = (patch: Partial<PluginBrowserBridgeInput> = {}): PluginBrowserBridgeInput => ({
  sessionId: 's1',
  projectRoot: '/repo',
  sessionGeneration: 'g1',
  op: 'snapshot',
  params: { tabId: 'browser:1' },
  domains: ['example.com'],
  signal: new AbortController().signal,
  ...patch,
});

const entry = (patch: Partial<PluginInspectEntry> = {}): PluginInspectEntry => ({
  tag: 'input',
  text: '',
  value: '',
  rect: { x: 1, y: 2, width: 3, height: 4 },
  ...patch,
});

function setup(
  patch: Partial<PluginBrowserBridgeDeps> & { authorize?: PluginBrowserAuthorizeResult } = {}
) {
  const runs: PluginBrowserRunInput[] = [];
  const inspects: { tabId: string; selector: string }[] = [];
  const urls = new Map<string, string | null>([['browser:1', 'https://example.com/app']]);
  const deps: PluginBrowserBridgeDeps = {
    authorizeSession: () => patch.authorize ?? { ok: true, sessionKey: 's1' },
    isSessionCurrent: () => true,
    authoritativeUrl: (sessionKey, tabId) => {
      expect(sessionKey).toBe('s1');
      return urls.get(tabId) ?? null;
    },
    currentTabId: () => 'browser:1',
    run: async (run) => {
      runs.push(run);
      return { url: 'https://example.com/app', title: 'App', tabId: 'browser:1' };
    },
    inspect: async (inspect) => {
      inspects.push({ tabId: inspect.tabId, selector: inspect.selector });
      return [entry()];
    },
    ...patch,
  };
  return { invoke: createPluginBrowserBridge(deps), runs, inspects, urls };
}

describe('pluginBrowserInvoke（真实 Main 桥）', () => {
  it('SSO中断导航不重放，按Host返回的本次固定tab等待并完成读取', async () => {
    const { invoke, runs, urls } = setup({
      run: async (run) => {
        runs.push(run);
        if (run.op === 'navigate')
          throw Object.assign(new Error('navigation interrupted'), {
            code: 'NAVIGATION_INTERRUPTED',
            tabId: 'browser:1',
          });
        return { text: '需求', url: 'https://www.kdocs.cn/l/demo' };
      },
    });
    urls.set('browser:1', 'https://www.kdocs.cn/l/demo');
    await expect(
      invoke(
        input({
          kind: 'ui',
          op: 'read_range',
          params: { url: 'https://www.kdocs.cn/l/demo', address: 'A1:L201' },
          domains: ['www.kdocs.cn'],
        })
      )
    ).resolves.toMatchObject({ text: '需求', tabId: 'browser:1' });
    expect(runs.map((run) => run.op)).toEqual(['navigate', 'plugin_read_wps_range']);
  });
  it('导航刚返回的短暂空白只读等待，不重开网页或提前输入；稳定后仍复查固定文档', async () => {
    let reads = 0;
    const { invoke, runs } = setup({
      authoritativeUrl: () => (++reads < 3 ? 'about:blank' : 'https://www.kdocs.cn/l/demo'),
    });
    await expect(
      invoke(
        input({
          kind: 'ui',
          op: 'read_range',
          params: { url: 'https://www.kdocs.cn/l/demo', address: 'A1:L201' },
          domains: ['www.kdocs.cn'],
        })
      )
    ).resolves.toMatchObject({ tabId: 'browser:1' });
    expect(runs.map((run) => run.op)).toEqual(['navigate', 'plugin_read_wps_range']);
  });

  it('金山SSO自动跳转阶段只观察URL，回到授权原文档后才发固定读取', async () => {
    let reads = 0;
    const { invoke, runs } = setup({
      authoritativeUrl: () =>
        ++reads < 3
          ? 'https://account.kdocs.cn/api/v3/office/callback'
          : 'https://www.kdocs.cn/l/demo',
    });
    await expect(
      invoke(
        input({
          kind: 'ui',
          op: 'read_range',
          params: { url: 'https://www.kdocs.cn/l/demo', address: 'A1:L201' },
          domains: ['www.kdocs.cn'],
        })
      )
    ).resolves.toMatchObject({ tabId: 'browser:1' });
    expect(runs.map((run) => run.op)).toEqual(['navigate', 'plugin_read_wps_range']);
    expect(runs[1].params.tabId).toBe('browser:1');
  });

  it('SSO只读等待可取消，不会在账户页发点击或输入，也不会重放导航', async () => {
    const { invoke, runs } = setup({ authoritativeUrl: () => 'https://account.kdocs.cn/passport' });
    await expect(
      invoke(
        input({
          kind: 'ui',
          op: 'read_range',
          params: { url: 'https://www.kdocs.cn/l/demo', address: 'A1:L201' },
          domains: ['www.kdocs.cn'],
          signal: AbortSignal.timeout(25),
        })
      )
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(runs.map((run) => run.op)).toEqual(['navigate']);
  });
  it('UI固定读取可导航并进入受限Host操作，绑定本次tab而不是共享指针', async () => {
    const { invoke, runs, urls } = setup();
    urls.set('browser:1', 'https://www.kdocs.cn/l/demo');
    const result = await invoke(
      input({
        kind: 'ui',
        op: 'read_range',
        params: { url: 'https://www.kdocs.cn/l/demo', address: 'A1:L201' },
        domains: ['www.kdocs.cn'],
      })
    );
    expect(result).toMatchObject({ tabId: 'browser:1' });
    expect(runs.map((run) => [run.op, run.params])).toEqual([
      ['navigate', { url: 'https://www.kdocs.cn/l/demo', newTab: true }],
      ['plugin_read_wps_range', { tabId: 'browser:1', address: 'A1:L201' }],
    ]);
  });

  it('已有tab只读不重导航；排队时跨文档、来源失效或非UI都拒绝', async () => {
    const { invoke, runs, urls } = setup();
    urls.set('browser:1', 'https://www.kdocs.cn/l/demo');
    const request = input({
      kind: 'ui',
      op: 'read_range',
      params: { url: 'https://www.kdocs.cn/l/demo', address: 'A1:L201', tabId: 'browser:1' },
      domains: ['www.kdocs.cn'],
    });
    await invoke(request);
    expect(runs).toHaveLength(1);
    expect(runs[0].op).toBe('plugin_read_wps_range');
    await expect(invoke({ ...request, kind: 'tool' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    urls.set('browser:1', 'https://www.kdocs.cn/l/other');
    await expect(invoke(request)).rejects.toMatchObject({ code: 'ABORTED' });
    const late = setup({
      run: async (run) => {
        late.urls.set('browser:1', 'https://www.kdocs.cn/l/other');
        run.guard();
        return {};
      },
    });
    late.urls.set('browser:1', 'https://www.kdocs.cn/l/demo');
    await expect(late.invoke(request)).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('read_range对恶意URL、越界地址、导航后登录跳转不做业务输入', async () => {
    const { invoke, runs, urls } = setup();
    const request = input({
      kind: 'ui',
      op: 'read_range',
      params: { url: 'https://www.kdocs.cn/l/demo', address: 'A1:L201' },
      domains: ['www.kdocs.cn'],
    });
    for (const params of [
      { url: 'https://evil.test/l/demo', address: 'A1:L201' },
      { url: 'https://www.kdocs.cn/account', address: 'A1:L201' },
      { url: 'https://www.kdocs.cn/l/demo', address: 'A1:M999' },
    ])
      await expect(invoke({ ...request, params })).rejects.toThrow();
    expect(runs).toHaveLength(0);
    urls.set('browser:1', 'https://www.kdocs.cn/login');
    await expect(invoke(request)).rejects.toThrow();
    expect(runs).toHaveLength(1);
    expect(runs[0].op).toBe('navigate');
  });
  it('有效本机会话：navigate 走宿主并把 tabId 一并返回', async () => {
    const { invoke, runs } = setup();
    await expect(
      invoke(input({ op: 'navigate', params: { url: 'https://example.com/a?b=1', newTab: true } }))
    ).resolves.toEqual({
      url: 'https://example.com/app',
      title: 'App',
      tabId: 'browser:1',
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      sessionKey: 's1',
      op: 'navigate',
      params: { url: 'https://example.com/a?b=1', newTab: true },
    });
  });

  it('会话身份无效或浏览器被禁用时直接拒绝，不碰宿主', async () => {
    for (const [code, authorize] of [
      ['NO_SESSION', { ok: false as const, code: 'NO_SESSION', message: '会话不可用' }],
      [
        'PERMISSION_DENIED',
        { ok: false as const, code: 'PERMISSION_DENIED', message: '当前会话未启用浏览器' },
      ],
    ] as const) {
      const { invoke, runs } = setup({ authorize });
      await expect(invoke(input())).rejects.toMatchObject({ code });
      expect(runs).toHaveLength(0);
    }
  });

  it('域名白名单：动作前拒绝非 HTTPS、非白名单与跨域 tab', async () => {
    const { invoke, runs } = setup();
    for (const url of [
      'http://example.com/',
      'https://evil.test/',
      'file:///etc/passwd',
      'https://sub.example.com/',
    ])
      await expect(invoke(input({ op: 'navigate', params: { url } }))).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    expect(runs).toHaveLength(0);

    const { invoke: invoke2, runs: runs2, urls } = setup();
    urls.set('browser:1', 'https://evil.test/steal');
    await expect(
      invoke2(input({ op: 'snapshot', params: { tabId: 'browser:1' } }))
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(runs2).toHaveLength(0);
  });

  it('域名白名单：动作后目标页跳走也要拒绝', async () => {
    const { invoke, runs, urls } = setup();
    const original = urls.get('browser:1');
    runs.push = ((run: PluginBrowserRunInput) => {
      urls.set('browser:1', 'https://evil.test/after-click');
      return Array.prototype.push.call(runs, run);
    }) as typeof runs.push;
    await expect(
      invoke(input({ op: 'click', params: { tabId: 'browser:1', ref: 'e1_2' } }))
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(runs).toHaveLength(1);
    urls.set('browser:1', original ?? 'https://example.com/app');
  });

  it('未知或跨会话 tab 报 NOT_FOUND', async () => {
    const { invoke, runs } = setup();
    await expect(
      invoke(input({ op: 'snapshot', params: { tabId: 'browser:404' } }))
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(runs).toHaveLength(0);
  });

  it('取消：调用前已取消与动作中被取消都返回 ABORTED，且信号下传宿主', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const { invoke, runs } = setup();
    await expect(invoke(input({ signal: aborted.signal }))).rejects.toMatchObject({
      code: 'ABORTED',
    });
    expect(runs).toHaveLength(0);

    const controller = new AbortController();
    const { invoke: invoke2, runs: runs2 } = setup({
      run: async (run) => {
        runs2.push(run);
        controller.abort();
        return { url: 'https://example.com/app' };
      },
    });
    await expect(invoke2(input({ signal: controller.signal }))).rejects.toMatchObject({
      code: 'ABORTED',
    });
    expect(runs2[0]?.signal).toBe(controller.signal);
  });

  it('动作后会话失效按 ABORTED 处理', async () => {
    const { invoke } = setup({ isSessionCurrent: () => false });
    await expect(invoke(input())).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('各 op 只把固定字段交给宿主，inspect 走只读检查', async () => {
    const { invoke, runs, inspects } = setup();
    await invoke(input({ op: 'snapshot', params: { tabId: 'browser:1' } }));
    await invoke(input({ op: 'read', params: { tabId: 'browser:1' } }));
    await invoke(input({ op: 'copy_selection', params: { tabId: 'browser:1' } }));
    await invoke(input({ op: 'insert_text', params: { tabId: 'browser:1', text: '需求' } }));
    await invoke(input({ op: 'click', params: { tabId: 'browser:1', ref: 'e1_2' } }));
    await invoke(input({ op: 'fill', params: { tabId: 'browser:1', ref: 'e1_3', value: '   ' } }));
    await invoke(input({ op: 'press_key', params: { tabId: 'browser:1', key: 'Enter' } }));
    expect(runs.map((run) => [run.op, run.params])).toEqual([
      ['snapshot', { tabId: 'browser:1' }],
      ['read_text', { tabId: 'browser:1' }],
      ['plugin_copy_selection', { tabId: 'browser:1' }],
      ['plugin_insert_text', { tabId: 'browser:1', text: '需求' }],
      ['click', { tabId: 'browser:1', ref: 'e1_2' }],
      ['fill', { tabId: 'browser:1', ref: 'e1_3', value: '   ' }],
      ['press_key', { tabId: 'browser:1', key: 'Enter' }],
    ]);
    await expect(
      invoke(input({ op: 'inspect', params: { tabId: 'browser:1', selector: '#list input' } }))
    ).resolves.toEqual([entry()]);
    expect(inspects).toEqual([{ tabId: 'browser:1', selector: '#list input' }]);
  });

  it('copy_selection 走宿主内部 op，只把投影后的结果返回插件', async () => {
    const result = {
      text: '需求\t数量',
      range: { sheetId: '1', rowFrom: 0, rowTo: 0, colFrom: 1, colTo: 1 },
    };
    const run = vi.fn(async () => result);
    const { invoke } = setup({ run });
    await expect(
      invoke(input({ op: 'copy_selection', params: { tabId: 'browser:1' } }))
    ).resolves.toEqual(result);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 's1',
        op: 'plugin_copy_selection',
        params: { tabId: 'browser:1' },
      })
    );
  });

  it('insert_text 只把 tabId 与 text 交给宿主内部 op', async () => {
    const run = vi.fn(async () => ({ url: 'https://example.com/app', title: 'App' }));
    const { invoke } = setup({ run });
    await invoke(input({ op: 'insert_text', params: { tabId: 'browser:1', text: '需求\t数量' } }));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 's1',
        op: 'plugin_insert_text',
        params: { tabId: 'browser:1', text: '需求\t数量' },
      })
    );
  });

  it('把会话 actor 透传给宿主，避免与别的成员抢同一个内容页', async () => {
    const { invoke, runs } = setup({
      authorize: { ok: true, sessionKey: 's1', actor: { sessionId: 's1', name: '成员' } },
    });
    await invoke(input());
    expect(runs[0]?.actor).toEqual({ sessionId: 's1', name: '成员' });
  });

  it('宿主报错原样上抛，不改成成功', async () => {
    const failure = Object.assign(new Error('Browser tab is closed'), { code: 'HOST_ERROR' });
    const run = vi.fn(async () => {
      throw failure;
    });
    const { invoke } = setup({ run });
    await expect(invoke(input())).rejects.toBe(failure);
  });

  it('导航返回本次固定目标tab，而不是同会话被其他操作改写的当前指针', async () => {
    const stalePointer = vi.fn(() => 'browser:other');
    const { invoke, urls } = setup({ currentTabId: stalePointer });
    urls.set('browser:other', 'https://example.com/another-document');
    const result = await invoke(
      input({ op: 'navigate', params: { url: 'https://example.com/app' } })
    );
    expect(result).toMatchObject({ tabId: 'browser:1' });
    expect(stalePointer).not.toHaveBeenCalled();
  });

  it('排队时文档或域名改变，真正发输入前的guard拒绝，不只事后报错', async () => {
    let execute: (() => void) | undefined;
    const { invoke, urls } = setup({
      run: async (run) => {
        execute = () => run.guard?.();
        urls.set('browser:1', 'https://example.com/another-document');
        execute();
        return {};
      },
    });
    await expect(
      invoke(input({ op: 'press_key', params: { tabId: 'browser:1', key: 'Enter' } }))
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });
});
