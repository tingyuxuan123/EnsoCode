import { pixelFingerprint } from '@shared/computer/frame';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate } from '../approval';
import { ComputerInvoker, createComputerTool, withComputerApproval } from './computer';

const identity = { sessionId: 's1', generation: '11111111-1111-4111-8111-111111111111' };

describe('ComputerInvoker', () => {
  it('发 computer-invoke 并等 result', async () => {
    const emit = vi.fn();
    const invoker = new ComputerInvoker(identity, emit);
    const pending = invoker.invoke('run', { code: 'return 1' });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ identity, op: 'run', params: { code: 'return 1' } })
    );
    const requestId = emit.mock.calls[0]?.[0]?.requestId as string;
    expect(invoker.resolve({ requestId, ok: true, result: { text: '1', screenshots: [] } })).toBe(
      true
    );
    await expect(pending).resolves.toEqual({ text: '1', screenshots: [] });
  });

  it('abort / 超时 / cancelAll 通知 Main 取消，Main 回包后不再发', async () => {
    const cancels: string[] = [];
    const invoker = new ComputerInvoker(identity, () => {}, {
      emitCancel: (requestId) => cancels.push(requestId),
    });
    const controller = new AbortController();
    const aborted = invoker.invoke('run', { code: 'x' }, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toThrow(/abort/i);
    expect(cancels).toHaveLength(1);

    const timedOut = invoker.invoke('run', { code: 'x' }, undefined, 5);
    await expect(timedOut).rejects.toThrow(/timed out/);
    expect(cancels).toHaveLength(2);

    const cancelled = invoker.invoke('run', { code: 'x' });
    invoker.cancelAll();
    await expect(cancelled).rejects.toThrow(/cancel/i);
    expect(cancels).toHaveLength(3);
    expect(invoker.pendingCount).toBe(0);
  });

  it('Main 已回包的请求不发取消', async () => {
    const emit = vi.fn();
    const emitCancel = vi.fn();
    const invoker = new ComputerInvoker(identity, emit, { emitCancel });
    const controller = new AbortController();
    const pending = invoker.invoke('run', { code: 'x' }, controller.signal);
    invoker.resolve({ requestId: emit.mock.calls[0]?.[0]?.requestId, ok: false, error: 'boom' });
    await expect(pending).rejects.toThrow('boom');
    controller.abort();
    expect(emitCancel).not.toHaveBeenCalled();
    expect(invoker.pendingCount).toBe(0);
  });

  it('abort / cancelAll 拒绝收尾', async () => {
    const invoker = new ComputerInvoker(identity, () => {});
    const controller = new AbortController();
    const aborted = invoker.invoke('run', { code: 'x' }, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toThrow(/abort/i);
    const cancelled = invoker.invoke('run', { code: 'x' });
    invoker.cancelAll();
    await expect(cancelled).rejects.toThrow(/cancel/i);
  });
});

