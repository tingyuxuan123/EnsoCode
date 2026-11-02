import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runPluginHost } from './host';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function harness(source: string) {
  const dir = mkdtempSync(join(tmpdir(), 'enso-host-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'main.mjs'), source);
  let deliver: (m: unknown) => void = () => {};
  const sent: Record<string, unknown>[] = [];
  runPluginHost({
    send: (m) => sent.push(m),
    onMessage: (h) => {
      deliver = h;
    },
  });
  deliver({ t: 'init', pluginId: 'a.b', pluginRoot: dir, main: 'main.mjs', dataDir: dir });
  const next = async (predicate: (m: Record<string, unknown>) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const m = sent.find(predicate);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 2));
    }
    throw new Error('timeout');
  };
  await next((m) => m.t === 'ready' || m.t === 'init-error');
  const call = (id: string) =>
    deliver({
      t: 'call',
      id,
      invocationId: id,
      sessionId: 's',
      projectRoot: '/repo',
      method: 'tool.execute',
      payload: { name: 'read', args: {} },
    });
  return { sent, next, deliver, call };
}
describe('isolated plugin host', () => {
  it('loads registered tools and normalizes content', async () => {
    const h = await harness(
      `export function activate(e) { e.tools.register('read', (_, c) => c.projectRoot); }`
    );
    h.call('i');
    expect(await h.next((m) => m.t === 'res')).toMatchObject({
      ok: true,
      value: { content: '/repo' },
    });
  });
  it('passes invocation id to host APIs and cancellation signal', async () => {
    const h = await harness(
      `export function activate(e) { e.tools.register('read', async (_, c) => { try { return await e.fs.readText('a'); } catch { return String(c.signal.aborted); } }); }`
    );
    h.call('i');
    expect(await h.next((m) => m.t === 'call')).toMatchObject({
      invocationId: 'i',
      api: 'fs.readText',
    });
    h.deliver({ t: 'cancel', invocationId: 'i' });
    expect(await h.next((m) => m.t === 'res')).toMatchObject({ value: { content: 'true' } });
  });
  it('registration disposers do not remove a newer handler', async () => {
    const h = await harness(
      `export function activate(e) { const off = e.tools.register('read', () => 'old'); e.tools.register('read', () => 'new'); off(); }`
    );
    h.call('i');
    expect(await h.next((m) => m.t === 'res')).toMatchObject({
      ok: true,
      value: { content: 'new' },
    });
  });
});
