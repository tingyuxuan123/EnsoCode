import {
  mkdir,
  mkdtemp,
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
import { AuthoringProjects } from './authoringProjects';
import { PluginAuthoring } from './pluginAuthoring';
import { ExtensionPluginService } from './service';

let temp: string, project: string, stateRoot: string;
let authoring: PluginAuthoring;
const options = () => ({
  workspace: (id: string) => (id === 's' ? { cwd: project, projectId: 'p' } : null),
  hostVersion: '0.2.110',
  stateRoot,
});
beforeEach(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), 'authoring-life-')));
  project = join(temp, 'project');
  stateRoot = join(temp, 'private');
  await mkdir(project);
  authoring = new PluginAuthoring(options());
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(temp, { recursive: true, force: true });
});

it('a delayed trial confirmation cannot certify a newer staged source it never loaded', async () => {
  const draft = await create();
  let path = '';
  const service = {
    stage: async (source: { path: string }) => {
      path = source.path;
      return { ok: true, preview: { id: draft.trialId, token: 't' } };
    },
    discard: vi.fn(),
    list: () => ({
      plugins: [
        {
          id: draft.trialId,
          state: 'enabled',
          build: 'buildA',
          version: '0.1.0',
          commands: [],
          views: [],
        },
      ],
    }),
    installedPackage: () => ({ path, build: 'buildA' }),
  };
  await authoring.stageTrial(1, 's', draft.id, service as never);
  const installed = path;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    start = new Promise<void>((resolve) => {
      started = resolve;
    });
  const original = AuthoringProjects.prototype.change;
  let held = false;
  vi.spyOn(AuthoringProjects.prototype, 'change').mockImplementation(async function <T>(
    this: AuthoringProjects,
    change: (items: import('./authoringProjects').AuthoringProject[]) => T | Promise<T>
  ): Promise<T> {
    if (!held) {
      held = true;
      started();
      await gate;
    }
    return original.call(this, change) as Promise<T>;
  });
  const pending = authoring.trialLoaded(1, 's', draft.id, service as never);
  const rejected = expect(pending).rejects.toThrow();
  await start;
  await writeFile(join(project, draft.directory, 'view.html'), '<!-- newer source B -->');
  await authoring.stageTrial(1, 's', draft.id, service as never);
  path = installed;
  release();
  await rejected;
  const report = await authoring.inspect(1, 's', draft.id, service as never);
  if (!report.ok) throw Error(report.error);
  expect(report.trial?.current).toBe(false);
});
async function create() {
  const result = await authoring.create(1, 's', undefined, {
    template: 'workspace',
    request: '做一个记忆插件',
  });
  if (!result.ok) throw Error(result.error);
  return result.draft;
}
it('persists multiple projects and rebinds a draft after restart without overwriting edited source', async () => {
  const one = await create();
  await writeFile(join(project, one.directory, 'view.html'), '<!-- edited -->');
  const two = await authoring.create(1, 's', undefined, {
    template: 'tool',
    request: '模型只读工具',
  });
  expect(two.ok).toBe(true);
  authoring.releaseOwner(1);
  authoring = new PluginAuthoring(options());
  const list = await authoring.context(2, 's');
  expect(list.ok).toBe(true);
  if (!list.ok) throw Error(list.error);
  expect(list.drafts).toHaveLength(2);
  expect(list.capabilities.hostVersion).toBe('0.2.110');
  await expect(authoring.open(2, 's', one.id)).resolves.toMatchObject({
    ok: true,
    draft: { id: one.id },
  });
  expect(await readFile(join(project, one.directory, 'view.html'), 'utf8')).toBe('<!-- edited -->');
  await expect(authoring.open(3, 'other', one.id)).rejects.toThrow();
});
it('rejects a replaced source or registry symlink, never resets a corrupt registry', async () => {
  const draft = await create();
  await rename(join(project, draft.directory), join(temp, 'moved'));
  await symlink(join(temp, 'moved'), join(project, draft.directory), 'junction');
  await expect(authoring.open(1, 's', draft.id)).rejects.toThrow();
  await writeFile(join(stateRoot, 'projects.json'), '{bad');
  const restarted = new PluginAuthoring(options());
  await expect(restarted.context(1, 's')).rejects.toThrow();
  expect(await readFile(join(stateRoot, 'projects.json'), 'utf8')).toBe('{bad');
});
it('attests exact content only, never confuses static validation with runtime/business/model verification', async () => {
  const draft = await create();
  let result = await authoring.inspect(1, 's', draft.id);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.error);
  expect(result.checks.static.state).toBe('passed');
  expect(result.checks.runtime.state).toBe('unverified');
  expect(result.checks.models.state).toBe('unverified');
  await authoring.evidence(1, 's', draft.id, {
    layer: 'business',
    sourceHash: result.sourceHash,
    note: '手动验证了保存和读取',
  });
  result = await authoring.inspect(1, 's', draft.id);
  if (!result.ok) throw Error(result.error);
  expect(result.checks.business.reportedBy).toBe('user');
  await writeFile(join(project, draft.directory, 'view.html'), '<!-- changed -->');
  const changed = await authoring.inspect(1, 's', draft.id);
  if (!changed.ok) throw Error(changed.error);
  expect(changed.checks.business.state).toBe('stale');
  await expect(
    authoring.evidence(1, 's', draft.id, {
      layer: 'models',
      sourceHash: result.sourceHash,
      note: 'old',
      models: ['vendor-a/model', 'vendor-b/model'],
    })
  ).rejects.toThrow();
});
it('tests require explicit execution consent, preserve caller files and bound output/time', async () => {
  const draft = await create();
  await expect(authoring.test(1, 's', draft.id, false)).rejects.toThrow();
  const run = await authoring.test(1, 's', draft.id, true);
  expect(run.ok).toBe(true);
  expect(JSON.stringify(run).length).toBeLessThan(20000);
  const report = await authoring.inspect(1, 's', draft.id);
  if (!report.ok) throw Error(report.error);
  expect(report.checks.tests.state).toBe('passed');
});
it('exports a real deterministic installable package without installing, and stale IDs cannot export', async () => {
  const draft = await create();
  const one = await authoring.export(1, 's', draft.id);
  expect(one.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(one.id).toBe(draft.id);
  const two = await authoring.export(1, 's', draft.id);
  expect(two.sha256).toBe(one.sha256);
  await expect(authoring.export(2, 's', draft.id)).rejects.toThrow();
});

it('treats display versions as data, never as export path segments; malformed test evidence fails closed', async () => {
  const draft = await create(),
    file = join(project, draft.directory, 'enso-plugin.json'),
    manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.version = '../../not-a-path';
  await writeFile(file, JSON.stringify(manifest));
  const packed = await authoring.export(1, 's', draft.id);
  expect(packed.file.startsWith(`${stateRoot}/export-`)).toBe(true);
  expect(packed.name).not.toContain('/');
  await packed.cleanup();
  const registry = join(stateRoot, 'projects.json'),
    state = JSON.parse(await readFile(registry, 'utf8'));
  state.projects[0].tests = {
    hash: 'a'.repeat(64),
    at: Date.now(),
    detail: 'not a real passing test',
    passed: 'false',
  };
  await writeFile(registry, JSON.stringify(state));
  await expect(new PluginAuthoring(options()).context(1, 's')).rejects.toThrow();
});
it('trial uses a distinct stable identity, never touches production data, and old source verification expires', async () => {
  const draft = await create();
  const staging = vi.fn(async (source: { kind: string; path: string }) => ({
    ok: true as const,
    preview: {
      token: 'token',
      id: JSON.parse(await readFile(join(source.path, 'enso-plugin.json'), 'utf8')).id,
    },
  }));
  const service = { stage: staging, discard: vi.fn(), list: () => ({ plugins: [] }) };
  const trial = await authoring.stageTrial(1, 's', draft.id, service as never);
  expect(trial.ok).toBe(true);
  if (!trial.ok) throw Error(trial.error);
  expect(trial.preview.id).not.toBe(draft.id);
  expect(trial.preview.id).toMatch(/^local\.try/);
  const source = JSON.parse(
    await readFile(join(project, draft.directory, 'enso-plugin.json'), 'utf8')
  );
  expect(source.id).toBe(draft.id);
  await expect(authoring.stageTrial(2, 's', draft.id, service as never)).rejects.toThrow();
});

it('cannot acknowledge old installed trial code as a newly staged source version', async () => {
  const draft = await create();
  let installedPath = '',
    installedBuild = 'build1';
  const service = {
    stage: async (source: { path: string }) => {
      installedPath = source.path;
      return { ok: true, preview: { id: draft.trialId, token: 't' } };
    },
    discard: vi.fn(),
    list: () => ({
      plugins: [
        {
          id: draft.trialId,
          state: 'enabled',
          build: installedBuild,
          version: '0.1.0',
          commands: [],
          views: [],
        },
      ],
    }),
    installedPackage: () => ({ path: installedPath, build: installedBuild }),
  };
  await authoring.stageTrial(1, 's', draft.id, service as never);
  const firstPath = installedPath;
  await expect(authoring.trialLoaded(1, 's', draft.id, service as never)).resolves.toMatchObject({
    ok: true,
  });
  await writeFile(join(project, draft.directory, 'view.html'), '<!-- new source -->');
  await authoring.stageTrial(1, 's', draft.id, service as never);
  installedPath = firstPath;
  await expect(authoring.trialLoaded(1, 's', draft.id, service as never)).rejects.toThrow();
});

it('a corrupted trial identity can never target production data for deletion', async () => {
  const draft = await create();
  const file = join(stateRoot, 'projects.json'),
    raw = JSON.parse(await readFile(file, 'utf8'));
  raw.projects[0].draft.trialId = draft.id;
  await writeFile(file, JSON.stringify(raw));
  const uninstall = vi.fn();
  await expect(authoring.finishTrial(1, 's', draft.id, { uninstall } as never)).rejects.toThrow();
  expect(uninstall).not.toHaveBeenCalled();
});

it('coalesces concurrent installed-edit requests and isolates two projects at the same physical root', async () => {
  const original = await create();
  const path = join(project, original.directory);
  const service = { installedPackage: () => ({ path, version: '0.1.0', build: 'one' }) };
  const installedId = 'org.example.existing';
  const json = JSON.parse(await readFile(join(path, 'enso-plugin.json'), 'utf8'));
  json.id = installedId;
  await writeFile(join(path, 'enso-plugin.json'), JSON.stringify(json));
  const results = await Promise.all([
    authoring.editInstalled(1, 's', installedId, service as never),
    authoring.editInstalled(2, 's', installedId, service as never),
  ]);
  expect(results[0]).toEqual(results[1]);
  const list = await authoring.context(1, 's');
  if (!list.ok) throw Error(list.error);
  expect(list.drafts.filter((row) => row.id === installedId)).toHaveLength(1);
  const other = new PluginAuthoring({
    ...options(),
    workspace: () => ({ cwd: project, projectId: 'other-project' }),
  });
  const copied = await other.editInstalled(3, 's', installedId, service as never);
  if (!copied.ok) throw Error(copied.error);
  const report = await other.inspect(3, 's', installedId);
  if (!report.ok) throw Error(report.error);
  await other.evidence(3, 's', installedId, {
    layer: 'business',
    sourceHash: report.sourceHash,
    note: 'other project verified',
  });
  const first = await authoring.inspect(1, 's', installedId);
  if (!first.ok) throw Error(first.error);
  expect(first.checks.business.state).toBe('unverified');
});

it('formal preview uses the validated snapshot and a later installed build invalidates old confirmation', async () => {
  const draft = await create();
  const source = join(project, draft.directory);
  const service = new ExtensionPluginService({
    root: join(temp, 'plugins'),
    hostVersion: '0.2.110',
    hostPath: '/unused',
    env: {},
    fork: vi.fn() as never,
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
    const first = await authoring.stage(1, 's', draft.id, service);
    if (!first.ok) throw Error(first.error);
    expect((await service.commit(first.preview.token, 1)).ok).toBe(true);
    const json = JSON.parse(await readFile(join(source, 'enso-plugin.json'), 'utf8'));
    json.version = '0.2.0';
    await writeFile(join(source, 'enso-plugin.json'), JSON.stringify(json));
    const old = await authoring.stage(1, 's', draft.id, service);
    if (!old.ok) throw Error(old.error);
    json.version = '0.3.0';
    await writeFile(join(source, 'enso-plugin.json'), JSON.stringify(json));
    const latest = await service.stage({ kind: 'dir', path: source }, 1);
    if (!latest.ok) throw Error(latest.error);
    expect((await service.commit(latest.preview.token, 1)).ok).toBe(true);
    expect(await service.commit(old.preview.token, 1)).toMatchObject({ ok: false });
    expect(service.list().plugins[0].version).toBe('0.3.0');
  } finally {
    await service.dispose();
  }
});
