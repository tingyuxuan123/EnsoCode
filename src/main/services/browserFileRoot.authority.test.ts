import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import * as policy from './browserFileRoot';
import { resolveLocalUnderCwd } from './filesWorkspace';

it('scratch 浏览器只能以本会话目录为根，不接受 worktree 或指向 sibling 的 symlink', () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'enso-browser-scratch-')));
  try {
    const id = '11111111-1111-4111-8111-111111111111';
    const sibling = '22222222-2222-4222-8222-222222222222';
    mkdirSync(path.join(root, id));
    mkdirSync(path.join(root, sibling));
    const inside = path.join(root, id, 'index.html');
    const outside = path.join(root, sibling, 'secret.html');
    writeFileSync(inside, 'own');
    writeFileSync(outside, 'sibling');
    const project = { projectId: 'p', state: 'active', kind: 'scratch', canonicalPath: root };
    const conversation = { conversationId: id, projectId: 'p', lifecycle: 'draft' };
    expect(
      policy.pickBrowserFileRoot({
        conversation,
        project,
        worktree: { projectId: 'p', path: root },
      })
    ).toBe(path.join(root, id));
    const cwd = policy.pickBrowserFileRoot({ conversation, project })!;
    expect(policy.assertBrowserUrl(pathToFileURL(inside).href, cwd).protocol).toBe('file:');
    expect(() => policy.assertBrowserUrl(pathToFileURL(outside).href, cwd)).toThrow();
    expect(resolveLocalUnderCwd(cwd, `../${sibling}/secret.html`)).toBeNull();
    symlinkSync(path.join(root, sibling), path.join(cwd, 'escape'), 'junction');
    expect(resolveLocalUnderCwd(cwd, 'escape/secret.html')).toBeNull();
    expect(() =>
      policy.assertBrowserUrl(pathToFileURL(path.join(cwd, 'escape/secret.html')).href, cwd)
    ).toThrow();
    expect(
      policy.pickBrowserFileRoot({
        conversation: { ...conversation, conversationId: '../escape' },
        project,
      })
    ).toBeNull();
    rmSync(path.join(root, id), { recursive: true });
    symlinkSync(path.join(root, sibling), path.join(root, id), 'junction');
    expect(policy.pickBrowserFileRoot({ conversation, project })).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('仅可信活动本地会话解析 cwd，拒绝错配 worktree', () => {
  expect(policy).toHaveProperty('pickBrowserFileRoot');
  const pick = (policy as unknown as { pickBrowserFileRoot: (input: unknown) => string | null })
    .pickBrowserFileRoot;
  const conversation = { projectId: 'p', lifecycle: 'active' };
  const project = { projectId: 'p', state: 'active', kind: 'local', canonicalPath: '/repo' };
  expect(pick({ conversation, project })).toBe('/repo');
  expect(pick({ conversation, project: { ...project, kind: undefined } })).toBe('/repo');
  expect(pick({ project })).toBeNull();
  expect(pick({ conversation, project: { ...project, kind: 'ssh' } })).toBeNull();
  expect(pick({ conversation, project: { ...project, state: 'archived' } })).toBeNull();
  expect(pick({ conversation, project: { ...project, projectId: 'other' } })).toBeNull();
  expect(
    pick({ conversation, project, worktree: { projectId: 'other', path: '/other' } })
  ).toBeNull();
  expect(pick({ conversation, project, worktree: { projectId: 'p', path: '/worktree' } })).toBe(
    '/worktree'
  );
});
