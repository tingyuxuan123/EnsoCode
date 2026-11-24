import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HostToPhone, PairFileTarget } from '@enso/pair';
import type {
  ConversationAuthority,
  ProjectAuthority,
  ProjectedMessage,
} from '@shared/types/agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userData: '',
  conversations: new Map<string, ConversationAuthority>(),
  projects: new Map<string, ProjectAuthority>(),
  worktree: undefined as { projectId: string; path: string } | undefined,
  readMessages: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  BrowserWindow: vi.fn(),
  shell: {},
}));
vi.mock('./agent', () => ({
  getSourceAuthorityRegistry: () => ({
    conversation: (id: string) => mocks.conversations.get(id),
    project: (id: string) => mocks.projects.get(id),
  }),
}));
vi.mock('./worktree', () => ({ sessionWorktree: () => mocks.worktree }));
vi.mock('../services/pairSessionHistory', () => ({ readPairSessionMessages: mocks.readMessages }));

import { createPairPreviewsPort } from './pairPreview';

describe('Main preview authority', () => {
  let tmp: string;
  let root: string;
  const messages: ProjectedMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'secret.html http://localhost:5555/' }] },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'Created report.html http://localhost:5173/' }],
    },
  ];
  const factory = vi.fn();
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'enso-preview-authority-'));
    root = path.join(tmp, 'project');
    mkdirSync(root);
    mocks.userData = tmp;
    mocks.conversations.clear();
    mocks.projects.clear();
    mocks.worktree = undefined;
    mocks.projects.set('p', { projectId: 'p', canonicalPath: root, state: 'active', version: 1 });
    mocks.conversations.set('s', {
      conversationId: 's',
      projectId: 'p',
      kind: 'root',
      lifecycle: 'ready',
      version: 1,
      sessionFile: path.join(tmp, 'agent/sessions/s.jsonl'),
    });
    mocks.readMessages.mockReset().mockResolvedValue(messages);
    writeFileSync(path.join(root, 'report.html'), 'report');
    writeFileSync(path.join(root, 'secret.html'), 'secret');
    factory.mockReset();
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));
  async function list(target: PairFileTarget) {
    const frames: HostToPhone[] = [];
    const port = createPairPreviewsPort(factory);
    await port.handle('pair', { type: 'preview-list', requestId: 'r', target }, async (frame) => {
      frames.push(frame);
      return true;
    });
    port.release('pair');
    const frame = frames[0];
    if (frame.type !== 'preview-list-result') throw new Error('missing list');
    return frame;
  }
  it('uses Main metadata and authoritative cached transcript, not arbitrary/user/renderer paths', async () => {
    const result = await list({ sessionId: 's' });
    expect(result.entries.map((item) => item.label)).toEqual([
      'http://127.0.0.1:5173/',
      'report.html',
    ]);
    expect(mocks.readMessages).toHaveBeenCalledWith(
      path.join(tmp, 'agent/sessions'),
      mocks.conversations.get('s')?.sessionFile
    );
    expect((await list({ sessionId: 'missing' })).error).toBe('unavailable');
    expect(factory).not.toHaveBeenCalled();
  });
  it('rejects ended, removed, SSH and mismatched worktrees; uses the actual worktree', async () => {
    const project = mocks.projects.get('p')!;
    const conversation = mocks.conversations.get('s')!;
    for (const patch of [{ state: 'removed' as const }, { kind: 'ssh' as const }]) {
      mocks.projects.set('p', { ...project, ...patch });
      expect((await list({ sessionId: 's' })).error).toBe('unavailable');
    }
    mocks.projects.set('p', project);
    mocks.conversations.set('s', { ...conversation, lifecycle: 'ended' });
    expect((await list({ sessionId: 's' })).error).toBe('unavailable');
    mocks.conversations.set('s', conversation);
    mocks.worktree = { projectId: 'other', path: root };
    expect((await list({ sessionId: 's' })).error).toBe('unavailable');
    const worktree = path.join(tmp, 'tree');
    mkdirSync(worktree);
    writeFileSync(path.join(worktree, 'index.html'), 'worktree');
    mocks.worktree = { projectId: 'p', path: worktree };
    expect((await list({ sessionId: 's' })).entries.map((item) => item.label)).toEqual([
      'http://127.0.0.1:5173/',
      'index.html',
    ]);
  });
  it('rejects ownership changes during transcript reads', async () => {
    mocks.readMessages.mockImplementationOnce(async () => {
      mocks.conversations.delete('s');
      return messages;
    });
    expect((await list({ sessionId: 's' })).error).toBe('unavailable');
  });
  it('invalidates a deleted workspace directory even when metadata has not caught up', async () => {
    const close = vi.fn();
    factory.mockResolvedValue({
      capture: async () => ({
        width: 390,
        height: 844,
        dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      }),
      close,
    });
    const port = createPairPreviewsPort(factory);
    const frames: HostToPhone[] = [];
    const reply = async (frame: HostToPhone) => {
      frames.push(frame);
      return true;
    };
    const entryId = (await list({ sessionId: 's' })).entries[0].id;
    await port.handle(
      'pair',
      {
        type: 'preview-open',
        requestId: 'open',
        target: { sessionId: 's' },
        entryId,
        width: 390,
        height: 844,
      },
      reply
    );
    const opened = frames.at(-1);
    if (opened?.type !== 'preview-result' || !opened.previewId) throw new Error('missing preview');
    rmSync(root, { recursive: true, force: true });
    await port.handle(
      'pair',
      { type: 'preview-frame', requestId: 'deleted', previewId: opened.previewId },
      reply
    );
    expect(frames.at(-1)).toMatchObject({ error: 'unavailable' });
    expect(close).toHaveBeenCalledOnce();
    port.release('pair');
  });
});
