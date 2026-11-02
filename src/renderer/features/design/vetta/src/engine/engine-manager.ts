/** EnsoCode port: process and resource ownership lives in Main (see PORTING.md). */
import type { Disposable, PluginCommandSpawnExit, PluginCommandSpawnHandle, PluginContext } from '@vetta-org/plugin-sdk';
import { designEnginePath, engineRequest, startEngine } from '../../../host/engine';
import { designPaths } from '../../../host/paths';
import { designPackageJson, needsDependencyInstall, PACKAGE_FILE } from '../vetd/design-package';
import { sanitizeDesignName } from '../vetd/scaffold';

export type EngineProgress = { phase: 'checking' | 'materializing' | 'starting' } | { phase: 'installing' | 'installing-design'; outputTail: string };
export interface EngineServer { port: number; handle: PluginCommandSpawnHandle; designDir: string; whenExited: Promise<PluginCommandSpawnExit> }
const servers = new Map<string, EngineServer>();

export async function engineRootDir(_ctx: PluginContext, _route: string): Promise<string> {
  const result = await engineRequest({ op: 'diagnostics' });
  if (!('engineRoot' in result)) throw new Error('Missing engine diagnostics');
  return result.engineRoot;
}
export async function migrateLegacyEngine(_ctx: PluginContext, _home: string, _route: string): Promise<void> {
  // Main owns the versioned EnsoCode resource tree; never migrate ~/.vetta.
}
export async function materializeEngineForTest(ctx: PluginContext, _root: string, route: string): Promise<void> {
  await ensureEngine(ctx, () => {}, route);
}
export async function engineReady(ctx: PluginContext, _root: string, route: string): Promise<boolean> {
  return Boolean(await engineRootDir(ctx, route));
}
export async function ensureEngine(ctx: PluginContext, onProgress: (progress: EngineProgress) => void, route: string): Promise<string> {
  onProgress({ phase: 'checking' });
  return engineRootDir(ctx, route);
}
export async function installDesignDependencies(ctx: PluginContext, designDir: string, packages: readonly string[], onProgress: (progress: EngineProgress) => void): Promise<string> {
  if (!(await ctx.fs.stat(`${designDir}/${PACKAGE_FILE}`))) await ctx.fs.writeFile(`${designDir}/${PACKAGE_FILE}`, designPackageJson(sanitizeDesignName(designDir.split('/').pop() ?? 'design')));
  onProgress({ phase: 'installing-design', outputTail: '' });
  const result = await engineRequest({ op: 'install', ...designEnginePath(designDir), packages: [...packages] });
  return 'output' in result ? result.output : '';
}
export async function ensureDesignDependencies(ctx: PluginContext, designDir: string, onProgress: (progress: EngineProgress) => void): Promise<void> {
  if (await needsDependencyInstall(ctx.fs, designDir)) await installDesignDependencies(ctx, designDir, [], onProgress);
}
export function waitForSpawnExit(handle: PluginCommandSpawnHandle): Promise<PluginCommandSpawnExit> {
  return new Promise((resolve) => {
    let settled = false;
    let subscription: Disposable | undefined;
    const finish = (exit: PluginCommandSpawnExit) => { if (settled) return; settled = true; subscription?.dispose(); resolve(exit); };
    subscription = handle.onExit(finish);
    if (settled) subscription.dispose();
    void handle.status().then((status) => { if (!status.running && status.exit) finish(status.exit); }).catch(() => undefined);
  });
}
export async function startDesignServer(_ctx: PluginContext, designDir: string, onProgress: (progress: EngineProgress) => void): Promise<EngineServer> {
  const existing = servers.get(designDir);
  if (existing && (await existing.handle.status()).running) return existing;
  onProgress({ phase: 'starting' });
  const handle = await startEngine(designDir);
  const server: EngineServer = { port: handle.port!, handle, designDir, whenExited: waitForSpawnExit(handle) };
  servers.set(designDir, server);
  void server.whenExited.then(() => { if (servers.get(designDir) === server) servers.delete(designDir); });
  return server;
}
export function getDesignServer(designDir: string): EngineServer | null { return servers.get(designDir) ?? null; }
export async function stopDesignServer(designDir: string): Promise<void> { const server = servers.get(designDir); if (server) { servers.delete(designDir); await server.handle.stop(); } }
export async function stopAllDesignServers(): Promise<void> { await Promise.all([...servers.keys()].map(stopDesignServer)); }
export async function buildDesign(_ctx: PluginContext, designDir: string, outDir: string): Promise<void> {
  const design = designEnginePath(designDir); const output = designPaths.map(outDir);
  if (JSON.stringify(design.root) !== JSON.stringify(output.root)) throw new Error('Cross-root design build is not supported');
  await engineRequest({ op: 'build', ...design, outRel: output.rel });
}
export async function engineDiagnostics(designDir: string | null): Promise<{ running: boolean; port: number | null; recentOutput: string }> {
  const server = designDir ? servers.get(designDir) : null;
  if (!server) return { running: false, port: null, recentOutput: '' };
  const status = await server.handle.status();
  return { running: status.running, port: server.port, recentOutput: status.recentOutput.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((line) => line.trim()).slice(-8).join('\n') };
}
