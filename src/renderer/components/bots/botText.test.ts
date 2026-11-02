import { describe, expect, it } from 'vitest';
import { cloneTitle, localProjects } from './botText';

it('Bot 工作区只列普通本地项目，不列 scratch 或 SSH', () => {
  const projects = [
    { id: 'legacy', name: 'legacy', path: '/legacy' },
    { id: 'local', name: 'local', path: '/local', kind: 'local' as const },
    { id: 'scratch', name: 'Temporary chats', path: '/data/scratch', kind: 'scratch' as const },
    { id: 'ssh', name: 'remote', path: '/remote', kind: 'ssh' as const },
  ];
  expect(localProjects(projects).map((project) => project.id)).toEqual(['legacy', 'local']);
});

describe('cloneTitle', () => {
  it('重名时依次加序号', () => {
    expect(cloneTitle('team 的副本', ['team'])).toBe('team 的副本');
    expect(cloneTitle('team 的副本', ['team 的副本'])).toBe('team 的副本 2');
    expect(cloneTitle('team 的副本', ['team 的副本', 'team 的副本 2'])).toBe('team 的副本 3');
  });
});
