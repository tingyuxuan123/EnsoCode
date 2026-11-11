import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { createImageGenerationTools, ImageGenerationInvoker } from './imageGeneration';

const identity = { sessionId: 'test', generation: 'g1' };
const image = {
  id: '12345678-1234-4123-8123-123456789abc',
  path: '.xiaoman/images/12345678-1234-4123-8123-123456789abc.png',
  mimeType: 'image/png',
};
const execute = (tool: ToolDefinition, args: unknown) =>
  tool.execute('call', args as never, undefined, undefined, {} as never);

describe('生图工具', () => {
  it('schema 校验前清理空来源及尺寸，结果只返回图片引用而非字节', async () => {
    const invoke = vi.fn(async () => ({ ok: true as const, image }));
    const tool = createImageGenerationTools({ invoke })[0];
    const prepared = tool.prepareArguments?.({
      prompt: '  cat ',
      size: '1024 × 1024',
      sourceImageId: '',
    } as never);
    expect(prepared).toEqual({ prompt: 'cat', size: '1024x1024' });
    const result = await execute(tool, prepared);
    expect(invoke).toHaveBeenCalledWith('generate_image', prepared, undefined);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ ok: true, image }) }]);
  });
  it('坏参数不调用收费服务，业务失败标为错误且不重试', async () => {
    const invoke = vi.fn(async () => ({
      ok: false as const,
      retryable: false,
      error: 'Not configured',
    }));
    const [generate, edit] = createImageGenerationTools({ invoke });
    await expect(execute(edit, { prompt: 'cat' })).rejects.toThrow();
    await expect(execute(generate, { prompt: 'cat', apiKey: 'secret' })).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    expect((await execute(generate, { prompt: 'cat' })).isError).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('取消转发至 Main，迟到结果不再成功', async () => {
    const emit = vi.fn();
    const cancel = vi.fn();
    const invoker = new ImageGenerationInvoker(identity, emit, cancel);
    const controller = new AbortController();
    const pending = invoker.invoke('generate_image', { prompt: 'cat' }, controller.signal);
    const requestId = emit.mock.calls[0][0].requestId;
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/i);
    expect(cancel).toHaveBeenCalledWith(requestId);
    expect(invoker.resolve({ requestId, ok: true, result: { ok: true, image } })).toBe(false);
  });
});
