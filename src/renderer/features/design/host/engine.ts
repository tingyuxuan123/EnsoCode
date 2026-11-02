import type { DesignEngineRequest } from '@shared/types/design';
import type {
  PluginOffscreenCaptureOptions,
  PluginOffscreenCaptureResult,
} from '../vetta/sdk/capture';
import type { PluginCommandSpawnExit, PluginCommandSpawnHandle } from '../vetta/sdk/command';
import { designPaths } from './paths';

const engines = new Map<string, { engineId: string; port: number }>();
export async function engineRequest(request: DesignEngineRequest) {
  const result = await window.electronAPI.design.engine(request);
  if (!result.ok) throw new Error(result.error);
  return result;
}
export function designEnginePath(path: string) {
  const { root, rel } = designPaths.map(path);
  return { root, designRel: rel };
}
export async function startEngine(path: string): Promise<PluginCommandSpawnHandle> {
  const result = await engineRequest({ op: 'start', ...designEnginePath(path) });
  if (!('engineId' in result)) throw new Error('Engine start returned no engine');
  engines.set(path, result);
  const listeners = new Set<(exit: PluginCommandSpawnExit) => void>();
  let exit: PluginCommandSpawnExit | undefined;
  const unsubscribe = window.electronAPI.design.onEngineExit((event) => {
    if (event.engineId !== result.engineId) return;
    exit = { exitCode: event.exitCode, signal: event.signal };
    engines.delete(path);
    unsubscribe();
    for (const listener of listeners) listener(exit);
    listeners.clear();
  });
  return {
    spawnId: result.engineId,
    pid: 0,
    port: result.port,
    async stop() {
      await engineRequest({ op: 'stop', engineId: result.engineId });
      engines.delete(path);
      unsubscribe();
    },
    async status() {
      const response = await engineRequest({ op: 'status', engineId: result.engineId });
      if (!('status' in response)) throw new Error('Missing engine status');
      return { ...response.status, pid: 0 };
    },
    onExit(listener) {
      if (exit) queueMicrotask(() => listener(exit!));
      else listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
  };
}
export async function captureDesign(
  options: PluginOffscreenCaptureOptions
): Promise<PluginOffscreenCaptureResult> {
  const url = new URL(options.url);
  const engine = [...engines.values()].find((value) => String(value.port) === url.port);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    !engine
  )
    throw new Error('Capture URL does not belong to a registered design engine');
  const { url: _url, ...rest } = options;
  const result = await window.electronAPI.design.capture({
    op: 'offscreen',
    engineId: engine.engineId,
    path: `${url.pathname}${url.search}${url.hash}`,
    ...rest,
  });
  if (!result.ok) throw new Error(result.error);
  if (!('dataUrl' in result)) throw new Error('Capture returned no image');
  return result;
}
export async function releaseDesignCapture(sessionKey: string): Promise<void> {
  const result = await window.electronAPI.design.capture({ op: 'release', sessionKey });
  if (!result.ok) throw new Error(result.error);
}
