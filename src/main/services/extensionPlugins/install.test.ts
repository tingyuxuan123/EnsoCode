import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  commitStaged,
  discardStaged,
  pluginPackagePath,
  removePackage,
  type StageDeps,
  stagePlugin,
} from './install';

function buildZip(entries: { name: string; data: string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(Buffer.concat([local, name, data]));
    centrals.push(Buffer.concat([central, name]));
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const roots: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'enso-install-'));
  roots.push(d);
  return d;
};
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});
const manifest = {
  schemaVersion: 1,
  id: 'example.demo',
  name: 'Demo',
  version: '1.0.0',
  permissions: [],
  main: 'main.js',
};
const plugin = (raw: unknown = manifest) => {
  const src = temp();
  writeFileSync(join(src, 'enso-plugin.json'), JSON.stringify(raw));
  writeFileSync(join(src, 'main.js'), 'safe');
  return src;
};
const fake = (zip: Buffer): StageDeps => ({
  resolve: async () => [{ address: '8.8.8.8', family: 4 }],
  fetch: async () => ({
    status: 200,
    headers: { get: () => null },
    body: new ReadableStream({
      start(c) {
        c.enqueue(zip);
        c.close();
      },
    }),
  }),
});

describe('安全插件 staging/commit', () => {
  it('目录复制保留执行能力，但不放宽 group/other 权限', async () => {
    const src = plugin();
    chmodSync(join(src, 'main.js'), 0o755);
    const result = await stagePlugin(temp(), { kind: 'dir', path: src }, '0.2.37');
    if (!result.ok) throw new Error(result.error);
    const main = join(result.staged.pluginRoot, 'main.js');
    const manifestPath = join(result.staged.pluginRoot, 'enso-plugin.json');
    if (process.platform === 'win32') {
      // Windows chmod exposes owner read/write, not POSIX execute or ACL privacy.
      expect(statSync(main).mode & 0o600).toBe(0o600);
      expect(statSync(manifestPath).mode & 0o600).toBe(0o600);
    } else {
      expect(statSync(main).mode & 0o7777).toBe(0o700);
      expect(statSync(manifestPath).mode & 0o7777).toBe(0o600);
    }
    expect(readFileSync(main, 'utf8')).toBe('safe');
    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual(manifest);
  });
  it('目录复制至私有 staging，源改变不影响安装，commit 后清理 staging', async () => {
    const root = temp();
    const src = plugin();
    const result = await stagePlugin(root, { kind: 'dir', path: src }, '0.2.37');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    writeFileSync(join(src, 'main.js'), 'changed');
    const dir = commitStaged(root, result.staged);
    expect(readFileSync(join(pluginPackagePath(root, manifest.id, dir), 'main.js'), 'utf8')).toBe(
      'safe'
    );
    expect(readdirSync(join(root, 'staging'))).toEqual([]);
    expect(JSON.stringify(result.staged)).not.toContain(src);
  });
  it.each(['normal', 'skipped', 'root', 'hardlink'])(
    '拒绝目录任意 symlink/hardlink：%s',
    async (kind) => {
      const src = plugin();
      const root = temp();
      const outside = temp();
      if (kind === 'root') {
        symlinkSync(src, join(outside, 'src'), 'junction');
        expect(
          (await stagePlugin(root, { kind: 'dir', path: join(outside, 'src') }, '0.2.37')).ok
        ).toBe(false);
      } else {
        if (kind === 'hardlink') linkSync(join(src, 'main.js'), join(src, 'linked'));
        else symlinkSync(outside, join(src, kind === 'skipped' ? '.git' : 'escape'), 'junction');
        expect((await stagePlugin(root, { kind: 'dir', path: src }, '0.2.37')).ok).toBe(false);
      }
      expect(existsSync(join(src, 'main.js'))).toBe(true);
    }
  );
  it.each(['../escape', 'C:\\escape', '\\\\server\\share', '/etc/passwd', 'missing.js'])(
    '清单引用受 shared 边界及存在性校验：%s',
    async (main) => {
      expect(
        (await stagePlugin(temp(), { kind: 'dir', path: plugin({ ...manifest, main }) }, '0.2.37'))
          .ok
      ).toBe(false);
    }
  );
  it('skills、preset 引用都校验实际类型和存在性', async () => {
    for (const contributes of [
      { skills: ['main.js'] },
      {
        presets: [
          { id: 'review', name: 'Review', skills: [], mcpServers: [], systemPrompt: 'missing.md' },
        ],
      },
    ]) {
      expect(
        (
          await stagePlugin(
            temp(),
            { kind: 'dir', path: plugin({ ...manifest, contributes }) },
            '0.2.37'
          )
        ).ok
      ).toBe(false);
    }
  });
  it('拒绝私有 root 本身/父目录作为源，且不能通过root symlink逃逸', async () => {
    const root = plugin();
    expect((await stagePlugin(root, { kind: 'dir', path: root }, '0.2.37')).ok).toBe(false);
    const parent = temp();
    const target = plugin();
    symlinkSync(target, join(parent, 'root'), 'junction');
    expect(
      (await stagePlugin(join(parent, 'root'), { kind: 'dir', path: plugin() }, '0.2.37')).ok
    ).toBe(false);
    expect(existsSync(join(target, 'enso-plugin.json'))).toBe(true);
  });
  it('目录预算和清单大小有限，失败不残留 staging', async () => {
    const src = plugin();
    const root = temp();
    truncateSync(join(src, 'main.js'), 200 * 1024 * 1024 + 1);
    expect((await stagePlugin(root, { kind: 'dir', path: src }, '0.2.37')).ok).toBe(false);
    truncateSync(join(src, 'main.js'), 0);
    writeFileSync(
      join(src, 'enso-plugin.json'),
      JSON.stringify({ ...manifest, extra: 'x'.repeat(256 * 1024) })
    );
    expect((await stagePlugin(root, { kind: 'dir', path: src }, '0.2.37')).ok).toBe(false);
    expect(readdirSync(join(root, 'staging'))).toEqual([]);
  });
  it('本地 ZIP 与 HTTP/GitHub tree 子目录完整安装，网络均离线 fake', async () => {
    const zip = buildZip([
      { name: 'repo-main/plugins/demo/enso-plugin.json', data: JSON.stringify(manifest) },
      { name: 'repo-main/plugins/demo/main.js', data: 'safe' },
    ]);
    const root = temp();
    const result = await stagePlugin(
      root,
      { kind: 'url', url: 'https://github.com/acme/repo/tree/main/plugins/demo' },
      '0.2.37',
      fake(zip)
    );
    expect(result.ok).toBe(true);
    const local = join(temp(), 'a.zip');
    const bytes = buildZip([
      { name: 'demo/enso-plugin.json', data: JSON.stringify(manifest) },
      { name: 'demo/main.js', data: 'safe' },
    ]);
    writeFileSync(local, bytes);
    expect((await stagePlugin(root, { kind: 'zip', path: local }, '0.2.37')).ok).toBe(true);
    expect(
      (
        await stagePlugin(
          root,
          { kind: 'url', url: 'http://public.example/plugin.zip' },
          '0.2.37',
          fake(bytes)
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await stagePlugin(
          root,
          { kind: 'url', url: 'http://github.com/acme/repo' },
          '0.2.37',
          fake(bytes)
        )
      ).ok
    ).toBe(false);
  });
  it('abort 清理自身 staging，不误删目录源', async () => {
    const src = plugin();
    const root = temp();
    const controller = new AbortController();
    controller.abort();
    expect(
      (await stagePlugin(root, { kind: 'dir', path: src }, '0.2.37', { signal: controller.signal }))
        .ok
    ).toBe(false);
    expect(existsSync(join(src, 'main.js'))).toBe(true);
    expect(existsSync(join(root, 'staging')) ? readdirSync(join(root, 'staging')) : []).toEqual([]);
  });
  it('URL 下载过程中 owner abort 清理下载及整个 staging', async () => {
    const root = temp();
    const controller = new AbortController();
    let started!: () => void;
    const downloading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const result = stagePlugin(
      root,
      { kind: 'url', url: 'https://public.example/plugin.zip' },
      '0.2.37',
      {
        signal: controller.signal,
        resolve: fake(Buffer.alloc(0)).resolve,
        fetch: async () => {
          started();
          return {
            status: 200,
            headers: { get: () => null },
            body: new ReadableStream({
              start(c) {
                c.enqueue(new Uint8Array([1]));
              },
            }),
          };
        },
      }
    );
    await downloading;
    controller.abort();
    expect(await result).toMatchObject({ ok: false });
    expect(readdirSync(join(root, 'staging'))).toEqual([]);
  });
  it('commit/discard/remove 拒绝伪造 token、pluginRoot 和路径标识', async () => {
    const root = temp();
    const src = plugin();
    const result = await stagePlugin(root, { kind: 'dir', path: src }, '0.2.37');
    if (!result.ok) throw new Error(result.error);
    expect(() => commitStaged(root, { ...result.staged, pluginRoot: src })).toThrow();
    expect(() => discardStaged(root, { token: '../../escape' })).toThrow();
    expect(() => removePackage(root, '../escape', 'abc')).toThrow();
    expect(() => removePackage(root, manifest.id, '..\\escape')).toThrow();
    expect(existsSync(join(src, 'main.js'))).toBe(true);
    discardStaged(root, result.staged);
  });
});
