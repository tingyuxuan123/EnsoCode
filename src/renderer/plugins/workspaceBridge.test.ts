import { expect, it, vi } from 'vitest';
import { createWorkspaceBridge } from './workspaceBridge';

const a = { projectId: 'a' },
  b = { projectId: 'b' };
const projects = [
  { key: 'a', name: 'a', kind: 'project' as const, context: a },
  { key: 'b', name: 'b', kind: 'project' as const, context: b },
];
it('selection requires a real gesture and registered identifiers; per-call context is immutable', async () => {
  const call = vi.fn(
    async (_method: string, _args: unknown, _gesture: boolean, workspace: unknown) => workspace
  );
  const list = vi.fn(async () => ({ current: a, projects }));
  const bridge = createWorkspaceBridge({ list, call });
  expect(await bridge('__host.projects.list', {}, false)).toEqual({ current: a, projects });
  await expect(bridge('__host.projects.select', b, false)).rejects.toThrow();
  await expect(
    bridge('__host.projects.select', { projectId: 'b', path: '/secret' }, true)
  ).rejects.toThrow();
  await expect(bridge('__host.projects.select', { projectId: 'missing' }, true)).rejects.toThrow();
  const first = bridge('read', {}, false);
  await bridge('__host.projects.select', b, true);
  expect(await first).toBeUndefined();
  expect(await bridge('read', {}, false)).toEqual(b);
  await bridge('__host.projects.select', null, true);
  expect(await bridge('read', {}, false)).toBeNull();
  expect(await bridge('__host.projects.list', {}, false)).toMatchObject({ current: null });
});
