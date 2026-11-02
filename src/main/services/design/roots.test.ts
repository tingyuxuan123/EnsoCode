import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const authority = vi.hoisted(() => ({ project: vi.fn(), pluginProjectRoot: vi.fn() }));
vi.mock('../../ipc/agent', () => ({
  getSourceAuthorityRegistry: () => ({ project: authority.project }),
  pluginProjectRoot: authority.pluginProjectRoot,
}));

import { resolveDesignRoot } from './roots';

const temps: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(temps.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('session 仅由 pluginProjectRoot 推导，project 仅由权威记录推导', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-root-'));
  temps.push(dir);
  authority.pluginProjectRoot.mockReturnValue(dir);
  authority.project.mockReturnValue({ kind: 'local', state: 'active', canonicalPath: dir });
  expect(await resolveDesignRoot({ kind: 'session', sessionId: 's' })).toMatchObject({
    path: await realpath(dir),
  });
  expect(authority.pluginProjectRoot).toHaveBeenCalledWith('s');
  expect(await resolveDesignRoot({ kind: 'project', projectId: 'p' })).toMatchObject({
    path: await realpath(dir),
  });
  expect(authority.project).toHaveBeenCalledWith('p');
});
it('SSH、归档、未知根明确 ROOT_UNAVAILABLE，不拿远端路径读本机', async () => {
  authority.project.mockReturnValue({ kind: 'ssh', state: 'active', canonicalPath: '/tmp' });
  await expect(resolveDesignRoot({ kind: 'project', projectId: 'remote' })).rejects.toMatchObject({
    code: 'ROOT_UNAVAILABLE',
  });
  authority.project.mockReturnValue({ kind: 'local', state: 'archived', canonicalPath: '/tmp' });
  await expect(resolveDesignRoot({ kind: 'project', projectId: 'archived' })).rejects.toMatchObject(
    { code: 'ROOT_UNAVAILABLE' }
  );
  authority.pluginProjectRoot.mockReturnValue(null);
  await expect(resolveDesignRoot({ kind: 'session', sessionId: 'missing' })).rejects.toMatchObject({
    code: 'ROOT_UNAVAILABLE',
  });
});
