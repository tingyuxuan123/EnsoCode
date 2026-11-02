import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseExtensionPluginManifest } from '@shared/extensionPlugins/manifest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type GateDeps, PluginHostGate } from './gate';

let root: string;
let outside: string;
let gate: PluginHostGate;
let deps: GateDeps;
let now = 1000;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'enso-gate-'));
  outside = mkdtempSync(join(tmpdir(), 'enso-out-'));
  mkdirSync(join(root, 'docs'));
  mkdirSync(join(root, 'out'));
  writeFileSync(join(root, 'docs', 'a'), 'hello');
  writeFileSync(join(outside, 'secret'), 'secret');
  const parsed = parseExtensionPluginManifest(
    {
      schemaVersion: 1,
      id: 'a.b',
      name: 'Test',
      version: '1',
      permissions: ['fs.read', 'fs.write', 'mcp.call', 'net.fetch', 'composer.draft'],
      fs: { read: ['docs'], write: ['out'] },
      net: { domains: ['api.example.com'] },
      mcp: { tools: ['s/write_data'] },
    },
    '0.2.37'
  );
  if (!parsed.ok) throw new Error('fixture');
  now = 1000;
  deps = {
    manifest: () => parsed.manifest,
    now: () => now,
    fetch: vi.fn(async () => new Response('ok')),
    notify: () => true,
    composer: vi.fn(async () => null),
    sessionMessages: async () => [],
    config: () => ({}),
    mcpTools: async () => [],
    mcpCall: vi.fn(async () => ({ content: 'ok', isError: false })),
    invocationPolicy: async () => ({ allowWrite: true, allowMcpCall: true }),
  };
  gate = new PluginHostGate(deps);
});
afterEach(() => {
  gate.dispose();
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});
const inv = (gesture = false) =>
  gate.invocations.create({
    pluginId: 'a.b',
    sessionId: 's',
    projectRoot: root,
    gesture,
    origin: 7,
  });
describe('plugin host capability gate', () => {
  it('授权支持真实用户 server 名并拒绝含斜杠工具造成的歧义匹配', async () => {
    const manifest = deps.manifest('a.b')!;
    manifest.mcp.tools = ['团队 / tools/write_data'];
    deps.mcpTools = async () => [
      { server: '团队 / tools', name: 'write_data', description: 'allowed' },
      { server: '团队 ', name: ' tools/write_data', description: 'ambiguous' },
    ];
    expect(await gate.handle('a.b', 'mcp.tools', {}, inv())).toEqual([
      { server: '团队 / tools', name: 'write_data', description: 'allowed' },
    ]);
    await expect(
      gate.handle('a.b', 'mcp.call', { server: '团队 / tools', tool: 'write_data' }, inv())
    ).resolves.toEqual({ content: 'ok', isError: false });
    await expect(
      gate.handle('a.b', 'mcp.call', { server: '团队 ', tool: ' tools/write_data' }, inv())
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('同名工具在未授权 server 不可发现或调用', async () => {
    deps.mcpTools = async () => [
      { server: 's', name: 'write_data', description: 'allowed' },
      { server: 'other', name: 'write_data', description: 'not allowed' },
    ];
    expect(await gate.handle('a.b', 'mcp.tools', {}, inv())).toEqual([
      { server: 's', name: 'write_data', description: 'allowed' },
    ]);
    await expect(
      gate.handle('a.b', 'mcp.call', { server: 'other', tool: 'write_data' }, inv())
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(deps.mcpCall).not.toHaveBeenCalled();
  });
  it('reads only declared paths within canonical project root', async () => {
    expect(await gate.handle('a.b', 'fs.readText', { path: 'docs/a' }, inv())).toBe('hello');
    await expect(
      gate.handle('a.b', 'fs.readText', { path: '../secret' }, inv())
    ).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    symlinkSync(join(outside, 'secret'), join(root, 'docs', 'link'));
    await expect(
      gate.handle('a.b', 'fs.readText', { path: 'docs/link' }, inv())
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('rejects symlink alias from authorized scope to unauthorized scope inside project', async () => {
    writeFileSync(join(root, 'private'), 'private');
    symlinkSync(join(root, 'private'), join(root, 'docs', 'link'));
    await expect(
      gate.handle('a.b', 'fs.readText', { path: 'docs/link' }, inv())
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('enforces live plan policy for every fs write and MCP call', async () => {
    const id = inv();
    await gate.handle('a.b', 'fs.writeText', { path: 'out/a', text: 'initial' }, id);
    deps.invocationPolicy = async () => ({ allowWrite: false, allowMcpCall: false });
    await expect(
      gate.handle('a.b', 'fs.writeText', { path: 'out/a', text: 'bad' }, id)
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      gate.handle('a.b', 'mcp.call', { server: 's', tool: 'write_data', args: {} }, id)
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(readFileSync(join(root, 'out/a'), 'utf8')).toBe('initial');
    expect(deps.mcpCall).not.toHaveBeenCalled();
  });
  it('fails closed if invocation policy is unavailable', async () => {
    deps.invocationPolicy = async () => {
      throw new Error('not ready');
    };
    await expect(
      gate.handle('a.b', 'fs.writeText', { path: 'out/a', text: 'bad' }, inv())
    ).rejects.toThrow();
  });
  it('rejects no invocation, wrong plugin and cancelled requests', async () => {
    await expect(
      gate.handle('a.b', 'mcp.call', { server: 's', tool: 'write_data' }, undefined)
    ).rejects.toMatchObject({ code: 'NO_INVOCATION' });
    const id = inv();
    gate.invocations.cancel(id);
    await expect(gate.handle('a.b', 'fs.readText', { path: 'docs/a' }, id)).rejects.toMatchObject({
      code: 'ABORTED',
    });
  });
  it('only user gesture may access composer and expires', async () => {
    await expect(
      gate.handle('a.b', 'composer.insertText', { text: 'bad' }, inv())
    ).rejects.toMatchObject({ code: 'GESTURE_REQUIRED' });
    const id = inv(true);
    await gate.handle('a.b', 'composer.insertText', { text: 'ok' }, id);
    expect(deps.composer).toHaveBeenCalledWith({ sessionId: 's', origin: 7 }, 'insertText', {
      text: 'ok',
    });
    now += 31000;
    await expect(
      gate.handle('a.b', 'composer.insertText', { text: 'bad' }, id)
    ).rejects.toMatchObject({ code: 'GESTURE_REQUIRED' });
  });
  it('finishing an invocation revokes it immediately and drains all contexts', async () => {
    const id = inv(true);
    gate.invocations.finish(id);
    expect(gate.invocations.size).toBe(0);
    await expect(gate.handle('a.b', 'composer.readDraft', {}, id)).rejects.toMatchObject({
      code: 'NO_INVOCATION',
    });
  });
  it('refuses undeclared host tool and domain before touching transport', async () => {
    await expect(
      gate.handle('a.b', 'mcp.call', { server: 's', tool: 'protected' }, inv())
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      gate.handle('a.b', 'net.fetch', { url: 'https://evil.example/' }, inv())
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it('passes cancellable signal and actual inner MCP identity to approval bridge', async () => {
    const id = inv();
    await gate.handle('a.b', 'mcp.call', { server: 's', tool: 'write_data', args: { x: 1 } }, id);
    expect(deps.mcpCall).toHaveBeenCalledWith(
      { sessionId: 's', projectRoot: root },
      's',
      'write_data',
      { x: 1 },
      expect.any(AbortSignal)
    );
  });
});
