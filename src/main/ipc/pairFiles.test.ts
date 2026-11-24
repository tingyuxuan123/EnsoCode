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

import { createPairFilesPort } from './pairFiles';

describe('Main device file authority', () => {
  let tmp: string;
  let root: string;
  const messages: ProjectedMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'secret.txt' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Created report.txt' }] },
  ];
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'enso-pair-authority-'));
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
      sessionFile: path.join(tmp, 'agent', 'sessions', 's.jsonl'),
    });
    mocks.readMessages.mockReset().mockResolvedValue(messages);
    writeFileSync(path.join(root, 'report.txt'), 'report bytes');
    writeFileSync(path.join(root, 'secret.txt'), 'never mentioned by assistant');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  async function list(target: PairFileTarget) {
    const frames: HostToPhone[] = [];
    await createPairFilesPort().handle(
      { type: 'file-list', requestId: 'r', target },
      async (frame) => {
        frames.push(frame);
        return true;
      }
    );
    const frame = frames[0];
    if (frame.type !== 'file-list-result') throw new Error('missing file list');
    return frame;
  }

  it('derives Code history/root from Main authority and never lists user-only or arbitrary workspace files', async () => {
    const result = await list({ sessionId: 's' });
    expect(result.files.map((file) => file.rel)).toEqual(['report.txt']);
    expect(mocks.readMessages).toHaveBeenCalledWith(
      path.join(tmp, 'agent', 'sessions'),
      mocks.conversations.get('s')?.sessionFile
    );
    expect((await list({ sessionId: 'forged' })).error).toBe('unavailable');
  });

  it('prefers the authoritative worktree; rejects SSH, removed and ended sessions on the Code route', async () => {
    const worktree = path.join(tmp, 'worktree');
    mkdirSync(worktree);
    writeFileSync(path.join(worktree, 'report.txt'), 'worktree version');
    mocks.worktree = { projectId: 'p', path: worktree };
    expect((await list({ sessionId: 's' })).files[0]?.size).toBe(
      Buffer.byteLength('worktree version')
    );
    mocks.worktree = { projectId: 'other', path: root };
    expect((await list({ sessionId: 's' })).error).toBe('unavailable');
    mocks.worktree = undefined;
    for (const patch of [{ kind: 'ssh' as const }, { state: 'removed' as const }]) {
      const project = mocks.projects.get('p')!;
      mocks.projects.set('p', { ...project, ...patch });
      expect((await list({ sessionId: 's' })).error).toBe('unavailable');
      mocks.projects.set('p', project);
    }
    const conversation = mocks.conversations.get('s')!;
    mocks.conversations.set('s', { ...conversation, lifecycle: 'ended' });
    expect((await list({ sessionId: 's' })).error).toBe('unavailable');
  });

  it('drops results when ownership/root changes while authoritative history is loading', async () => {
    mocks.readMessages.mockImplementationOnce(async () => {
      mocks.conversations.delete('s');
      return messages;
    });
    expect((await list({ sessionId: 's' })).error).toBe('unavailable');
  });

  it('prioritizes newly generated files over more than 128 older artifacts', async () => {
    const older: ProjectedMessage[] = [];
    for (let i = 0; i < 130; i++) {
      const name = `old-${i}.txt`;
      writeFileSync(path.join(root, name), name);
      older.push({
        role: 'assistant',
        content: [{ type: 'toolCall', id: `write-${i}`, name: 'write', arguments: { path: name } }],
      });
    }
    writeFileSync(path.join(root, 'new-report.docx'), 'new');
    mocks.readMessages.mockResolvedValue([
      ...older,
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Generated new-report.docx with bash' }],
      },
    ]);
    const result = await list({ sessionId: 's' });
    expect(result.files).toHaveLength(128);
    expect(result.files[0]?.name).toBe('new-report.docx');
    expect(result.files.some((file) => file.name === 'old-0.txt')).toBe(false);
  });
});
