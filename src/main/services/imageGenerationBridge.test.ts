import { describe, expect, it, vi } from 'vitest';
import { ImageGenerationBridge } from './imageGenerationBridge';

const identity = { sessionId: 'session', generation: 'g1' };
const request = {
  identity,
  requestId: 'call',
  tool: 'generate_image' as const,
  params: { prompt: 'cat' },
};
const config = { baseUrl: 'https://example.com/v1', apiKey: 'secret', modelId: 'image-model' };
const failure = { ok: false as const, error: 'fake error', retryable: false };
function fixture() {
  const deps = {
    allowed: vi.fn(() => true),
    cwd: vi.fn(() => '/workspace'),
    config: vi.fn(() => config),
    run: vi.fn<typeof import('./imageGeneration/service').generateImage>(async () => failure),
    reply: vi.fn(),
  };
  return { bridge: new ImageGenerationBridge(deps), deps };
}
describe('Main 生图桥', () => {
  it('按 Main 根与凭证执行一次，重复 id 不会再次计费', async () => {
    const { bridge, deps } = fixture();
    await bridge.invoke(request);
    await bridge.invoke(request);
    expect(deps.run).toHaveBeenCalledTimes(1);
    expect(deps.run).toHaveBeenCalledWith(
      { prompt: 'cat' },
      '/workspace',
      config,
      expect.any(AbortSignal)
    );
    expect(deps.reply.mock.calls[0][1]).toEqual(failure);
  });
  it('权限失效、缺模型、坏参数不碰网络', async () => {
    const { bridge, deps } = fixture();
    deps.allowed.mockReturnValue(false);
    await bridge.invoke(request);
    expect(deps.run).not.toHaveBeenCalled();
    deps.allowed.mockReturnValue(true);
    await bridge.invoke({
      ...request,
      requestId: 'bad',
      params: { ...request.params, baseUrl: 'http://localhost' },
    });
    expect(deps.run).not.toHaveBeenCalled();
  });
  it('取消只影响对应 generation，迟到服务结果不回流', async () => {
    const { bridge, deps } = fixture();
    let finish!: (value: typeof failure) => void;
    deps.run.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = bridge.invoke(request);
    const signal = deps.run.mock.calls[0]?.[3];
    bridge.cancel({ ...identity, generation: 'old' }, 'call');
    expect(signal?.aborted).toBe(false);
    bridge.cancel(identity, 'call');
    expect(signal?.aborted).toBe(true);
    finish(failure);
    await pending;
    expect(deps.reply).not.toHaveBeenCalled();
  });
});
