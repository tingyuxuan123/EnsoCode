import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { SourceAuthorityRegistry } from '../sourceAuthorityRegistry';
import { DesignProjectsService } from './projects';
import { DesignStorage } from './storage';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'design-projects-'));
  temps.push(temp);
  const dir = await realpath(temp);
  const registry = new SourceAuthorityRegistry({ registryFile: path.join(dir, 'authority.json') });
  const storage = new DesignStorage(path.join(dir, 'storage'));
  const workspace = path.join(dir, 'Designs');
  const service = new DesignProjectsService(workspace, registry, storage);
  return { dir, workspace, registry, storage, service };
}
it('creates only named children of the managed workspace and registers authoritative roots', async () => {
  const { service, workspace, registry } = await fixture();
  for (const name of ['', '.', '..', '../escape', '/absolute', 'a/b', 'a\\b', 'bad\0name']) {
    await expect(service.request({ op: 'create', name })).rejects.toThrow();
  }
  const first = await service.request({ op: 'create', name: 'Weekend' });
  const second = await service.request({ op: 'create', name: 'Weekend' });
  expect(first).toMatchObject({ ok: true, project: { path: path.join(workspace, 'Weekend') } });
  expect(second).toMatchObject({ ok: true, project: { path: path.join(workspace, 'Weekend-1') } });
  expect(registry.rendererProjection().projects).toHaveLength(2);
});
it('never adopts an existing symlink or overwrites a directory when naming a project', async () => {
  const { dir, workspace, service } = await fixture();
  await mkdir(workspace);
  await mkdir(path.join(dir, 'outside'));
  await writeFile(path.join(dir, 'outside/keep'), 'mine');
  // 'junction' is the unprivileged Windows directory link; POSIX ignores the type.
  await symlink(path.join(dir, 'outside'), path.join(workspace, 'Weekend'), 'junction');
  expect(await service.request({ op: 'create', name: 'Weekend' })).toMatchObject({
    project: { path: path.join(workspace, 'Weekend-1') },
  });
  expect(await readFile(path.join(dir, 'outside/keep'), 'utf8')).toBe('mine');
});
it('archive is persistent gallery visibility, not project authority removal or disk deletion', async () => {
  const { service, registry, workspace, storage } = await fixture();
  await service.request({ op: 'create', name: 'Weekend' });
  const projectId = registry.rendererProjection().projects[0].projectId;
  await service.request({ op: 'setArchived', projectId, archived: true });
  const reloaded = new DesignProjectsService(workspace, registry, storage);
  expect(await reloaded.request({ op: 'list' })).toMatchObject({
    projects: [],
    archivedProjects: [{ projectId, path: path.join(workspace, 'Weekend') }],
  });
  expect(registry.project(projectId)?.state).toBe('active');
  await reloaded.request({ op: 'setArchived', projectId, archived: false });
  expect(await reloaded.request({ op: 'list' })).toMatchObject({
    projects: [{ projectId }],
    archivedProjects: [],
  });
  await expect(
    reloaded.request({ op: 'setArchived', projectId: 'unknown', archived: true })
  ).rejects.toThrow();
});
