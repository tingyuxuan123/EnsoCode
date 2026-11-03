import { afterEach, expect, it, vi } from 'vitest';

const { projects, addProject } = vi.hoisted(() => ({
  projects: [
    { id: 'a', name: 'Alpha', path: '/a' },
    { id: 'broken', name: 'Broken', path: '/broken' },
  ],
  addProject: vi.fn(),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => ({ projects, addProject }) },
}));

import { createGalleryProject, listGalleryProjects, setGalleryProjectArchived } from './projects';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('one missing project root cannot block the remaining gallery sources', async () => {
  vi.stubGlobal('electronAPI', {
    design: {
      projects: async () => ({
        ok: true,
        workspacePath: '/Designs',
        projects: [
          { projectId: 'a', path: '/a' },
          { projectId: 'broken', path: '/broken' },
        ],
        archivedProjects: [],
      }),
      resolveRoot: async (ref: { projectId: string }) =>
        ref.projectId === 'broken'
          ? { ok: false, error: 'missing' }
          : { ok: true, root: { ref, path: '/a' } },
    },
  });
  expect(await listGalleryProjects()).toEqual({
    workspacePath: '/Designs',
    projects: [{ name: 'Alpha', path: '/a' }],
    archivedProjects: [],
  });
});
it('archive and restore send only the project id derived from the authority list', async () => {
  const requests = vi.fn(async (request: { op: string }) =>
    request.op === 'list'
      ? {
          ok: true,
          workspacePath: '/Designs',
          projects: [{ projectId: 'a', path: '/a' }],
          archivedProjects: [],
        }
      : { ok: true }
  );
  vi.stubGlobal('electronAPI', { design: { projects: requests } });
  await setGalleryProjectArchived('/a', true);
  expect(requests).toHaveBeenLastCalledWith({ op: 'setArchived', projectId: 'a', archived: true });
  await expect(setGalleryProjectArchived('/outside', false)).rejects.toThrow();
  expect(requests.mock.calls.some(([request]) => 'path' in request)).toBe(false);
});
it('creating a gallery project registers the returned Main path with the existing settings authority adapter', async () => {
  addProject.mockResolvedValue({ id: 'new', path: '/Designs/Weekend' });
  const requests = vi.fn(async () => ({
    ok: true,
    project: { projectId: 'new', path: '/Designs/Weekend' },
  }));
  vi.stubGlobal('electronAPI', {
    design: {
      projects: requests,
      resolveRoot: async (ref: unknown) => ({ ok: true, root: { ref, path: '/Designs/Weekend' } }),
    },
  });
  expect(await createGalleryProject('Weekend')).toEqual({
    path: '/Designs/Weekend',
    name: 'Weekend',
  });
  expect(requests).toHaveBeenCalledWith({ op: 'create', name: 'Weekend' });
  expect(addProject).toHaveBeenCalledWith('/Designs/Weekend');
});
