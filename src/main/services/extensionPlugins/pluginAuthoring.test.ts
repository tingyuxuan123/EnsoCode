import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PluginAuthoring } from './pluginAuthoring';
import { ExtensionPluginService } from './service';

let temp: string;
let project: string;
let cwd: string;
let authoring: PluginAuthoring;
beforeEach(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), 'ck-plugin-authoring-')));
  project = join(temp, 'project');
  await mkdir(project);
  cwd = project;
  authoring = new PluginAuthoring({
    workspace: (id) => (id === 'session' ? { cwd, projectId: 'project' } : null),
    hostVersion: '0.2.104',
  });
});
afterEach(async () => rm(temp, { recursive: true, force: true }));

async function draft() {
  const result = await authoring.create(1, 'session');
  if (!result.ok) throw new Error(result.error);
  return result.draft;
}

it('creates a valid starter in the bound worktree and never resets edits on re-open', async () => {
  const generated = await draft();
  const root = join(project, generated.directory);
  expect(await readdir(root)).toEqual(
    expect.arrayContaining(['enso-plugin.json', 'main.mjs', 'view.html', 'HOST-CAPABILITIES.md'])
  );
  await writeFile(join(root, 'main.mjs'), 'throw new Error("must not execute");');
  await expect(draft()).resolves.toEqual(generated);
  await expect(authoring.validate(1, 'session', generated.id)).resolves.toMatchObject({ ok: true });
  expect(await readFile(join(root, 'main.mjs'), 'utf8')).toContain('must not execute');
});

it('rejects a wrong owner, a stale worktree, an edited plugin ID and a replaced directory', async () => {
  const generated = await draft();
  await expect(authoring.validate(2, 'session', generated.id)).rejects.toThrow();
  await expect(authoring.create(1, 'unknown')).rejects.toThrow();
  cwd = join(temp, 'different-worktree');
  await mkdir(cwd);
  await expect(authoring.validate(1, 'session', generated.id)).rejects.toThrow();
  cwd = project;
  const root = join(project, generated.directory);
  const manifest = join(root, 'enso-plugin.json');
  await writeFile(
    manifest,
    (await readFile(manifest, 'utf8')).replace(generated.id, 'local.other')
  );
  await expect(authoring.validate(1, 'session', generated.id)).resolves.toMatchObject({
    ok: false,
  });
  await rename(root, join(temp, 'moved'));
  await symlink(join(temp, 'moved'), root, 'junction');
  await expect(authoring.validate(1, 'session', generated.id)).resolves.toMatchObject({
    ok: false,
  });
});

it('stages the real permissions without installing and discards a stale preview', async () => {
  const fork = vi.fn((): never => {
    throw new Error('preview must not execute the plugin');
  });
  const service = new ExtensionPluginService({
    root: join(temp, 'installed'),
    hostVersion: '0.2.104',
    hostPath: '/unused',
    env: {},
    fork,
    gate: {
      fetch: vi.fn(),
      notify: () => true,
      composer: async () => null,
      mcpTools: async () => [],
      mcpCall: async () => ({ content: '', isError: false }),
      now: Date.now,
    },
  });
  try {
    const generated = await draft();
    const preview = await authoring.stage(1, 'session', generated.id, service);
    expect(preview).toMatchObject({
      ok: true,
      preview: { id: generated.id, permissions: ['ui.view'] },
    });
    expect(service.list().plugins).toEqual([]);
    expect(fork).not.toHaveBeenCalled();
    if (!preview.ok) throw new Error(preview.error);
    expect(service.discard(preview.preview.token, 1)).toBe(true);

    let staleToken: string | undefined;
    const staging = {
      list: service.list.bind(service),
      installedPackage: service.installedPackage.bind(service),
      uninstall: service.uninstall.bind(service),
      stage: async (...args: Parameters<ExtensionPluginService['stage']>) => {
        const result = await service.stage(...args);
        if (result.ok) staleToken = result.preview.token;
        authoring.releaseOwner(1);
        return result;
      },
      discard: service.discard.bind(service),
    };
    await expect(authoring.stage(1, 'session', generated.id, staging)).rejects.toThrow();
    expect(staleToken).toBeDefined();
    expect(service.discard(staleToken ?? '', 1)).toBe(false);
  } finally {
    await service.dispose();
  }
});