describe('createComputerTool', () => {
  it('指引要求身份改变后重新观察，而不是宣称新快照作废全部旧 ref', () => {
    const tool = createComputerTool(new ComputerInvoker(identity, vi.fn()));
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';
    expect(guidelines).toContain('refs of unchanged elements stay the same across calls');
    expect(guidelines).toMatch(/observed ref.*identity.*changes.*re-run ax\(\)\/find\(\)/iu);
    expect(guidelines).not.toContain('New ax() invalidates older refs');
  });

  it('schema 声明完整类型，缺 code 不发请求', async () => {
    const emit = vi.fn();
    const tool = createComputerTool(new ComputerInvoker(identity, emit));
    expect(tool.name).toBe('computer');
    expect(tool.executionMode).toBe('sequential');
    const properties = (tool.parameters as { properties: Record<string, { type: string }> })
      .properties;
    expect(properties.code.type).toBe('string');
    expect(properties.read_only.type).toBe('boolean');
    expect(properties.timeout.type).toBe('number');
    await expect(tool.execute('c1', {}, undefined, undefined, undefined as never)).rejects.toThrow(
      /code/
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('归一化 JSON 字符串参数后再 invoke；截图变成 image 块', async () => {
    const emit = vi.fn();
    const invoker = new ComputerInvoker(identity, emit);
    const tool = createComputerTool(invoker);
    const pending = tool.execute(
      'c1',
      '{"code":"await desktop.windows()","read_only":true,"timeout":12}',
      undefined,
      undefined,
      undefined as never
    );
    expect(emit.mock.calls[0]?.[0]?.params).toEqual({
      code: 'await desktop.windows()',
      read_only: true,
      timeout: 12,
    });
    invoker.resolve({
      requestId: emit.mock.calls[0]?.[0]?.requestId as string,
      ok: true,
      result: {
        text: 'ok',
        screenshots: [
          {
            mimeType: 'image/png',
            data: 'AAAA',
            width: 10,
            height: 10,
            sourceWidth: 10,
            sourceHeight: 10,
            target: 'desktop',
          },
        ],
      },
    });
    const out = await pending;
    expect(JSON.stringify(out.details)).not.toContain('AAAA');
    expect(out.content).toEqual([
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      {
        type: 'text',
        text: `desktop 10×10 (source 10×10, scale 1.00 hash ${pixelFingerprint('AAAA')}). click(x,y) uses these screenshot pixels.\nok`,
      },
    ]);
  });
});

describe('withComputerApproval', () => {
  it('assistant 的写操作不交给分类器自动放行', async () => {
    const review = vi.fn(async () => ({ decision: 'auto_allow' as const }));
    const onRequest = vi.fn();
    const emit = vi.fn();
    const gate = new ApprovalGate('assistant', onRequest, () => {}, { review });
    const tool = withComputerApproval(
      gate,
      createComputerTool(new ComputerInvoker(identity, emit))
    );
    const pending = tool.execute(
      'c1',
      { code: 'await desktop.type("hello")' },
      undefined,
      undefined,
      undefined as never
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(review).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ protected: 'desktop-control' })
    );
    gate.cancelAll();
    await expect(pending).rejects.toThrow(/cancel/);
  });

  it('read_only 跳过审批，写操作走 command', async () => {
    const emit = vi.fn();
    const invoker = new ComputerInvoker(identity, emit);
    const onRequest = vi.fn();
    const gate = new ApprovalGate('supervised', onRequest, () => {});
    const tool = withComputerApproval(gate, createComputerTool(invoker));

    const readPending = tool.execute(
      'c1',
      { code: 'await desktop.windows()', read_only: true },
      undefined,
      undefined,
      undefined as never
    );
    invoker.resolve({
      requestId: emit.mock.calls[0]?.[0]?.requestId as string,
      ok: true,
      result: { text: '[]', screenshots: [] },
    });
    await readPending;
    expect(onRequest).not.toHaveBeenCalled();

    const write = tool.execute(
      'c2',
      { code: 'await win.click(1,1)' },
      undefined,
      undefined,
      undefined as never
    );
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'computer', kind: 'command' })
    );
    gate.respond(onRequest.mock.calls[0]?.[0]?.requestId as string, 'deny');
    await expect(write).rejects.toThrow(/denied/i);
  });

  it('审批展示完整代码，不截断到开头几百字', async () => {
    const onRequest = vi.fn();
    const gate = new ApprovalGate('supervised', onRequest, () => {});
    const tool = withComputerApproval(
      gate,
      createComputerTool(new ComputerInvoker(identity, vi.fn()))
    );
    const code = `${'// padding\n'.repeat(60)}await desktop.app("Terminal")`;
    void tool.execute('c1', { code }, undefined, undefined, undefined as never).catch(() => {});
    expect(onRequest.mock.calls[0]?.[0]?.summary).toBe(code);
  });
});
