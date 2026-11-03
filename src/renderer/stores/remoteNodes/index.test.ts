import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ addToast: toast }));
let store: typeof import('./index').useRemoteNodesStore;
let send: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules();
  toast.mockClear();
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  send = vi.fn(async () => ({ ok: false, error: 'handshake timeout' }));
  vi.stubGlobal('window', { electronAPI: { nodes: { send } } });
  store = (await import('./index')).useRemoteNodesStore;
  store.setState({ nodes: [{ nodeId: 'n', connected: true, hostOnline: true } as never] });
});

describe('remoteNodes 发送失败承接', () => {
  it('IPC 拒绝可观察地提示并返回 false，不静默吞掉结果', async () => {
    expect(await store.getState().send('n', { type: 'prompt', sessionId: 's', text: 'hi' })).toBe(
      false
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        description: expect.stringContaining('handshake timeout'),
      })
    );
  });
  it('已知离线在 IPC 与 fresh 乐观选择之前拒绝', async () => {
    store.setState({ nodes: [] });
    expect(
      store.getState().spawn('n', { projectId: 'p', providerId: 'v', modelId: 'm' })
    ).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(store.getState().freshIds.size).toBe(0);
  });
});
