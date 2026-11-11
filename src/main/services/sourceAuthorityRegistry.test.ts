import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeRemoteProjectPath, SourceAuthorityRegistry } from './sourceAuthorityRegistry';

const roots: string[] = [];
const temporary = () => {
  const root = path.join(process.cwd(), 'temp', `source-authority-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('SourceAuthorityRegistry', () => {
  it('retired coordinator stays on disk but is hidden and cannot be selected or spawned', () => {
    const root = temporary();
    const registryFile = path.join(root, 'registry.json');
    const registry = new SourceAuthorityRegistry({ registryFile });
    const scratch = registry.ensureScratchProject(path.join(root, 'scratch'))!;
    const coordinatorId = '11111111-1111-4111-8111-111111111111';
    const targetId = '22222222-2222-4222-8222-222222222222';
    const history = path.join(root, 'coordinator.jsonl');
    writeFileSync(history, 'preserved history\n');
    const coordinator = {
      conversationId: coordinatorId,
      projectId: scratch.projectId,
      kind: 'root',
      lifecycle: 'ready',
      version: 1,
      sessionFile: history,
      superAssistant: true,
    };
    const target = {
      ...coordinator,
      conversationId: targetId,
      superAssistant: undefined,
      dispatchedBySuperAssistant: true,
    };
    mkdirSync(path.join(scratch.canonicalPath, coordinatorId));
    writeFileSync(
      registryFile,
      JSON.stringify({
        migrationVersion: 1,
        projects: [scratch],
        conversations: [coordinator, target],
      })
    );
    const before = readFileSync(registryFile, 'utf8');
    const reopened = new SourceAuthorityRegistry({ registryFile });
    expect(reopened.rendererProjection().conversations.map((row) => row.conversationId)).toEqual([
      targetId,
    ]);
    expect(reopened.spawnCwd(coordinatorId)).toBeNull();
    expect(
      reopened.selectConversation({ requestId: 's', conversationId: coordinatorId, version: 1 })
        .accepted
    ).toBe(false);
    expect(
      reopened.createConversation({
        requestId: 'c',
        conversationId: coordinatorId,
        projectId: scratch.projectId,
        projectVersion: scratch.version,
      }).accepted
    ).toBe(false);
    expect(readFileSync(registryFile, 'utf8')).toBe(before);
    expect(readFileSync(history, 'utf8')).toBe('preserved history\n');
    expect(reopened.conversation(coordinatorId)?.sessionFile).toBe(history);
  });

  it('无普通项目也可登记 scratch，幂等且可选但不可由 renderer 创建或删除', () => {
    const root = temporary();
    const registry = new SourceAuthorityRegistry({
      registryFile: path.join(root, 'registry.json'),
    });
    expect(registry).toHaveProperty('ensureScratchProject');
    const project = registry.ensureScratchProject(path.join(root, 'scratch'))!;
    expect(project.kind).toBe('scratch');
    expect(registry.ensureScratchProject(project.canonicalPath)?.projectId).toBe(project.projectId);
    expect(registry.rendererProjection().projects).toEqual([project]);
    expect(
      registry.selectProject({ requestId: 's', projectId: project.projectId, version: 1 }).accepted
    ).toBe(true);
    expect(
      registry.createProject({ requestId: 'p', path: project.canonicalPath, kind: 'scratch' })
        .accepted
    ).toBe(false);
    expect(
      registry.removeProject({ requestId: 'r', projectId: project.projectId, version: 1 }).accepted
    ).toBe(false);
  });

  it('scratch 创建前确认独立 cwd，拒绝坏 id/符号链接且重启保持目录和历史身份', () => {
    const root = temporary();
    const registryFile = path.join(root, 'registry.json');
    const registry = new SourceAuthorityRegistry({ registryFile });
    expect(registry).toHaveProperty('ensureScratchProject');
    const project = registry.ensureScratchProject(path.join(root, 'scratch'))!;
    const id = '11111111-1111-4111-8111-111111111111';
    const create = (conversationId: string) =>
      registry.createConversation({
        requestId: 'c',
        projectId: project.projectId,
        projectVersion: 1,
        conversationId,
      });
    expect(create('../escape').accepted).toBe(false);
    expect(create(id).accepted).toBe(true);
    expect(registry.spawnCwd(id, '/wrong/worktree')).toBe(path.join(project.canonicalPath, id));
    writeFileSync(path.join(project.canonicalPath, id, 'kept.txt'), 'keep');
    registry.markReady(id, path.join(root, 'history.jsonl'), { providerId: 'p', modelId: 'm' });
    const reloaded = new SourceAuthorityRegistry({ registryFile });
    expect(reloaded.spawnCwd(id)).toBe(path.join(project.canonicalPath, id));
    expect(reloaded.conversation(id)?.sessionFile).toBe(path.join(root, 'history.jsonl'));
    const other = '22222222-2222-4222-8222-222222222222';
    symlinkSync(
      path.join(project.canonicalPath, id),
      path.join(project.canonicalPath, other),
      'junction'
    );
    expect(create(other).accepted).toBe(false);
    expect(registry.conversation(other)).toBeUndefined();
  });

  it('scratch 根被替换为外部 symlink 后重启不得把它规范化成可信路径', () => {
    const root = temporary();
    const registryFile = path.join(root, 'registry.json');
    const registry = new SourceAuthorityRegistry({ registryFile });
    const scratch = path.join(root, 'scratch');
    const project = registry.ensureScratchProject(scratch)!;
    const outside = path.join(root, 'outside');
    mkdirSync(outside);
    rmSync(scratch, { recursive: true });
    symlinkSync(outside, scratch, 'junction');
    const reloaded = new SourceAuthorityRegistry({ registryFile });
    expect(reloaded.project(project.projectId)?.canonicalPath).toBe(scratch);
    expect(reloaded.ensureScratchProject(scratch)).toBeUndefined();
    expect(
      reloaded.createConversation({
        requestId: 'c',
        projectId: project.projectId,
        projectVersion: 1,
      }).accepted
    ).toBe(false);
  });

  const botId = '33333333-3333-4333-8333-333333333333';
  const chatId = '44444444-4444-4444-8444-444444444444';

  it('bot-home 项目由 Main 幂等登记，renderer 投影与 renderer 操作都看不到它', () => {
    const root = temporary();
    const changes: unknown[] = [];
    const registry = new SourceAuthorityRegistry({
      registryFile: path.join(root, 'registry.json'),
      onChanged: (projection) => changes.push(projection),
    });
    const home = path.join(root, 'bots', botId, 'workspace');
    const first = registry.ensureBotHomeProject(home);
    expect(first?.kind).toBe('bot-home');
    expect(registry.ensureBotHomeProject(home)?.projectId).toBe(first?.projectId);
    if (!first) return;

    const local = registry.createProject({ requestId: 'p', path: home });
    expect(local.accepted && local.value.projectId).not.toBe(first.projectId);

    expect(registry.rendererProjection().projects.map((p) => p.kind)).not.toContain('bot-home');
    expect(changes.at(-1)).toEqual(registry.rendererProjection());
    expect(
      registry.createConversation({ requestId: 'c', projectId: first.projectId, projectVersion: 1 })
        .accepted
    ).toBe(false);
    expect(
      registry.selectProject({ requestId: 's', projectId: first.projectId, version: 1 }).accepted
    ).toBe(false);
    expect(
      registry.removeProject({ requestId: 'r', projectId: first.projectId, version: 1 }).accepted
    ).toBe(false);
  });

  it('bot 会话只由 Main 创建/结束，renderer 投影和通用会话操作拒绝它', () => {
    const root = temporary();
    const registryFile = path.join(root, 'registry.json');
    const registry = new SourceAuthorityRegistry({ registryFile });
    const project = registry.ensureBotHomeProject(path.join(root, 'home'));
    if (!project) throw new Error('no project');
    const conversation = registry.createBotConversation(project.projectId, { botId, chatId });
    expect(conversation?.bot).toEqual({ botId, chatId });
    if (!conversation) return;
    expect(registry.projection().conversations).toHaveLength(1);
    expect(registry.rendererProjection().conversations).toHaveLength(0);
    expect(registry.botConversations().map((c) => c.conversationId)).toEqual([
      conversation.conversationId,
    ]);

    const request = {
      requestId: 'x',
      conversationId: conversation.conversationId,
      version: conversation.version,
    };
    expect(registry.selectConversation(request).accepted).toBe(false);
    expect(registry.endConversation(request).accepted).toBe(false);
    expect(registry.removeConversation(request).accepted).toBe(false);
    expect(
      registry.updateSelection({ ...request, selection: { providerId: 'p', modelId: 'm' } })
        .accepted
    ).toBe(false);

    const reloaded = new SourceAuthorityRegistry({ registryFile });
    expect(reloaded.conversation(conversation.conversationId)?.bot).toEqual({ botId, chatId });

    expect(registry.endBotConversation(conversation.conversationId)?.lifecycle).toBe('ended');
    expect(registry.removeBotConversation(conversation.conversationId)?.conversationId).toBe(
      conversation.conversationId
    );
    expect(registry.conversation(conversation.conversationId)).toBeUndefined();
  });

  it('结束的 bot 会话可由 Main 重新打开；项目不可用或非 bot 会话拒绝', () => {
    const root = temporary();
    const registryFile = path.join(root, 'r.json');
    const registry = new SourceAuthorityRegistry({ registryFile });
    const home = registry.ensureBotHomeProject(path.join(root, 'home'));
    if (!home) throw new Error('no project');
    const draft = registry.createBotConversation(home.projectId, { botId, chatId });
    const ready = registry.createBotConversation(home.projectId, { botId, chatId });
    if (!draft || !ready) throw new Error('no conversation');
    registry.markReady(ready.conversationId, path.join(root, 's.jsonl'), {
      providerId: 'p',
      modelId: 'm',
    });
    registry.endBotConversation(draft.conversationId);
    registry.endBotConversation(ready.conversationId);

    expect(registry.reopenBotConversation(draft.conversationId)?.lifecycle).toBe('draft');
    const reopened = registry.reopenBotConversation(ready.conversationId);
    expect(reopened?.lifecycle).toBe('ready');
    expect(reopened?.sessionFile).toBe(path.join(root, 's.jsonl'));
    expect(
      new SourceAuthorityRegistry({ registryFile }).conversation(ready.conversationId)?.lifecycle
    ).toBe('ready');
    expect(registry.reopenBotConversation('missing')).toBeUndefined();

    registry.endBotConversation(ready.conversationId);
    expect(registry.removeBotHomeProject(home.projectId)).toBe(true);
    expect(registry.reopenBotConversation(ready.conversationId)).toBeUndefined();
    expect(registry.conversation(ready.conversationId)?.lifecycle).toBe('ended');
  });

  it('Main 移除 bot-home 项目时结束其会话；bot 会话也可挂在本地 Code 项目下', () => {
    const root = temporary();
    const registry = new SourceAuthorityRegistry({ registryFile: path.join(root, 'r.json') });
    const home = registry.ensureBotHomeProject(path.join(root, 'home'));
    if (!home) throw new Error('no project');
    const conversation = registry.createBotConversation(home.projectId, { botId, chatId });
    expect(registry.removeBotHomeProject(home.projectId)).toBe(true);
    expect(registry.conversation(conversation!.conversationId)?.lifecycle).toBe('ended');
    expect(registry.createBotConversation(home.projectId, { botId, chatId })).toBeUndefined();

    const codePath = path.join(root, 'code');
    mkdirSync(codePath);
    const code = registry.createProject({ requestId: 'p', path: codePath });
    if (!code.accepted) throw new Error('no code project');
    expect(registry.removeBotHomeProject(code.value.projectId)).toBe(false);
    expect(registry.createBotConversation(code.value.projectId, { botId, chatId })?.projectId).toBe(
      code.value.projectId
    );
  });

  it('atomically owns project/conversation target and ignores later generic settings forgery', () => {
    const root = temporary();
    const projectPath = path.join(root, 'project');
    mkdirSync(projectPath);
    const projectId = '11111111-1111-4111-8111-111111111111';
    const conversationId = '22222222-2222-4222-8222-222222222222';
    const settingsState = { projects: [{ id: projectId, path: projectPath }] };
    const settings: Record<string, unknown> = {
      'enso-settings': { state: settingsState },
      'enso-conversations': {
        state: { conversations: { [conversationId]: { projectId } } },
      },
    };
    const registryFile = path.join(root, 'agent', 'source-registry.json');
    const registry = new SourceAuthorityRegistry({ registryFile, legacySettings: () => settings });
    expect(registry.conversation(conversationId)?.projectId).toBe(projectId);

    settingsState.projects = [{ id: projectId, path: '/tmp/forged-target' }];
    expect(registry.project(projectId)?.canonicalPath).toBe(projectPath);
    expect(readFileSync(registryFile, 'utf8')).not.toContain('forged-target');
  });

  it('uses Main ids, versions, and prevents stale mutations from reviving ended roots', () => {
    const root = temporary();
    const projectPath = path.join(root, 'project');
    mkdirSync(projectPath);
    const ids = ['project-main', 'conversation-main'];
    const registry = new SourceAuthorityRegistry({
      registryFile: path.join(root, 'registry.json'),
      randomUuid: () => ids.shift()!,
    });
    const project = registry.createProject({ requestId: 'p', path: projectPath });
    expect(project.accepted).toBe(true);
    if (!project.accepted) return;
    const conversation = registry.createConversation({
      requestId: 'c',
      projectId: project.value.projectId,
      projectVersion: project.value.version,
    });
    expect(conversation.accepted).toBe(true);
    if (!conversation.accepted) return;
    const ended = registry.endConversation({
      requestId: 'e',
      conversationId: conversation.value.conversationId,
      version: conversation.value.version,
    });
    expect(ended.accepted).toBe(true);
    expect(
      registry.updateSelection({
        requestId: 'stale',
        conversationId: conversation.value.conversationId,
        version: conversation.value.version,
        selection: { providerId: 'forged', modelId: 'forged' },
      })
    ).toEqual({ accepted: false, error: 'Conversation authority is stale or unavailable.' });
  });

  it('persists forkedFrom across create, markReady, and reload', () => {
    const root = temporary();
    const projectPath = path.join(root, 'project');
    mkdirSync(projectPath);
    const registryFile = path.join(root, 'registry.json');
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ];
    const registry = new SourceAuthorityRegistry({
      registryFile,
      randomUuid: () => ids.shift()!,
    });
    const project = registry.createProject({ requestId: 'p', path: projectPath });
    expect(project.accepted).toBe(true);
    if (!project.accepted) return;
    const source = registry.createConversation({
      requestId: 'c1',
      projectId: project.value.projectId,
      projectVersion: project.value.version,
    });
    expect(source.accepted).toBe(true);
    if (!source.accepted) return;
    const origin = {
      conversationId: source.value.conversationId,
      entryId: 'leaf-1',
    };
    const branched = registry.createConversation({
      requestId: 'c2',
      projectId: project.value.projectId,
      projectVersion: project.value.version,
      forkedFrom: origin,
    });
    expect(branched.accepted).toBe(true);
    if (!branched.accepted) return;
    expect(branched.value.forkedFrom).toEqual(origin);
    registry.markReady(
      branched.value.conversationId,
      '/tmp/branch.jsonl',
      { providerId: 'p', modelId: 'm' },
      { conversationId: source.value.conversationId, entryId: 'leaf-2' }
    );
    const reloaded = new SourceAuthorityRegistry({ registryFile });
    expect(reloaded.conversation(branched.value.conversationId)?.forkedFrom).toEqual({
      conversationId: source.value.conversationId,
      entryId: 'leaf-2',
    });
  });

  it('skips legacy session files outside the safe session root', () => {
    const root = temporary();
    const projectPath = path.join(root, 'project');
    const sessions = path.join(root, 'agent', 'sessions');
    mkdirSync(projectPath);
    mkdirSync(sessions, { recursive: true });
    const outside = path.join(root, 'outside.jsonl');
    writeFileSync(outside, '{}\n');
    const registry = new SourceAuthorityRegistry({
      registryFile: path.join(root, 'registry.json'),
      safeSessionRoot: sessions,
      legacySettings: () => ({
        'enso-settings': {
          state: {
            projects: [{ id: '33333333-3333-4333-8333-333333333333', path: projectPath }],
          },
        },
        'enso-conversations': {
          state: {
            conversations: {
              '44444444-4444-4444-8444-444444444444': {
                projectId: '33333333-3333-4333-8333-333333333333',
                sessionFile: outside,
              },
            },
          },
        },
      }),
    });
    expect(registry.conversation('44444444-4444-4444-8444-444444444444')).toMatchObject({
      lifecycle: 'draft',
    });
    expect(
      registry.conversation('44444444-4444-4444-8444-444444444444')?.sessionFile
    ).toBeUndefined();
  });

  it('adopts a phone-generated root id instead of minting a new one', () => {
    const root = temporary();
    const projectPath = path.join(root, 'project');
    mkdirSync(projectPath);
    const phoneSessionId = '55555555-5555-4555-8555-555555555555';
    const registry = new SourceAuthorityRegistry({
      registryFile: path.join(root, 'registry.json'),
      randomUuid: () => 'should-not-mint',
    });
    const project = registry.createProject({ requestId: 'p', path: projectPath });
    expect(project.accepted).toBe(true);
    if (!project.accepted) return;
    const created = registry.createConversation({
      requestId: 'c',
      projectId: project.value.projectId,
      projectVersion: project.value.version,
      conversationId: phoneSessionId,
    });
    expect(created).toEqual({
      accepted: true,
      value: {
        conversationId: phoneSessionId,
        projectId: project.value.projectId,
        kind: 'root',
        lifecycle: 'draft',
        version: 1,
      },
    });
    expect(registry.conversation(phoneSessionId)?.conversationId).toBe(phoneSessionId);
  });

  it('adopts the same live root id idempotently and refuses ended or foreign roots', () => {
    const root = temporary();
    const projectPath = path.join(root, 'project');
    mkdirSync(projectPath);
    const otherPath = path.join(root, 'other');
    mkdirSync(otherPath);
    const phoneSessionId = '66666666-6666-4666-8666-666666666666';
    const registry = new SourceAuthorityRegistry({
      registryFile: path.join(root, 'registry.json'),
    });
    const project = registry.createProject({ requestId: 'p', path: projectPath });
    const other = registry.createProject({ requestId: 'o', path: otherPath });
    expect(project.accepted && other.accepted).toBe(true);
    if (!project.accepted || !other.accepted) return;
    const first = registry.createConversation({
      requestId: 'c1',
      projectId: project.value.projectId,
      projectVersion: project.value.version,
      conversationId: phoneSessionId,
    });
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    expect(
      registry.createConversation({
        requestId: 'c2',
        projectId: project.value.projectId,
        projectVersion: project.value.version,
        conversationId: phoneSessionId,
      })
    ).toEqual(first);
    expect(
      registry.createConversation({
        requestId: 'c3',
        projectId: other.value.projectId,
        projectVersion: other.value.version,
        conversationId: phoneSessionId,
      })
    ).toEqual({ accepted: false, error: 'Conversation authority is stale or unavailable.' });
    const ended = registry.endConversation({
      requestId: 'e',
      conversationId: phoneSessionId,
      version: first.value.version,
    });
    expect(ended.accepted).toBe(true);
    expect(
      registry.createConversation({
        requestId: 'c4',
        projectId: project.value.projectId,
        projectVersion: project.value.version,
        conversationId: phoneSessionId,
      })
    ).toEqual({ accepted: false, error: 'Conversation authority is stale or unavailable.' });
  });

  it('ssh 项目：跳过本地 FS 校验、持久化 connectionId、按连接+路径去重', () => {
    const root = temporary();
    const registryFile = path.join(root, 'registry.json');
    const connA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const connB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const registry = new SourceAuthorityRegistry({
      registryFile,
      resolveSshConnection: (id) => {
        if (id === connA) return { host: 'dev-box', user: 'user', name: 'prod' };
        if (id === connB) return { host: 'other-box', user: 'user', name: 'staging' };
        return null;
      },
    });
    const created = registry.createProject({
      requestId: 'p1',
      path: '/srv/app/',
      kind: 'ssh',
      sshConnectionId: connA,
    });
    expect(created.accepted).toBe(true);
    if (!created.accepted) return;
    expect(created.value.kind).toBe('ssh');
    expect(created.value.sshHost).toBe('user@dev-box');
    expect(created.value.sshConnectionName).toBe('prod');
    expect(created.value.sshConnectionId).toBe(connA);
    expect(created.value.canonicalPath).toBe('/srv/app');
    expect(registry.sshConnectionInUse(connA)).toBe(true);

    const dup = registry.createProject({
      requestId: 'p2',
      path: '/srv/app',
      kind: 'ssh',
      sshConnectionId: connA,
    });
    expect(dup).toEqual({ accepted: true, value: created.value });
    const otherHost = registry.createProject({
      requestId: 'p3',
      path: '/srv/app',
      kind: 'ssh',
      sshConnectionId: connB,
    });
    expect(otherHost.accepted).toBe(true);
    if (!otherHost.accepted) return;
    expect(otherHost.value.projectId).not.toBe(created.value.projectId);

    expect(
      registry.createProject({
        requestId: 'p4',
        path: 'srv/app',
        kind: 'ssh',
        sshConnectionId: connA,
      }).accepted
    ).toBe(false);
    expect(
      registry.createProject({
        requestId: 'p4b',
        path: '/srv/app',
        kind: 'ssh',
        sshConnectionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      })
    ).toEqual({ accepted: false, error: 'SSH 连接不存在。' });

    const reloaded = new SourceAuthorityRegistry({ registryFile });
    const project = reloaded.project(created.value.projectId);
    expect(project?.kind).toBe('ssh');
    expect(project?.sshHost).toBe('user@dev-box');
    expect(project?.sshConnectionId).toBe(connA);

    expect(registry.createProject({ requestId: 'p5', path: '/srv/app' }).accepted).toBe(false);
  });

  it('reuses the existing local project when the same directory is added again', () => {
    const root = temporary();
    const projectPath = path.join(root, 'project');
    mkdirSync(projectPath);
    const registry = new SourceAuthorityRegistry({
      registryFile: path.join(root, 'registry.json'),
    });
    const created = registry.createProject({ requestId: 'p1', path: projectPath });
    expect(created.accepted).toBe(true);
    if (!created.accepted) return;
    const again = registry.createProject({
      requestId: 'p2',
      path: `${projectPath}${path.sep}`,
    });
    expect(again).toEqual(created);
    expect(
      registry.projection().projects.filter((project) => project.state === 'active')
    ).toHaveLength(1);
  });

  it.skipIf(process.platform !== 'win32')('Windows 本地盘符大小写与分隔符变体复用同一项目', () => {
    const root = temporary();
    const projectPath = path.join(root, 'project');
    mkdirSync(projectPath);
    const registry = new SourceAuthorityRegistry({
      registryFile: path.join(root, 'registry.json'),
    });
    const created = registry.createProject({ requestId: 'p1', path: projectPath });
    expect(created.accepted).toBe(true);
    for (const drive of [projectPath[0].toLowerCase(), projectPath[0].toUpperCase()]) {
      const again = registry.createProject({
        requestId: 'p2',
        path: `${drive}${projectPath.slice(1)}`.replaceAll('\\', '/'),
      });
      expect(again).toEqual(created);
    }
    expect(registry.projection().projects).toHaveLength(1);
  });

  it.skipIf(process.platform !== 'win32')(
    'Windows 重启合并旧本地盘符重复映射，离线目录也保留并重映射完整会话',
    () => {
      const root = temporary();
      // Directory is unavailable at restart: identity must not depend on successful realpath.
      const projectPath = path.join(root, 'offline-project');
      const keeperId = '11111111-1111-4111-8111-111111111111';
      const duplicateId = '22222222-2222-4222-8222-222222222222';
      const conversationId = '33333333-3333-4333-8333-333333333333';
      const registryFile = path.join(root, 'registry.json');
      const conversation = {
        conversationId,
        projectId: duplicateId,
        kind: 'root',
        lifecycle: 'ready',
        version: 3,
        sessionFile: path.join(root, 'history.jsonl'),
        selection: { providerId: 'p', modelId: 'm', revision: 2 },
        forkedFrom: { conversationId: keeperId, entryId: 'leaf' },
      };
      writeFileSync(
        registryFile,
        JSON.stringify({
          migrationVersion: 1,
          projects: [
            { projectId: keeperId, canonicalPath: projectPath, state: 'active', version: 1 },
            {
              projectId: duplicateId,
              canonicalPath: `${projectPath[0].toLowerCase()}${projectPath.slice(1).replaceAll('\\', '/')}///`,
              state: 'active',
              version: 2,
            },
          ],
          conversations: [conversation],
        })
      );
      const registry = new SourceAuthorityRegistry({ registryFile });
      expect(registry.project(keeperId)?.state).toBe('active');
      expect(registry.project(duplicateId)).toMatchObject({ state: 'removed', version: 3 });
      expect(registry.conversation(conversationId)).toEqual({
        ...conversation,
        projectId: keeperId,
        version: 4,
      });
      const reloaded = new SourceAuthorityRegistry({ registryFile });
      expect(reloaded.projection()).toEqual(registry.projection());
    }
  );

  it.skipIf(process.platform !== 'win32')('Windows 遗留盘符重复只迁入首个项目，会话不丢失', () => {
    const root = temporary();
    const keeperId = '11111111-1111-4111-8111-111111111111';
    const duplicateId = '22222222-2222-4222-8222-222222222222';
    const conversationId = '33333333-3333-4333-8333-333333333333';
    const registry = new SourceAuthorityRegistry({
      registryFile: path.join(root, 'registry.json'),
      legacySettings: () => ({
        'enso-settings': {
          state: {
            projects: [
              { id: keeperId, path: root[0].toUpperCase() + root.slice(1) },
              { id: duplicateId, path: root[0].toLowerCase() + root.slice(1) },
            ],
          },
        },
        'enso-conversations': {
          state: { conversations: { [conversationId]: { projectId: duplicateId } } },
        },
      }),
    });
    expect(registry.project(duplicateId)).toBeUndefined();
    expect(registry.conversation(conversationId)?.projectId).toBe(keeperId);
  });

  it('本地离线身份保留路径组件大小写，不能误合并 case-sensitive 目录', () => {
    const root = temporary();
    const registryFile = path.join(root, 'registry.json');
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    // Missing directories isolate lexical identity from realpath's normal case resolution.
    const projects = ['offline-project', 'Offline-Project'].map((name, i) => ({
      projectId: ids[i],
      canonicalPath: path.join(root, name),
      state: 'active',
      version: 1,
    }));
    writeFileSync(
      registryFile,
      JSON.stringify({ migrationVersion: 1, projects, conversations: [] })
    );
    const registry = new SourceAuthorityRegistry({ registryFile });
    expect(registry.projection().projects).toEqual(projects);
    expect(new SourceAuthorityRegistry({ registryFile }).projection().projects).toEqual(projects);
  });

  it('SSH 大小写不同的远端路径在创建和重启后仍是不同项目', () => {
    const root = temporary();
    const registryFile = path.join(root, 'registry.json');
    const resolveSshConnection = () => ({ host: 'host' });
    const registry = new SourceAuthorityRegistry({ registryFile, resolveSshConnection });
    const upper = registry.createProject({
      requestId: 'p1',
      path: '/srv/App',
      kind: 'ssh',
      sshConnectionId: 'connection',
    });
    const lower = registry.createProject({
      requestId: 'p2',
      path: '/srv/app',
      kind: 'ssh',
      sshConnectionId: 'connection',
    });
    expect(upper.accepted && lower.accepted).toBe(true);
    if (!upper.accepted || !lower.accepted) return;
    expect(upper.value.projectId).not.toBe(lower.value.projectId);
    const reloaded = new SourceAuthorityRegistry({ registryFile, resolveSshConnection });
    expect(reloaded.project(upper.value.projectId)?.state).toBe('active');
    expect(reloaded.project(lower.value.projectId)?.state).toBe('active');
  });

  it('merges persisted local duplicates onto the earliest project and remaps conversations', () => {
    const root = temporary();
    const projectPath = path.join(root, 'project');
    mkdirSync(projectPath);
    const keeperId = '11111111-1111-4111-8111-111111111111';
    const duplicateId = '22222222-2222-4222-8222-222222222222';
    const keeperConversation = '33333333-3333-4333-8333-333333333333';
    const duplicateConversation = '44444444-4444-4444-8444-444444444444';
    const registryFile = path.join(root, 'registry.json');
    writeFileSync(
      registryFile,
      JSON.stringify({
        migrationVersion: 1,
        projects: [
          {
            projectId: keeperId,
            canonicalPath: projectPath,
            state: 'active',
            version: 1,
          },
          {
            projectId: duplicateId,
            canonicalPath: `${projectPath}${path.sep}`,
            state: 'active',
            version: 1,
          },
        ],
        conversations: [
          {
            conversationId: keeperConversation,
            projectId: keeperId,
            kind: 'root',
            lifecycle: 'draft',
            version: 1,
          },
          {
            conversationId: duplicateConversation,
            projectId: duplicateId,
            kind: 'root',
            lifecycle: 'draft',
            version: 1,
          },
        ],
      })
    );
    const registry = new SourceAuthorityRegistry({ registryFile });
    expect(registry.project(keeperId)?.state).toBe('active');
    expect(registry.project(duplicateId)?.state).toBe('removed');
    expect(registry.conversation(keeperConversation)?.projectId).toBe(keeperId);
    expect(registry.conversation(duplicateConversation)?.projectId).toBe(keeperId);
    expect(
      registry.projection().projects.filter((project) => project.state === 'active')
    ).toHaveLength(1);
    const reloaded = new SourceAuthorityRegistry({ registryFile });
    expect(reloaded.conversation(duplicateConversation)?.projectId).toBe(keeperId);
    expect(reloaded.project(duplicateId)?.state).toBe('removed');
  });

  it('treats a symlink and its realpath as the same local project', () => {
    const root = temporary();
    const projectPath = path.join(root, 'project');
    const linkPath = path.join(root, 'alias');
    mkdirSync(projectPath);
    symlinkSync(projectPath, linkPath, 'junction');
    const registryFile = path.join(root, 'registry.json');
    writeFileSync(
      registryFile,
      JSON.stringify({
        migrationVersion: 1,
        projects: [
          {
            projectId: '11111111-1111-4111-8111-111111111111',
            canonicalPath: linkPath,
            state: 'active',
            version: 1,
          },
        ],
        conversations: [],
      })
    );
    const registry = new SourceAuthorityRegistry({ registryFile });
    const again = registry.createProject({ requestId: 'p', path: projectPath });
    expect(again.accepted).toBe(true);
    if (!again.accepted) return;
    expect(again.value.projectId).toBe('11111111-1111-4111-8111-111111111111');
    expect(again.value.canonicalPath).toBe(projectPath);
  });

  it('merges duplicate legacy settings projects onto the earliest path identity', () => {
    const root = temporary();
    const projectPath = path.join(root, 'project');
    mkdirSync(projectPath);
    const keeperId = '11111111-1111-4111-8111-111111111111';
    const duplicateId = '22222222-2222-4222-8222-222222222222';
    const conversationId = '33333333-3333-4333-8333-333333333333';
    const registry = new SourceAuthorityRegistry({
      registryFile: path.join(root, 'registry.json'),
      legacySettings: () => ({
        'enso-settings': {
          state: {
            projects: [
              { id: keeperId, path: projectPath },
              { id: duplicateId, path: `${projectPath}${path.sep}` },
            ],
          },
        },
        'enso-conversations': {
          state: {
            conversations: {
              [conversationId]: { projectId: duplicateId },
            },
          },
        },
      }),
    });
    expect(registry.project(keeperId)?.state).toBe('active');
    expect(registry.project(duplicateId)).toBeUndefined();
    expect(registry.conversation(conversationId)?.projectId).toBe(keeperId);
    expect(
      registry.projection().projects.filter((project) => project.state === 'active')
    ).toHaveLength(1);
  });

  it('merges persisted ssh duplicates on the same connection and path', () => {
    const root = temporary();
    const connA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const keeperId = '11111111-1111-4111-8111-111111111111';
    const duplicateId = '22222222-2222-4222-8222-222222222222';
    const registryFile = path.join(root, 'registry.json');
    writeFileSync(
      registryFile,
      JSON.stringify({
        migrationVersion: 1,
        projects: [
          {
            projectId: keeperId,
            canonicalPath: '/srv/app/',
            kind: 'ssh',
            sshHost: 'user@dev-box',
            sshConnectionId: connA,
            state: 'active',
            version: 1,
          },
          {
            projectId: duplicateId,
            canonicalPath: '/srv/app',
            kind: 'ssh',
            sshHost: 'user@dev-box',
            sshConnectionId: connA,
            state: 'active',
            version: 1,
          },
        ],
        conversations: [],
      })
    );
    const registry = new SourceAuthorityRegistry({
      registryFile,
      resolveSshConnection: (id) =>
        id === connA ? { host: 'dev-box', user: 'user', name: 'prod' } : null,
    });
    expect(registry.project(keeperId)?.canonicalPath).toBe('/srv/app');
    expect(registry.project(duplicateId)?.state).toBe('removed');
    const again = registry.createProject({
      requestId: 'p',
      path: '/srv/app',
      kind: 'ssh',
      sshConnectionId: connA,
    });
    expect(again.accepted).toBe(true);
    if (!again.accepted) return;
    expect(again.value.projectId).toBe(keeperId);
  });
});

describe('normalizeRemoteProjectPath', () => {
  it('规范化远端绝对路径，拒绝相对/空/带 .. 的路径', () => {
    expect(normalizeRemoteProjectPath('/srv/app')).toBe('/srv/app');
    expect(normalizeRemoteProjectPath('/srv/app/')).toBe('/srv/app');
    expect(normalizeRemoteProjectPath('/srv//app///')).toBe('/srv/app');
    expect(normalizeRemoteProjectPath('/')).toBe('/');
    expect(normalizeRemoteProjectPath('relative/path')).toBeNull();
    expect(normalizeRemoteProjectPath('')).toBeNull();
    expect(normalizeRemoteProjectPath('~/app')).toBeNull();
    expect(normalizeRemoteProjectPath('/srv/../etc')).toBeNull();
    expect(normalizeRemoteProjectPath('/srv/./app')).toBeNull();
  });
});
