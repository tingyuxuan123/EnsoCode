import { IPC_CHANNELS } from '@shared/types/ipc';
import { expect, it, vi } from 'vitest';
import type { ElectronAPI } from '../preload/index';

const bridge = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock('electron', () => ({ contextBridge: bridge, ipcRenderer: bridge }));

it('removes the Wiki and Bot bridges while keeping speech and local model management', async () => {
  await import('../preload/index');
  const [key, api] = bridge.exposeInMainWorld.mock.calls[0] as [string, ElectronAPI];
  expect(key).toBe('electronAPI');
  expect(api).not.toHaveProperty('memory');
  expect(api.speech.status).toBeTypeOf('function');
  expect(api).not.toHaveProperty('bots');
  expect(api).not.toHaveProperty('taskBoard');

  await api.localModels.list();
  await api.localModels.download('voice-model');
  await api.localModels.cancelDownload('voice-model');
  await api.localModels.remove('voice-model');
  expect(bridge.invoke.mock.calls).toEqual([
    [IPC_CHANNELS.LOCAL_MODELS_LIST],
    [IPC_CHANNELS.LOCAL_MODELS_DOWNLOAD, 'voice-model'],
    [IPC_CHANNELS.LOCAL_MODELS_CANCEL, 'voice-model'],
    [IPC_CHANNELS.LOCAL_MODELS_DELETE, 'voice-model'],
  ]);

  const onProgress = vi.fn();
  const dispose = api.localModels.onProgress(onProgress);
  const [channel, handler] = bridge.on.mock.lastCall!;
  expect(channel).toBe(IPC_CHANNELS.LOCAL_MODELS_PROGRESS);
  const progress = { modelId: 'voice-model', received: 4, total: 10, done: false };
  handler({}, progress);
  expect(onProgress).toHaveBeenCalledWith(progress);
  dispose();
  expect(bridge.removeListener).toHaveBeenCalledWith(channel, handler);
});
