import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IPC_CHANNELS } from '@shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatchHost: { resolveSubagentModel: undefined as unknown },
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  spawnSession: vi.fn(),
  summarizeConversationTitle: vi.fn(() => ({ ok: true })),
  resolveModelSelection: vi.fn(),
  readSettings: vi.fn((): unknown => null),
  setAgentEventListener: vi.fn(),
  readChildHistory: vi.fn(async () => ({ ok: true, source: 'tail', messages: [], baseIndex: 0 })),
  existsSync: vi.fn(() => true),
  persistedConversation: vi.fn(),
  currentIdentity: vi.fn(),
  coworkerOf: vi.fn(),
  childProof: vi.fn(),
  resolveTeamTarget: vi.fn(),
  isMainWebContents: vi.fn(() => true),
  dismissChildSession: vi.fn(() => ({ ok: true })),
  dismissCoworkerSession: vi.fn(() => ({ ok: true })),
  promptSession: vi.fn(),
  steerSession: vi.fn(),
  withdrawSteer: vi.fn(() => ({ ok: true })),
  abortSession: vi.fn(),
  setPairAgentBridge: vi.fn(),
  configurePairSessionHost: vi.fn(),
  respondApproval: vi.fn(),
  respondAsk: vi.fn(),
  prepareParent: vi.fn(),
  isDetached: vi.fn(() => false),
  setSessionMuteOverride: vi.fn(),
  setSessionModel: vi.fn(() => ({ ok: true })),
  forkSession: vi.fn(() => ({ ok: true })),
  sessionWorktree: vi.fn(),
  sessionWorktreeBusy: vi.fn(() => false),
  shareSessionWorktree: vi.fn(),
  removeRegisteredWorktree: vi.fn(async () => {}),
  cleanupSessionFiles: vi.fn(),
  credentials: vi.fn(async () => new Set<string>()),
  readSettingsState: vi.fn((): Record<string, unknown> | undefined => undefined),
  sendBrowserResult: vi.fn(),
  sendDesignResult: vi.fn(),
  designRequest: vi.fn(),
  designHook: vi.fn(),
  designSettingsListener: undefined as undefined | (() => void),
  browserInvoke: vi.fn(),
  browserSessionEnabled: vi.fn(() => true),
  browserCancellationListener: undefined as
    | undefined
    | ((identity?: { sessionId: string; generation: string }, phase?: string) => void),
  isAlive: vi.fn(() => true),
  isReady: vi.fn(() => true),
  workspaceTreeRunning: vi.fn(() => false),
  sendComputerResult: vi.fn(),
  sendAgentCommand: vi.fn(() => ({ ok: true })),
  computerInvoke: vi.fn(),
  computerCloseAll: vi.fn(),
  bindDevice: vi.fn(),
  deviceCall: vi.fn(),
  deviceTurnEnded: vi.fn(),
  deviceHostPost: vi.fn(),
  deviceHostConnect: vi.fn(),
  listDeviceAccess: vi.fn(),
  answerDeviceAccess: vi.fn(),
  revokeDeviceAccess: vi.fn(),
  destroyDeviceAccessSession: vi.fn(),
  listAllowedDeviceAccess: vi.fn(),
  forgetDeviceAccess: vi.fn(),
  broadcast: vi.fn(),
  mobileForAgent: vi.fn(),
  mobileGrant: vi.fn((): string | null => 'android:test'),
  mobileRevoke: vi.fn(),
  mobileClear: vi.fn(),
  compactSession: vi.fn(() => ({ ok: true })),
  sessionFile: vi.fn((): string | undefined => undefined),
  scheduleMemoryDistill: vi.fn(async () => undefined),
  getBotServices: vi.fn((): unknown => null),
  maybeNotifyBot: vi.fn(async (_event: { type: string }) => {}),
  pluginDispatchEvent: vi.fn(async () => undefined),
  pluginIntercept: vi.fn(async () => ({ append: 'safe context' })),
  pluginCallTool: vi.fn(async (_input: unknown) => ({ content: 'ok' })),
  pluginInterceptResult: vi.fn(),
  pluginToolResult: vi.fn(),
  pluginToolProgress: vi.fn(),
  registerPluginSessionBridge: vi.fn(),
  setPluginSessionDirectory: vi.fn(),
  setPluginInvocationPolicy: vi.fn(),
  setPluginMcpBridge: vi.fn(),
  setPluginBrowserBridge: vi.fn(),
  browserTabUrl: vi.fn(() => 'https://www.kdocs.cn/l/demo'),
}));

vi.mock('../services/extensionPlugins', () => ({
  getExtensionPlugins: () => ({
    sessionResources: () => ({}),
    refreshLocal: vi.fn(async () => {}),
    dispatchEvent: mocks.pluginDispatchEvent,
    intercept: mocks.pluginIntercept,
    callTool: mocks.pluginCallTool,
  }),
  setPluginInvocationPolicy: mocks.setPluginInvocationPolicy,
  setPluginMcpBridge: mocks.setPluginMcpBridge,
  setPluginBrowserBridge: mocks.setPluginBrowserBridge,
  setPluginSessionDirectory: mocks.setPluginSessionDirectory,
  setPluginSessionBridge: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  powerMonitor: { on: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../services/deviceHost', () => ({
  deviceHost: { post: mocks.deviceHostPost, connect: mocks.deviceHostConnect },
}));
vi.mock('../services/deviceTools', () => ({
  bindDeviceToolMain: mocks.bindDevice,
  deviceToolGateway: { call: mocks.deviceCall, turnEnded: mocks.deviceTurnEnded },
  listDeviceAccess: mocks.listDeviceAccess,
  answerDeviceAccess: mocks.answerDeviceAccess,
  revokeDeviceAccess: mocks.revokeDeviceAccess,
  destroyDeviceAccessSession: mocks.destroyDeviceAccessSession,
  listAllowedDeviceAccess: mocks.listAllowedDeviceAccess,
  forgetDeviceAccess: mocks.forgetDeviceAccess,
}));
vi.mock('../windows/createAppWindow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../windows/createAppWindow')>()),
  sendToAllWindows: mocks.broadcast,
}));
vi.mock('../services/sessionFileCleanup', () => ({
  removeConversationSessionFiles: mocks.cleanupSessionFiles,
}));
vi.mock('../windows/MainWindow', () => ({ isMainWebContents: mocks.isMainWebContents }));
vi.mock('../services/oauthProviders', () => ({
  readStoredOauthCredentialKeys: mocks.credentials,
}));
vi.mock('../services/agentHost', () => ({
  abortSession: mocks.abortSession,
  compactSession: mocks.compactSession,
  forgetParentToolProfile: vi.fn(),
  agentTypeRegistrySnapshot: vi.fn(() => ({
    revision: 1,
    candidates: [
      {
        typeKey: 'agent:enso',
        displayName: 'Enso',
        description: 'System Agent',
        source: 'system',
        locked: true,
        canDisable: false,
        canEdit: false,
      },
    ],
  })),
  appendSessionCustomEntry: vi.fn(),
  dismissChildSession: mocks.dismissChildSession,
  dismissCoworkerSession: mocks.dismissCoworkerSession,
  resumeCoworkerSession: vi.fn(() => ({ ok: true })),
  promptChildSession: vi.fn(),
  promptSession: mocks.promptSession,
  requestSnapshot: vi.fn(),
  resolveAgentTypeSpawnConfig: vi.fn(),
  resolveModelSelection: mocks.resolveModelSelection,
  resolveSubagentModelSelection: vi.fn(),
  respondApproval: mocks.respondApproval,
  respondAsk: mocks.respondAsk,
  rewindSession: vi.fn(),
  forkSession: mocks.forkSession,
  setAgentEventListener: mocks.setAgentEventListener,
  setBrowserCancellationListener: vi.fn((listener) => {
    mocks.browserCancellationListener = listener;
  }),
  setDesignSettingsListener: vi.fn((listener) => {
    mocks.designSettingsListener = listener;
  }),
  isBrowserSessionToolEnabled: mocks.browserSessionEnabled,
  isDesignSessionToolEnabled: () => true,
  setSessionApprovalMode: vi.fn(),
  setSessionModel: mocks.setSessionModel,
  setSessionReasoning: vi.fn(),
  setSessionThinking: vi.fn(),
  spawnChildSession: vi.fn(),
  spawnSession: mocks.spawnSession,
  steerSession: mocks.steerSession,
  withdrawSteer: mocks.withdrawSteer,
  stopBackgroundTask: vi.fn(),
  backgroundForegroundTool: vi.fn(),
  summarizeConversationTitle: mocks.summarizeConversationTitle,
  readSettingsState: mocks.readSettingsState,
  sendBrowserResultToSession: mocks.sendBrowserResult,
  sendDesignResultToSession: mocks.sendDesignResult,
  sendComputerResultToSession: mocks.sendComputerResult,
  sendAgentCommand: mocks.sendAgentCommand,
  registerPluginSessionBridge: mocks.registerPluginSessionBridge,
  sendPluginInterceptResultToSession: mocks.pluginInterceptResult,
  sendPluginToolResultToSession: mocks.pluginToolResult,
  sendPluginToolProgressToSession: mocks.pluginToolProgress,
}));
vi.mock('../services/design', () => ({
  getDesignToolBroker: () => ({ request: mocks.designRequest, emitHook: mocks.designHook }),
}));
vi.mock('../services/browserHost', () => ({
  browserHost: {
    invoke: mocks.browserInvoke,
    tabUrl: mocks.browserTabUrl,
    closeForSession: vi.fn(async () => {}),
    releaseActor: vi.fn(),
    forgetActor: vi.fn(),
  },
}));
vi.mock('../services/computerHost', () => ({
  computerHost: {
    invoke: mocks.computerInvoke,
    close: vi.fn(),
    closeAll: mocks.computerCloseAll,
  },
}));
vi.mock('../services/mobileDevices/host', () => ({
  mobileDeviceHost: {
    grant: mocks.mobileGrant,
    forAgent: mocks.mobileForAgent,
    revokeSession: mocks.mobileRevoke,
    clear: mocks.mobileClear,
  },
}));
vi.mock('../services/agentDispatchService', async () => {
  const actual = await vi.importActual<typeof import('../services/agentDispatchService')>(
    '../services/agentDispatchService'
  );
  return {
    ...actual,
    AgentDispatchService: class extends actual.AgentDispatchService {
      constructor(options: ConstructorParameters<typeof actual.AgentDispatchService>[0]) {
        mocks.dispatchHost.resolveSubagentModel = options.host.resolveSubagentModel;
        super(options);
      }
    },
  };
});
vi.mock('../services/notifications', () => ({
  maybeNotify: vi.fn(),
  maybeNotifyBot: mocks.maybeNotifyBot,
}));
vi.mock('../services/sessionMuteGate', () => ({
  setSessionMuteOverride: mocks.setSessionMuteOverride,
}));
vi.mock('../services/pairHost', () => ({
  forwardAgentEvent: vi.fn(),
  setPairAgentBridge: mocks.setPairAgentBridge,
  refreshPowerKeepAlive: vi.fn(),
}));
vi.mock('../services/pairSessionHost', () => ({
  configurePairSessionHost: mocks.configurePairSessionHost,
  handlePairHeadlessAgentEvent: vi.fn(),
}));
vi.mock('./capabilities', () => ({
  agentSessionIndex: {
    currentIdentity: mocks.currentIdentity,
    isAlive: mocks.isAlive,
    isReady: mocks.isReady,
    isDetached: mocks.isDetached,
    workspaceTreeRunning: mocks.workspaceTreeRunning,
    childProof: mocks.childProof,
    prepareParent: mocks.prepareParent,
    observe: vi.fn(),
    reserveChild: vi.fn(),
    releaseChild: vi.fn(),
    resolveTeamTarget: mocks.resolveTeamTarget,
    persistedConversation: mocks.persistedConversation,
    coworkerOf: mocks.coworkerOf,
    sessionFile: mocks.sessionFile,
  },
  capabilityGateway: {
    registerInvocation: vi.fn(() => true),
    terminateGeneration: vi.fn(),
  },
  handleCapabilityInvoke: vi.fn(),
}));
vi.mock('./settings', () => ({ readSettings: mocks.readSettings }));
vi.mock('../services/memoryHost', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/memoryHost')>()),
  scheduleMemoryDistill: mocks.scheduleMemoryDistill,
}));
vi.mock('./bots', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bots')>()),
  getBotServices: mocks.getBotServices,
}));
vi.mock('../services/childHistory', () => ({ readChildHistory: mocks.readChildHistory }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: mocks.existsSync,
}));
vi.mock('../services/fileSearch', () => ({ searchFiles: vi.fn(() => []) }));
vi.mock('../services/sessionImport', () => ({
  importExternalSession: vi.fn(),
  listExternalSessions: vi.fn(() => []),
  readExternalSession: vi.fn(() => []),
}));

vi.mock('./worktree', () => ({
  sessionWorktree: mocks.sessionWorktree,
  sessionWorktreeBusy: mocks.sessionWorktreeBusy,
  shareSessionWorktree: mocks.shareSessionWorktree,
  removeRegisteredWorktree: mocks.removeRegisteredWorktree,
}));

import { resolveSubagentModelSelection, rewindSession } from '../services/agentHost';
import { disposeDeviceRequests, getSourceAuthorityRegistry, registerAgentHandlers } from './agent';
import { registerDeviceHostHandlers } from './deviceHost';

const sender = {
  id: 1,
  once: vi.fn(),
};
const event = { sender };

describe('agent IPC Main identity boundary', () => {
  it('plugin bridge excludes SSH and Bot identities from inject, directory and status', async () => {
    const authority = getSourceAuthorityRegistry()!;
    const local = { sessionId: 'local', generation: '11111111-1111-4111-8111-111111111111' };
    const remote = { ...local, sessionId: 'remote' };
    const bot = { ...local, sessionId: 'bot' };
    const rows = [local, remote, bot].map((identity) => ({
      conversationId: identity.sessionId,
      projectId: identity.sessionId,
      kind: 'root' as const,
      lifecycle: 'ready' as const,
      version: 1,
      ...(identity === bot ? { bot: { botId: 'b', chatId: null } } : {}),
    }));
    vi.spyOn(authority, 'conversation').mockImplementation((id) =>
      rows.find((row) => row.conversationId === id)
    );
    vi.spyOn(authority, 'project').mockImplementation((id) => ({
      projectId: id,
      canonicalPath: '/tmp',
      state: 'active',
      version: 1,
      ...(id === 'remote' ? { kind: 'ssh' as const } : {}),
    }));
    vi.spyOn(authority, 'projection').mockReturnValue({
      conversations: rows,
      projects: rows.map((row) => ({
        projectId: row.projectId,
        canonicalPath: '/tmp',
        state: 'active',
        version: 1,
        ...(row.projectId === 'remote' ? { kind: 'ssh' as const } : {}),
      })),
    } as ReturnType<typeof authority.projection>);
    mocks.currentIdentity.mockImplementation((id) =>
      [local, remote, bot].find((identity) => identity.sessionId === id)
    );
    await vi.waitFor(() => expect(mocks.registerPluginSessionBridge).toHaveBeenCalled());
    const lookup = mocks.registerPluginSessionBridge.mock.calls.at(-1)![0];
    expect(lookup('remote')).toBeUndefined();
    expect(lookup('bot')).toBeUndefined();
    const directory = mocks.setPluginSessionDirectory.mock.calls.at(-1)![0];
    expect(directory.listAll().map((row: { id: string }) => row.id)).not.toContain('remote');
    expect(directory.listAll().map((row: { id: string }) => row.id)).not.toContain('bot');
    expect(directory.status('remote')).toEqual({
      sessionId: 'remote',
      state: 'idle',
      pendingAsks: 0,
      pendingApprovals: 0,
    });
  });
  it('routes plugin observe/intercept and progress to current generation without broadcasting internals', async () => {
    registerAgentHandlers();
    mocks.pluginDispatchEvent.mockClear();
    mocks.pluginInterceptResult.mockClear();
    const identity = {
      sessionId: 'plugin-parent',
      generation: '11111111-1111-4111-8111-111111111111',
    };
    const authority = getSourceAuthorityRegistry()!;
    vi.spyOn(authority, 'conversation').mockReturnValue({
      conversationId: identity.sessionId,
      projectId: 'p',
      kind: 'root',
      lifecycle: 'ready',
      version: 1,
    });
    vi.spyOn(authority, 'project').mockReturnValue({
      projectId: 'p',
      canonicalPath: '/tmp',
      state: 'active',
      version: 1,
    });
    mocks.currentIdentity.mockImplementation((id) =>
      id === identity.sessionId ? identity : undefined
    );
    mocks.isAlive.mockReturnValue(true);
    const emit = mocks.setAgentEventListener.mock.calls.at(-1)![0];
    emit({
      type: 'plugin-event',
      identity,
      seq: 1,
      event: 'model_select',
      data: { provider: 'p', modelId: 'm', source: 'set' },
    });
    emit({
      type: 'plugin-intercept',
      identity,
      seq: 2,
      requestId: 'intercept-1',
      event: 'before_agent_start',
      payload: { prompt: 'hi', kind: 'user' },
    });
    await vi.waitFor(() => expect(mocks.pluginDispatchEvent).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(mocks.pluginInterceptResult).toHaveBeenCalledWith(identity, 'intercept-1', {
        ok: true,
        result: { append: 'safe context' },
      })
    );
  });

  it('stopping a plugin generation cancels its pending call and suppresses late progress/results', async () => {
    const identity = {
      sessionId: 'plugin-running',
      generation: '11111111-1111-4111-8111-111111111111',
    };
    const authority = getSourceAuthorityRegistry()!;
    vi.spyOn(authority, 'conversation').mockReturnValue({
      conversationId: identity.sessionId,
      projectId: 'p',
      kind: 'root',
      lifecycle: 'ready',
      version: 1,
    });
    vi.spyOn(authority, 'project').mockReturnValue({
      projectId: 'p',
      canonicalPath: '/tmp',
      state: 'active',
      version: 1,
    });
    mocks.currentIdentity.mockReturnValue(identity);
    mocks.isAlive.mockReturnValue(true);
    mocks.pluginToolProgress.mockClear();
    mocks.pluginToolResult.mockClear();
    const pending = Promise.withResolvers<{ content: string }>();
    mocks.pluginCallTool.mockReturnValueOnce(pending.promise);
    const emit = mocks.setAgentEventListener.mock.calls.at(-1)![0];
    emit({
      type: 'plugin-tool-invoke',
      identity,
      seq: 1,
      requestId: 'pending-plugin',
      toolName: 'plugin_example-demo__read',
      fingerprint: 'f'.repeat(64),
      args: {},
    });
    await vi.waitFor(() => expect(mocks.pluginCallTool).toHaveBeenCalled());
    const call = mocks.pluginCallTool.mock.calls.at(-1)![0] as unknown as {
      signal: AbortSignal;
      onProgress(text: string): void;
    };
    mocks.browserCancellationListener?.(identity, 'abort');
    expect(call.signal.aborted).toBe(true);
    call.onProgress('late');
    pending.resolve({ content: 'late' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mocks.pluginToolProgress).not.toHaveBeenCalled();
    expect(mocks.pluginToolResult).not.toHaveBeenCalled();
  });

  it('plugin mutation policy and MCP bridge reject stale generations and all child mutation requests', async () => {
    const identity = {
      sessionId: 'plugin-policy',
      generation: '11111111-1111-4111-8111-111111111111',
    };
    const authority = getSourceAuthorityRegistry()!;
    vi.spyOn(authority, 'conversation').mockReturnValue({
      conversationId: identity.sessionId,
      projectId: 'p',
      kind: 'root',
      lifecycle: 'ready',
      version: 1,
    });
    vi.spyOn(authority, 'project').mockReturnValue({
      projectId: 'p',
      canonicalPath: '/tmp',
      state: 'active',
      version: 1,
    });
    mocks.currentIdentity.mockReturnValue(identity);
    mocks.isReady.mockReturnValue(true);
    const emit = mocks.setAgentEventListener.mock.calls.at(-1)![0];
    emit({ type: 'plan-state', identity, seq: 1, state: undefined });
    await vi.waitFor(() => expect(mocks.setPluginInvocationPolicy).toHaveBeenCalled());
    const policy = mocks.setPluginInvocationPolicy.mock.calls.at(-1)![0];
    expect(
      await policy({
        sessionId: identity.sessionId,
        projectRoot: '/tmp',
        sessionGeneration: identity.generation,
      })
    ).toEqual({ allowWrite: true, allowMcpCall: true });
    expect(await policy({ sessionId: identity.sessionId, projectRoot: '/tmp' })).toEqual({
      allowWrite: false,
      allowMcpCall: false,
    });
    expect(
      await policy({ sessionId: identity.sessionId, projectRoot: '/tmp', sessionGeneration: 'old' })
    ).toEqual({ allowWrite: false, allowMcpCall: false });
    expect(
      await policy({
        sessionId: identity.sessionId,
        projectRoot: '/tmp',
        sessionGeneration: identity.generation,
        agent: { kind: 'subagent', sessionId: `${identity.sessionId}::child`, name: 'Scout' },
      })
    ).toEqual({ allowWrite: false, allowMcpCall: false });
    const bridge = mocks.setPluginMcpBridge.mock.calls.at(-1)![0];
    await expect(
      bridge.mcpTools(
        { sessionId: identity.sessionId, projectRoot: '/tmp', sessionGeneration: 'old' },
        new AbortController().signal
      )
    ).rejects.toThrow();
  });

  it('冷本机主会话UI可读取表格，不唤醒worker；写策略、远端项目和旧来源仍拒绝', async () => {
    const authority = getSourceAuthorityRegistry()!;
    const conversation = {
      conversationId: 'cold-ui',
      projectId: 'p',
      kind: 'root' as const,
      lifecycle: 'draft' as const,
      version: 1,
    };
    vi.spyOn(authority, 'conversation').mockReturnValue(conversation);
    vi.spyOn(authority, 'project').mockReturnValue({
      projectId: 'p',
      canonicalPath: '/tmp',
      state: 'active',
      version: 1,
    });
    mocks.currentIdentity.mockReturnValue(undefined);
    mocks.isReady.mockReturnValue(false);
    mocks.readSettingsState.mockReturnValue({});
    await vi.waitFor(() => expect(mocks.setPluginBrowserBridge).toHaveBeenCalled());
    const bridge = mocks.setPluginBrowserBridge.mock.calls.at(-1)![0];
    const request = {
      kind: 'ui',
      sessionId: 'cold-ui',
      projectRoot: '/tmp',
      op: 'read_range',
      params: { url: 'https://www.kdocs.cn/l/demo', address: 'A1:L201' },
      domains: ['www.kdocs.cn'],
      signal: new AbortController().signal,
    };
    mocks.browserInvoke.mockResolvedValue({
      tabId: 'browser:1',
      url: 'https://www.kdocs.cn/l/demo',
      text: '需求\t负责人',
      sheet: '需求清单2026',
      range: { sheetId: '1', rowFrom: 0, rowTo: 200, colFrom: 0, colTo: 11 },
    });
    await expect(bridge(request)).resolves.toMatchObject({ text: '需求\t负责人' });
    expect(mocks.spawnSession).not.toHaveBeenCalled();
    expect(mocks.promptSession).not.toHaveBeenCalled();
    await expect(bridge({ ...request, kind: 'tool' })).rejects.toThrow();
    await expect(
      bridge({ ...request, op: 'insert_text', params: { tabId: 'browser:1', text: '改状态' } })
    ).rejects.toThrow();
    await expect(bridge({ ...request, projectRoot: '/wrong' })).rejects.toThrow();
    mocks.readSettingsState.mockReturnValue({ disabledBuiltinTools: ['browser'] });
    await expect(bridge(request)).rejects.toThrow();
    mocks.readSettingsState.mockReturnValue({});
    mocks.browserInvoke.mockImplementationOnce(async (_key, _op, _params, _actor, options) => {
      conversation.version++;
      options.guard();
      return {};
    });
    await expect(
      bridge({ ...request, params: { ...request.params, tabId: 'browser:1' } })
    ).rejects.toThrow();
  });
  beforeEach(() => {
    mocks.dispatchHost.resolveSubagentModel = undefined;
    mocks.handlers.clear();
    mocks.spawnSession.mockReset();
    mocks.readChildHistory.mockClear();
    mocks.existsSync.mockReturnValue(true);
    mocks.persistedConversation.mockReset();
    mocks.currentIdentity.mockReset();
    mocks.promptSession.mockClear();
    mocks.steerSession.mockClear();
    mocks.abortSession.mockClear();
    mocks.setPairAgentBridge.mockClear();
    mocks.configurePairSessionHost.mockClear();
    mocks.respondApproval.mockClear();
    mocks.respondAsk.mockClear();
    mocks.prepareParent.mockClear();
    mocks.isDetached.mockReset().mockReturnValue(false);
    mocks.setSessionMuteOverride.mockClear();
    mocks.setSessionModel.mockClear();
    mocks.coworkerOf.mockReset();
    mocks.dismissChildSession.mockClear();
    mocks.dismissCoworkerSession.mockClear();
    mocks.credentials.mockReset().mockResolvedValue(new Set());
    mocks.sessionWorktree.mockReset();
    mocks.sessionWorktreeBusy.mockReset().mockReturnValue(false);
    registerAgentHandlers();
  });

  it('派发 host 接上子代理模型解析，模型覆盖才不会被当成档案禁止', () => {
    expect(mocks.dispatchHost.resolveSubagentModel).toBe(resolveSubagentModelSelection);
  });

  it('静音通道只接受本机主窗口顶层 frame 的已知根会话与 boolean', () => {
    const handler = mocks.handlers.get(IPC_CHANNELS.AGENT_SESSION_MUTED)!;
    const frame = {};
    const sender = { id: 1, mainFrame: frame };
    const authority = getSourceAuthorityRegistry()!;
    vi.spyOn(authority, 'conversation').mockImplementation((id) =>
      id === 'known'
        ? { conversationId: 'known', projectId: 'p', kind: 'root', lifecycle: 'ready', version: 1 }
        : undefined
    );
    mocks.isMainWebContents.mockReturnValue(true);
    handler({ sender, senderFrame: frame }, 'known', true);
    expect(mocks.setSessionMuteOverride).toHaveBeenCalledExactlyOnceWith('known', true);
    mocks.setSessionMuteOverride.mockClear();
    handler({ sender, senderFrame: {} }, 'known', true);
    handler({ sender, senderFrame: undefined }, 'known', true);
    handler({ sender, senderFrame: frame }, 'known', 'true');
    handler({ sender, senderFrame: frame }, 'unknown', true);
    handler({ sender, senderFrame: frame }, {}, true);
    mocks.isMainWebContents.mockReturnValue(false);
    handler({ sender, senderFrame: frame }, 'known', true);
    expect(mocks.setSessionMuteOverride).not.toHaveBeenCalled();
    mocks.isMainWebContents.mockReturnValue(true);
  });

  it('retired coordinator IPC is no longer registered', () => {
    for (const channel of [
      'super-assistant:open',
      'super-assistant:snapshot',
      'super-assistant:cancel',
    ])
      expect(mocks.handlers.has(channel)).toBe(false);
  });

  it('generic spawn cannot reactivate a persisted retired coordinator', async () => {
    const authority = getSourceAuthorityRegistry()!;
    vi.spyOn(authority, 'conversation').mockReturnValue({
      conversationId: 'retired',
      projectId: 'p',
      kind: 'root',
      lifecycle: 'ready',
      version: 1,
      superAssistant: true,
    });
    vi.spyOn(authority, 'project').mockReturnValue({
      projectId: 'p',
      canonicalPath: '/repo',
      state: 'active',
      version: 1,
    });
    expect(
      await mocks.handlers.get(IPC_CHANNELS.AGENT_SPAWN)!(event, {
        sessionId: 'retired',
        providerId: 'provider',
        modelId: 'model',
        cwd: '/repo',
      })
    ).toMatchObject({ ok: false });
    expect(mocks.spawnSession).not.toHaveBeenCalled();
  });

  it('scratch spawn覆写共享根/伪造worktree，凭证等待后目录被换成symlink则拒绝', async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'enso-scratch-ipc-')));
    const authority = getSourceAuthorityRegistry()!;
    const project = authority.ensureScratchProject(path.join(root, 'scratch'))!;
    const created = authority.createConversation({
      requestId: crypto.randomUUID(),
      projectId: project.projectId,
      projectVersion: project.version,
    });
    expect(created.accepted).toBe(true);
    if (!created.accepted) throw new Error('scratch not created');
    const id = created.value.conversationId;
    const cwd = path.join(project.canonicalPath, id);
    mocks.sessionWorktree.mockReturnValue({ path: '/forged-worktree' });
    try {
      const request = {
        sessionId: id,
        providerId: 'provider',
        modelId: 'model',
        cwd: project.canonicalPath,
      };
      const result = await mocks.handlers.get(IPC_CHANNELS.AGENT_SPAWN)!(event, request);
      expect(result).not.toMatchObject({ ok: false });
      expect(mocks.spawnSession.mock.calls.at(-1)?.[1].cwd).toBe(cwd);
      expect(mocks.spawnSession.mock.calls.at(-1)?.[4]).toBeUndefined();
      mocks.spawnSession.mockClear();
      mocks.credentials.mockImplementationOnce(async () => {
        rmSync(cwd, { recursive: true, force: true });
        symlinkSync(root, cwd, process.platform === 'win32' ? 'junction' : 'dir');
        return new Set();
      });
      expect(await mocks.handlers.get(IPC_CHANNELS.AGENT_SPAWN)!(event, request)).toMatchObject({
        ok: false,
      });
      expect(mocks.spawnSession).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('提问回答允许空字符串取消，但拒绝非字符串或过期身份', () => {
    const identity = { sessionId: 'parent', generation: '11111111-1111-4111-8111-111111111111' };
    mocks.currentIdentity.mockReturnValue(identity);
    mocks.respondAsk.mockReturnValue({ ok: true });
    const handler = mocks.handlers.get(IPC_CHANNELS.AGENT_ASK_RESPOND)!;
    for (const answer of [undefined, null, 1, {}, []]) {
      expect(handler(event, 'parent', 'q', answer)).toMatchObject({ ok: false });
    }
    expect(mocks.respondAsk).not.toHaveBeenCalled();
    expect(handler(event, 'parent', 'q', '')).toEqual({ ok: true });
    expect(mocks.respondAsk).toHaveBeenCalledExactlyOnceWith(identity, 'q', '');
    mocks.currentIdentity.mockReturnValue(undefined);
    expect(handler(event, 'parent', 'q', '')).toMatchObject({ ok: false });
  });

  it('desktop rewind requires a persisted entry ID and a current generation', () => {
    const identity = { sessionId: 'parent', generation: '11111111-1111-4111-8111-111111111111' };
    mocks.currentIdentity.mockReturnValue(identity);
    vi.mocked(rewindSession).mockReset().mockReturnValue({ ok: true });
    const handler = mocks.handlers.get(IPC_CHANNELS.AGENT_REWIND)!;
    for (const anchor of [0, -1, null, undefined, '', ' ', {}, []]) {
      expect(handler(event, 'parent', anchor, true)).toMatchObject({ ok: false });
    }
    expect(handler(event, 'parent', 'entry', 'true')).toMatchObject({ ok: false });
    expect(rewindSession).not.toHaveBeenCalled();
    expect(handler(event, 'parent', 'entry', true)).toEqual({ ok: true });
    expect(rewindSession).toHaveBeenCalledExactlyOnceWith(identity, 'entry', true);
    mocks.currentIdentity.mockReturnValue(undefined);
    expect(handler(event, 'parent', 'entry', true)).toMatchObject({ ok: false });
    expect(rewindSession).toHaveBeenCalledTimes(1);
  });

  it.each(['busy', 'ended', 'rebound'])(
    'revalidates spawn after credentials: %s',
    async (change) => {
      const authority = getSourceAuthorityRegistry()!;
      const conversation = {
        conversationId: 'spawn-target',
        projectId: 'p',
        kind: 'root' as const,
        lifecycle: 'draft' as 'draft' | 'ended',
        version: 1,
      };
      vi.spyOn(authority, 'conversation').mockReturnValue(conversation);
      vi.spyOn(authority, 'project').mockReturnValue({
        projectId: 'p',
        canonicalPath: '/repo',
        state: 'active',
        version: 1,
      });
      mocks.credentials.mockImplementationOnce(async () => {
        if (change === 'busy') mocks.sessionWorktreeBusy.mockReturnValue(true);
        else if (change === 'ended') conversation.lifecycle = 'ended';
        else mocks.sessionWorktree.mockReturnValue({ path: '/worktree' });
        return new Set();
      });
      const result = await mocks.handlers.get(IPC_CHANNELS.AGENT_SPAWN)!(event, {
        sessionId: 'spawn-target',
        providerId: 'provider',
        modelId: 'model',
        cwd: '/repo',
      });
      if (change === 'rebound') expect(mocks.spawnSession.mock.calls[0][1].cwd).toBe('/worktree');
      else {
        expect(result).toMatchObject({ ok: false });
        expect(mocks.spawnSession).not.toHaveBeenCalled();
      }
    }
  );

  it('通用 AGENT_SPAWN 拒绝 bot 会话（人设与工作区只能由 BotSessionHost 组装）', async () => {
    const authority = getSourceAuthorityRegistry()!;
    vi.spyOn(authority, 'conversation').mockReturnValue({
      conversationId: 'bot-target',
      projectId: 'p',
      kind: 'root',
      lifecycle: 'draft',
      version: 1,
      bot: { botId: '11111111-1111-4111-8111-111111111111', chatId: null },
    });
    vi.spyOn(authority, 'project').mockReturnValue({
      projectId: 'p',
      canonicalPath: '/repo',
      state: 'active',
      version: 1,
    });
    const result = await mocks.handlers.get(IPC_CHANNELS.AGENT_SPAWN)!(event, {
      sessionId: 'bot-target',
      providerId: 'provider',
      modelId: 'model',
      cwd: '/repo',
    });
    expect(result).toMatchObject({ ok: false });
    expect(mocks.spawnSession).not.toHaveBeenCalled();
  });

  it('Bot authority rejects generic execution and policy changes but keeps abort available', async () => {
    vi.spyOn(getSourceAuthorityRegistry()!, 'conversation').mockReturnValue({
      conversationId: 'bot-target',
      projectId: 'p',
      kind: 'root',
      lifecycle: 'ready',
      version: 1,
      bot: { botId: '11111111-1111-4111-8111-111111111111', chatId: null },
    });
    mocks.currentIdentity.mockReturnValue({ sessionId: 'bot-target', generation: 'g' });
    for (const [channel, args] of [
      [IPC_CHANNELS.AGENT_PROMPT, ['hello']],
      [IPC_CHANNELS.AGENT_STEER, ['hello']],
      [IPC_CHANNELS.AGENT_SET_MODEL, ['provider', 'model']],
      [IPC_CHANNELS.AGENT_SET_THINKING, ['high']],
      [IPC_CHANNELS.AGENT_SET_REASONING, [true]],
      [IPC_CHANNELS.AGENT_SET_APPROVAL_MODE, ['full']],
    ] as const) {
      expect(await mocks.handlers.get(channel)!(event, 'bot-target', ...args)).toMatchObject({
        ok: false,
        error: expect.stringContaining('Bot'),
      });
    }
    const bridge = mocks.setPairAgentBridge.mock.calls.at(-1)![0];
    expect(bridge.prompt('bot-target', 'hello')).toMatchObject({ ok: false });
    const headless = mocks.configurePairSessionHost.mock.calls.at(-1)![0];
    expect(headless.compact('bot-target')).toMatchObject({ ok: false });
    mocks.compactSession.mockClear();
    expect(
      await mocks.handlers.get(IPC_CHANNELS.AGENT_COMPACT)!(event, 'bot-target', '保留分工')
    ).toEqual({ ok: true });
    expect(mocks.compactSession).toHaveBeenCalledWith(
      { sessionId: 'bot-target', generation: 'g' },
      '保留分工'
    );
    expect(bridge.steer('bot-target', 'hello')).toMatchObject({ ok: false });
    bridge.abort('bot-target');
    expect(mocks.abortSession).toHaveBeenCalled();
    expect(mocks.promptSession).not.toHaveBeenCalled();
    expect(mocks.steerSession).not.toHaveBeenCalled();
  });

  it('cleans a late fork file if the target was removed before completion', () => {
    const sourceId = '11111111-1111-4111-8111-111111111111';
    const targetId = '33333333-3333-4333-8333-333333333333';
    mocks.currentIdentity.mockReturnValue({ sessionId: sourceId, generation: 'g' });
    const authority = getSourceAuthorityRegistry()!;
    const lookup = vi.spyOn(authority, 'conversation').mockImplementation((id) => ({
      conversationId: id,
      projectId: 'p',
      kind: 'root',
      lifecycle: id === sourceId ? 'ready' : 'draft',
      version: 1,
      ...(id === targetId ? { forkedFrom: { conversationId: sourceId, entryId: 'entry' } } : {}),
    }));
    mocks.handlers.get(IPC_CHANNELS.AGENT_FORK)!(event, sourceId, targetId, { entryId: 'entry' });
    lookup.mockReturnValue(undefined);
    mocks.cleanupSessionFiles.mockClear();
    const listener = mocks.setAgentEventListener.mock.calls.at(-1)![0];
    listener({
      type: 'fork-done',
      identity: { sessionId: sourceId, generation: 'g' },
      seq: 1,
      targetConversationId: targetId,
      sessionFile: '/tmp/agent/sessions/fork.jsonl',
      entryId: 'entry',
    });
    expect(mocks.cleanupSessionFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: targetId,
        sessionFile: '/tmp/agent/sessions/fork.jsonl',
      })
    );
  });

  it('reserves a worktree reference before posting fork and releases failed reservations', async () => {
    const sourceId = '11111111-1111-4111-8111-111111111111';
    const targetId = '22222222-2222-4222-8222-222222222222';
    mocks.currentIdentity.mockReturnValue({ sessionId: sourceId, generation: 'g' });
    const worktree = { path: '/reserved' };
    mocks.sessionWorktree.mockReturnValue(worktree);
    const authority = getSourceAuthorityRegistry()!;
    vi.spyOn(authority, 'conversation').mockImplementation((id) => ({
      conversationId: id,
      projectId: 'p',
      kind: 'root',
      lifecycle: id === sourceId ? 'ready' : 'draft',
      version: 1,
      ...(id === targetId ? { forkedFrom: { conversationId: sourceId, entryId: 'entry' } } : {}),
    }));
    mocks.forkSession.mockImplementationOnce(() => {
      expect(mocks.shareSessionWorktree).toHaveBeenCalledWith(sourceId, targetId);
      return { ok: false };
    });
    const result = mocks.handlers.get(IPC_CHANNELS.AGENT_FORK)!(event, sourceId, targetId, {
      entryId: 'entry',
    });
    expect(result).toEqual({ ok: false });
    await vi.waitFor(() =>
      expect(mocks.removeRegisteredWorktree).toHaveBeenCalledWith(targetId, worktree)
    );
  });

  it('rejects fork when worktree reservation fails without posting to worker', () => {
    const sourceId = '11111111-1111-4111-8111-111111111111';
    const targetId = '22222222-2222-4222-8222-222222222222';
    mocks.currentIdentity.mockReturnValue({ sessionId: sourceId, generation: 'g' });
    vi.spyOn(getSourceAuthorityRegistry()!, 'conversation').mockImplementation((id) => ({
      conversationId: id,
      projectId: 'p',
      kind: 'root',
      lifecycle: id === sourceId ? 'ready' : 'draft',
      version: 1,
      ...(id === targetId ? { forkedFrom: { conversationId: sourceId, entryId: 'entry' } } : {}),
    }));
    mocks.forkSession.mockClear();
    mocks.shareSessionWorktree.mockImplementationOnce(() => {
      throw new Error('worktree busy');
    });
    const result = mocks.handlers.get(IPC_CHANNELS.AGENT_FORK)!(event, sourceId, targetId, {
      entryId: 'entry',
    });
    expect(result).toMatchObject({ ok: false });
    expect(mocks.forkSession).not.toHaveBeenCalled();
  });

  it('exposes the Main agent type registry snapshot on the three-point list channel', () => {
    const handler = mocks.handlers.get(IPC_CHANNELS.AGENT_TYPES_REGISTRY_LIST);
    expect(handler).toBeDefined();
    expect(handler!(event)).toEqual({
      revision: 1,
      candidates: [
        {
          typeKey: 'agent:enso',
          displayName: 'Enso',
          description: 'System Agent',
          source: 'system',
          locked: true,
          canDisable: false,
          canEdit: false,
        },
      ],
    });
  });

  it('rejects plain spawn attempts for the removed global/reserved Enso identity', async () => {
    const handler = mocks.handlers.get(IPC_CHANNELS.AGENT_SPAWN);
    expect(handler).toBeDefined();
    await expect(
      handler!(event, {
        sessionId: 'builtin-agent:enso',
        providerId: 'provider',
        modelId: 'model',
        cwd: '/workspace',
      })
    ).resolves.toEqual({ ok: false, error: 'invalid spawn request' });
    expect(mocks.spawnSession).not.toHaveBeenCalled();
  });

  describe('手动雇佣走 Main dispatch', () => {
    it('非主窗口 / 非法参数拒绝；合法请求委托 dispatchService.hireCoworker', async () => {
      const handler = mocks.handlers.get(IPC_CHANNELS.AGENT_HIRE_COWORKER);
      expect(handler).toBeDefined();
      await expect(handler!(event, 'conv-1', '', undefined)).resolves.toMatchObject({
        ok: false,
      });
      mocks.isMainWebContents.mockReturnValueOnce(false);
      await expect(handler!(event, 'conv-1', 'bob', undefined)).resolves.toMatchObject({
        ok: false,
      });
      // 合法请求到达 dispatchService：hireCoworker 首先查 resolveTeamTarget，
      // 这里用哨兵错误证明委托链路真实走通。
      mocks.resolveTeamTarget.mockReturnValue({
        ok: false,
        code: 'unavailable',
        error: 'sentinel: team target',
      });
      await expect(handler!(event, 'conv-1', 'bob', 'scout')).resolves.toMatchObject({
        ok: false,
        error: 'sentinel: team target',
      });
      expect(mocks.resolveTeamTarget).toHaveBeenCalledWith('conv-1');
    });
  });

  describe('dismiss 降级链：typed child → legacy coworker → not-found', () => {
    const parentIdentity = { sessionId: 'conv-1', generation: 'pg1' };
    const childIdentity = {
      sessionId: 'conv-1::cw-1',
      generation: 'cg1',
      parent: parentIdentity,
      instanceId: 'i1',
      instanceName: 'Scout · 1',
      typeKey: 'builtin:scout',
    };
    const dismiss = (coworkerId: string) =>
      mocks.handlers.get(IPC_CHANNELS.AGENT_DISMISS_COWORKER)?.(event, 'conv-1', coworkerId, true);

    it('typed child（在 sessions 索引）走 dismiss-child 现路径', () => {
      mocks.currentIdentity.mockImplementation((sessionId: string) =>
        sessionId === 'conv-1' ? parentIdentity : childIdentity
      );
      expect(dismiss('conv-1::cw-1')).toEqual({ ok: true });
      expect(mocks.dismissChildSession).toHaveBeenCalledWith(parentIdentity, childIdentity, true);
      expect(mocks.dismissCoworkerSession).not.toHaveBeenCalled();
    });

    it('工具直雇 coworker（不在索引、在 parent.coworkers 映射）走 dismiss-coworker 命令', () => {
      // 39f4d3a 起的回归：这类 coworker 永远解不雇（'parent' in child 必然 false）
      mocks.currentIdentity.mockImplementation((sessionId: string) =>
        sessionId === 'conv-1' ? parentIdentity : undefined
      );
      mocks.coworkerOf.mockReturnValue({ id: 'conv-1::cw-bob', name: 'bob' });
      expect(dismiss('conv-1::cw-bob')).toEqual({ ok: true });
      expect(mocks.coworkerOf).toHaveBeenCalledWith(parentIdentity, 'conv-1::cw-bob');
      expect(mocks.dismissCoworkerSession).toHaveBeenCalledWith(
        parentIdentity,
        'conv-1::cw-bob',
        true
      );
      expect(mocks.dismissChildSession).not.toHaveBeenCalled();
    });

    it('两处都查不到（重启后的死 tab）返回 not-found，渲染层据此本地移除', () => {
      mocks.currentIdentity.mockImplementation((sessionId: string) =>
        sessionId === 'conv-1' ? parentIdentity : undefined
      );
      mocks.coworkerOf.mockReturnValue(undefined);
      expect(dismiss('conv-1::cw-gone')).toMatchObject({ ok: false });
      expect(mocks.dismissChildSession).not.toHaveBeenCalled();
      expect(mocks.dismissCoworkerSession).not.toHaveBeenCalled();
    });

    it('父身份解析不出（旧代/已结束）一律拒绝，不碰任何命令', () => {
      mocks.currentIdentity.mockReturnValue(undefined);
      expect(dismiss('conv-1::cw-bob')).toMatchObject({ ok: false });
      expect(mocks.dismissChildSession).not.toHaveBeenCalled();
      expect(mocks.dismissCoworkerSession).not.toHaveBeenCalled();
    });
  });

  it('已启动会话换模型走 exact identity，旧 generation 与 child 身份被拒', async () => {
    const handler = mocks.handlers.get(IPC_CHANNELS.AGENT_SET_MODEL);
    expect(handler).toBeDefined();

    mocks.currentIdentity.mockReturnValue({ sessionId: 'conv-1', generation: 'gen-1' });
    await expect(handler?.(event, 'conv-1', 'pv-B', 'model-1')).resolves.toMatchObject({
      ok: true,
    });
    expect(mocks.setSessionModel).toHaveBeenCalledWith(
      { sessionId: 'conv-1', generation: 'gen-1' },
      'pv-B',
      'model-1',
      expect.anything()
    );

    // child 不能走父会话的换模型路径
    mocks.setSessionModel.mockClear();
    mocks.currentIdentity.mockReturnValue({
      sessionId: 'conv-1::cw-1',
      generation: 'g',
      parent: { sessionId: 'conv-1', generation: 'gen-1' },
      instanceId: 'i',
      instanceName: 'Enso-1',
      typeKey: 'agent:enso',
    });
    await expect(handler?.(event, 'conv-1::cw-1', 'pv-B', 'model-1')).resolves.toMatchObject({
      ok: false,
    });

    // 解析不出身份（会话已结束 / generation 已轮替）同样拒绝
    mocks.currentIdentity.mockReturnValue(undefined);
    await expect(handler?.(event, 'gone', 'pv-B', 'model-1')).resolves.toMatchObject({ ok: false });
    expect(mocks.setSessionModel).not.toHaveBeenCalled();
  });

  describe('手机第二屏的会话命令桥', () => {
    const parent = { sessionId: 'conv-1', generation: 'gen-1' };
    const child = {
      sessionId: 'conv-1::cw-1',
      generation: 'g',
      parent,
      instanceId: 'i',
      instanceName: 'Enso-1',
      typeKey: 'agent:enso',
    };
    const bridge = () =>
      mocks.setPairAgentBridge.mock.calls.at(-1)?.[0] as {
        prompt(sessionId: string, text: string): void;
        abort(sessionId: string): void;
        respondApproval(sessionId: string, requestId: string, decision: string): void;
        respondAsk(sessionId: string, requestId: string, answer: unknown): void;
        spawn(request: { sessionId: string }): Promise<unknown>;
      };
    const headless = () =>
      mocks.configurePairSessionHost.mock.calls.at(-1)?.[0] as {
        prompt(sessionId: string, text: string): void;
        setModel(sessionId: string, providerId: string, modelId: string): void;
      };

    it('裸 sessionId 被解析成 exact identity 后才下发', () => {
      mocks.currentIdentity.mockReturnValue(parent);
      bridge().prompt('conv-1', 'hello');
      expect(mocks.promptSession).toHaveBeenCalledWith(parent, 'hello', undefined);
    });

    it('解析不出身份时丢弃命令，不降级成按 sessionId 盲发', () => {
      // 手机只持有裸 sessionId；会话已结束/generation 已轮替时必须 fail-closed。
      mocks.currentIdentity.mockReturnValue(undefined);
      bridge().prompt('conv-gone', 'hello');
      bridge().abort('conv-gone');
      expect(mocks.promptSession).not.toHaveBeenCalled();
      expect(mocks.abortSession).not.toHaveBeenCalled();
    });

    it('coworker 标签页的审批/回答/输入/停止与桌面同样按 child 身份下发', () => {
      mocks.currentIdentity.mockReturnValue(child);
      bridge().respondApproval('conv-1::cw-1', 'r-1', 'allow');
      bridge().respondAsk('conv-1::cw-1', 'r-2', 'yes');
      bridge().prompt('conv-1::cw-1', 'hello');
      bridge().abort('conv-1::cw-1');
      headless().prompt('conv-1::cw-1', 'tray');
      expect(mocks.respondApproval).toHaveBeenCalledWith(child, 'r-1', 'allow');
      expect(mocks.respondAsk).toHaveBeenCalledWith(child, 'r-2', 'yes');
      expect(mocks.promptSession).toHaveBeenCalledWith(child, 'hello', undefined);
      expect(mocks.promptSession).toHaveBeenCalledWith(child, 'tray', undefined);
      expect(mocks.abortSession).toHaveBeenCalledWith(child);
    });

    it('child 身份不能作为新建会话的父身份，也不能被切模型', async () => {
      mocks.currentIdentity.mockReturnValue(child);
      mocks.credentials.mockRejectedValue(new Error('stop here'));
      await bridge().spawn({ sessionId: 'conv-1::cw-1' });
      expect(mocks.prepareParent).not.toHaveBeenCalledWith(child);
      headless().setModel('conv-1::cw-1', 'pv', 'm');
      await Promise.resolve();
      expect(mocks.setSessionModel).not.toHaveBeenCalled();
    });
  });

  describe.each([
    [IPC_CHANNELS.AGENT_PROMPT, mocks.promptSession],
    [IPC_CHANNELS.AGENT_STEER, mocks.steerSession],
  ])('%s 透传乐观回显 deliveryId', (channel, send) => {
    const parent = { sessionId: 'conv-1', generation: 'gen-1' };
    const invoke = (...args: unknown[]) => mocks.handlers.get(channel)?.(event, ...args);

    it('worker 已释放会话时拒绝而不假装投递成功', async () => {
      mocks.currentIdentity.mockReturnValue(parent);
      mocks.isDetached.mockReturnValue(true);
      expect(await invoke('conv-1', 'hi', undefined, 'd-1')).toMatchObject({
        ok: false,
        error: expect.stringContaining('释放'),
      });
      expect(mocks.isDetached).toHaveBeenCalledWith(parent);
      expect(send).not.toHaveBeenCalled();
    });

    it('合法 deliveryId 原样下发，缺省时不带', async () => {
      mocks.currentIdentity.mockReturnValue(parent);
      send.mockReturnValue({ ok: true });
      await invoke('conv-1', 'hi', undefined, 'd-1');
      expect(send).toHaveBeenLastCalledWith(parent, 'hi', undefined, 'd-1');
      await invoke('conv-1', 'hi');
      expect(send).toHaveBeenLastCalledWith(parent, 'hi', undefined, undefined);
    });

    it.each(['', 7, 'x'.repeat(129)])('非法 deliveryId %# 拒绝且不下发', async (deliveryId) => {
      mocks.currentIdentity.mockReturnValue(parent);
      expect(await invoke('conv-1', 'hi', undefined, deliveryId)).toMatchObject({ ok: false });
      expect(send).not.toHaveBeenCalled();
    });
  });

  it('仅将匹配当前代际的有效撤回请求发给 worker', () => {
    const identity = { sessionId: 'conv-1', generation: 'gen-1' };
    mocks.currentIdentity.mockReturnValue(identity);
    const invoke = (generation: unknown, deliveryId: unknown) =>
      mocks.handlers.get(IPC_CHANNELS.AGENT_WITHDRAW_STEER)?.(
        event,
        'conv-1',
        generation,
        deliveryId
      );
    expect(invoke('old', 'd-1')).toMatchObject({ ok: false });
    expect(invoke('gen-1', { id: 'd-1' })).toMatchObject({ ok: false });
    expect(mocks.withdrawSteer).not.toHaveBeenCalled();
    expect(invoke('gen-1', 'd-1')).toEqual({ ok: true });
    expect(mocks.withdrawSteer).toHaveBeenCalledWith(identity, 'd-1');
  });

  describe('已结束 child 的只读历史读取', () => {
    const read = (request: unknown) =>
      mocks.handlers.get(IPC_CHANNELS.AGENT_CHILD_HISTORY_READ)?.(event, request);

    it('只把已收窄 ID 和可选游标委托给只读服务', async () => {
      for (const beforeIndex of [undefined, 0, 60, Number.MAX_SAFE_INTEGER]) {
        await expect(read({ conversationId: 'child', beforeIndex })).resolves.toEqual({
          ok: true,
          source: 'tail',
          messages: [],
          baseIndex: 0,
        });
        expect(mocks.readChildHistory).toHaveBeenLastCalledWith('child', beforeIndex, {
          sessionDir: path.join('/tmp', 'agent', 'sessions'),
          persistedConversation: expect.any(Function),
        });
      }
      expect(mocks.spawnSession).not.toHaveBeenCalled();
    });

    it('非法 ID、非安全整数游标和额外路径字段在服务前拒绝', async () => {
      for (const request of [
        null,
        [],
        {},
        { conversationId: '' },
        { conversationId: 1 },
        ...[-1, 0.1, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null].map(
          (beforeIndex) => ({ conversationId: 'child', beforeIndex })
        ),
        { conversationId: 'child', sessionFile: '/etc/passwd' },
      ]) {
        await expect(read(request)).resolves.toMatchObject({ ok: false });
      }
      expect(mocks.readChildHistory).not.toHaveBeenCalled();
      expect(mocks.persistedConversation).not.toHaveBeenCalled();
    });
  });

  it('rejects dispatch payloads that forge profile, target, or reserved identity fields', async () => {
    const handler = mocks.handlers.get(IPC_CHANNELS.AGENT_DISPATCH);
    expect(handler).toBeDefined();
    const base = {
      requestId: 'request',
      bindingId: 'binding',
      typeKey: 'agent:enso',
      task: { text: 'task', images: [], fileMentions: [] },
    };
    for (const forged of [
      { profileId: 'enso-locked-v1' },
      { sessionId: 'builtin-agent:enso' },
      { conversationId: 'other' },
      { projectPath: '/other' },
    ]) {
      await expect(handler!(event, { ...base, ...forged })).resolves.toMatchObject({
        accepted: false,
        code: 'invalid-request',
      });
    }
  });
});

describe('agent IPC 标题总结：回退链全部可解析候选一次性下发', () => {
  const titleModel = { providerId: 'p-title', modelId: 'm-title' };
  const defaultModel = { providerId: 'p-default', modelId: 'm-default' };
  const sessionModel = { providerId: 'p-session', modelId: 'm-session' };
  const config = (ref: { providerId: string; modelId: string }) => ({
    api: 'openai-completions',
    baseUrl: '',
    apiKey: 'k',
    modelId: ref.modelId,
    settingsProviderId: ref.providerId,
  });
  const request = {
    conversationId: 'conversation-1',
    input: { kind: 'initial', text: '帮我修一下节点转圈' },
    sessionModel,
  };

  beforeEach(() => {
    mocks.handlers.clear();
    mocks.summarizeConversationTitle.mockClear();
    mocks.resolveModelSelection.mockReset();
    mocks.readSettings.mockReturnValue({
      'enso-settings': {
        state: { titleSummaryEnabled: true, titleSummaryModel: titleModel, defaultModel },
      },
    });
    registerAgentHandlers();
  });

  it('三个候选全部可解析 → 按优先级下发 3 个 config', async () => {
    mocks.resolveModelSelection.mockImplementation((providerId: string, modelId: string) => ({
      ok: true,
      selection: { config: config({ providerId, modelId }) },
    }));
    const handler = mocks.handlers.get(IPC_CHANNELS.AGENT_SUMMARIZE_TITLE);
    await expect(handler!(event, request)).resolves.toEqual({ ok: true });
    expect(mocks.summarizeConversationTitle).toHaveBeenCalledWith(
      'conversation-1',
      { kind: 'initial', text: '帮我修一下节点转圈' },
      [config(titleModel), config(defaultModel), config(sessionModel)]
    );
  });

  it('中间候选不可解析 → 跳过它，下发其余 2 个', async () => {
    mocks.resolveModelSelection.mockImplementation((providerId: string, modelId: string) =>
      providerId === 'p-default'
        ? { ok: false, error: 'Model is unavailable' }
        : { ok: true, selection: { config: config({ providerId, modelId }) } }
    );
    const handler = mocks.handlers.get(IPC_CHANNELS.AGENT_SUMMARIZE_TITLE);
    await handler!(event, request);
    expect(mocks.summarizeConversationTitle).toHaveBeenCalledWith(
      'conversation-1',
      expect.anything(),
      [config(titleModel), config(sessionModel)]
    );
  });

  it('全部不可解析 → 不下发，返回 no usable title model', async () => {
    mocks.resolveModelSelection.mockReturnValue({ ok: false, error: 'nope' });
    const handler = mocks.handlers.get(IPC_CHANNELS.AGENT_SUMMARIZE_TITLE);
    await expect(handler!(event, request)).resolves.toEqual({
      ok: false,
      error: 'no usable title model',
    });
    expect(mocks.summarizeConversationTitle).not.toHaveBeenCalled();
  });

  it('开关关闭 → 不解析模型、不下发', async () => {
    mocks.readSettings.mockReturnValue({
      'enso-settings': { state: { titleSummaryEnabled: false, titleSummaryModel: titleModel } },
    });
    const handler = mocks.handlers.get(IPC_CHANNELS.AGENT_SUMMARIZE_TITLE);
    await expect(handler!(event, request)).resolves.toEqual({
      ok: false,
      error: 'title summary disabled',
    });
    expect(mocks.resolveModelSelection).not.toHaveBeenCalled();
  });

  describe('design bridge', () => {
    const parent = {
      sessionId: 'design-parent',
      generation: '11111111-1111-4111-8111-111111111111',
    };
    const emit = (event: Record<string, unknown>) =>
      mocks.setAgentEventListener.mock.calls.at(-1)![0]({ seq: 1, ...event });
    const invoke = (id: string, extra = {}) =>
      emit({
        type: 'design-invoke',
        identity: parent,
        requestId: id,
        tool: 'vetd_create',
        params: {},
        ...extra,
      });
    beforeEach(() => {
      mocks.sessionWorktree.mockReset();
      mocks.childProof.mockReset();
      mocks.coworkerOf.mockReset();
      mocks.currentIdentity.mockReturnValue(parent);
      mocks.isAlive.mockReturnValue(true);
      mocks.readSettingsState.mockReturnValue({ disabledBuiltinTools: [] });
      mocks.sendDesignResult.mockReset();
      mocks.designRequest.mockReset();
      mocks.designHook.mockReset();
      mocks.designRequest.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
      const authority = getSourceAuthorityRegistry()!;
      vi.spyOn(authority, 'conversation').mockReturnValue({
        conversationId: parent.sessionId,
        kind: 'root',
        projectId: 'p',
        lifecycle: 'ready',
        version: 1,
      } as never);
      vi.spyOn(authority, 'project').mockReturnValue({
        projectId: 'p',
        kind: 'local',
        canonicalPath: '/repo',
        state: 'active',
        version: 1,
      } as never);
    });
    it('uses authoritative cwd, validates generation/switch and rejects SSH explicitly', async () => {
      invoke('stale', { identity: { ...parent, generation: 'old' } });
      mocks.readSettingsState.mockReturnValue({ designEnabled: false });
      invoke('disabled');
      expect(mocks.designRequest).not.toHaveBeenCalled();
      mocks.readSettingsState.mockReturnValue({ disabledBuiltinTools: [] });
      getSourceAuthorityRegistry()!.project = vi.fn(() => ({
        projectId: 'p',
        kind: 'ssh',
        canonicalPath: '/remote',
        state: 'active',
        version: 1,
      })) as never;
      invoke('remote');
      expect(mocks.sendDesignResult).toHaveBeenLastCalledWith(parent, 'remote', {
        ok: false,
        error: '设计功能暂不支持远程项目',
      });
      getSourceAuthorityRegistry()!.project = vi.fn(() => ({
        projectId: 'p',
        kind: 'local',
        canonicalPath: '/repo',
        state: 'active',
        version: 1,
      })) as never;
      invoke('good');
      await Promise.resolve();
      expect(mocks.designRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/repo',
          sessionId: parent.sessionId,
          tool: 'vetd_create',
          timeoutMs: 600_000,
        })
      );
      expect(mocks.sendDesignResult).toHaveBeenLastCalledWith(
        parent,
        'good',
        expect.objectContaining({ ok: true })
      );
    });
    it('Bot 委派设计路由到其权威所属话题，而非隐藏的 Code 画布', async () => {
      const authority = getSourceAuthorityRegistry()!;
      const root = authority.conversation(parent.sessionId)!;
      vi.spyOn(authority, 'conversation').mockReturnValue({
        ...root,
        bot: { botId: 'designer', chatId: null, delegationId: 'first-delegation' },
      });
      const executionOf = vi.fn(() => ({ chatId: 'current-topic' }));
      mocks.getBotServices.mockReturnValue({
        delegations: { executionOf, chatIdOf: () => 'old-topic' },
      });
      try {
        invoke('bot-delegation-create');
        await Promise.resolve();
        expect(executionOf).toHaveBeenCalledWith(parent.sessionId);
        expect(mocks.designRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            cwd: '/repo',
            sessionId: parent.sessionId,
            botChatId: 'current-topic',
            tool: 'vetd_create',
          })
        );
      } finally {
        mocks.getBotServices.mockReturnValue(null);
      }
    });
    it('普通 Bot 设计保留直接群聊标识；Code 来源的成员委派不伪造群聊归属', async () => {
      const authority = getSourceAuthorityRegistry()!;
      const root = authority.conversation(parent.sessionId)!;
      const conversation = vi.spyOn(authority, 'conversation');
      conversation.mockReturnValue({ ...root, bot: { botId: 'designer', chatId: 'group-topic' } });
      invoke('bot-direct-create');
      await Promise.resolve();
      expect(mocks.designRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({ botChatId: 'group-topic' })
      );
      conversation.mockReturnValue({
        ...root,
        bot: { botId: 'designer', chatId: null, delegationId: 'code-delegation' },
      });
      mocks.getBotServices.mockReturnValue({
        delegations: { executionOf: () => ({ chatId: null }), chatIdOf: () => 'stale-topic' },
      });
      try {
        invoke('code-member-create');
        await Promise.resolve();
        expect(mocks.designRequest).toHaveBeenLastCalledWith(
          expect.objectContaining({ botChatId: undefined })
        );
      } finally {
        mocks.getBotServices.mockReturnValue(null);
      }
    });
    it('deduplicates, binds cancellation, rejects timeout and suppresses late replies; disabling aborts pending calls', async () => {
      vi.useFakeTimers();
      try {
        let finish: ((value: unknown) => void) | undefined;
        let signal: AbortSignal | undefined;
        mocks.designRequest.mockImplementation((call) => {
          signal = call.signal;
          return new Promise((resolve) => {
            finish = resolve;
          });
        });
        invoke('bound');
        emit({
          type: 'design-cancel',
          identity: { ...parent, sessionId: 'other' },
          requestId: 'bound',
        });
        expect(signal?.aborted).toBe(false);
        emit({ type: 'design-cancel', identity: parent, requestId: 'bound' });
        expect(signal?.aborted).toBe(true);
        invoke('bound');
        expect(mocks.designRequest).toHaveBeenCalledTimes(1);
        mocks.sendDesignResult.mockClear();
        finish?.({ content: [] });
        await Promise.resolve();
        expect(mocks.sendDesignResult).not.toHaveBeenCalled();
        invoke('timeout', { tool: 'vetd_status' });
        vi.advanceTimersByTime(120_000);
        expect(signal?.aborted).toBe(true);
        expect(mocks.sendDesignResult).toHaveBeenLastCalledWith(
          parent,
          'timeout',
          expect.objectContaining({ ok: false })
        );
        invoke('disabled-late');
        mocks.readSettingsState.mockReturnValue({ designEnabled: false });
        mocks.designSettingsListener?.();
        expect(signal?.aborted).toBe(true);
        expect(mocks.sendDesignResult).toHaveBeenLastCalledWith(
          parent,
          'disabled-late',
          expect.objectContaining({ ok: false })
        );
      } finally {
        vi.useRealTimers();
      }
    });
    it('child uses root worktree cwd and canvas session, replies to child, never commits duplicate child hooks', async () => {
      const child = {
        sessionId: `${parent.sessionId}::cw-designer`,
        generation: '22222222-2222-4222-8222-222222222222',
        parent,
        instanceId: '33333333-3333-4333-8333-333333333333',
        instanceName: 'Designer',
        typeKey: 'builtin:designer',
      };
      const authority = getSourceAuthorityRegistry()!;
      const root = authority.conversation(parent.sessionId);
      vi.spyOn(authority, 'conversation').mockImplementation((id) =>
        id === parent.sessionId ? root : undefined
      );
      mocks.currentIdentity.mockImplementation((id) =>
        id === parent.sessionId ? parent : id === child.sessionId ? child : undefined
      );
      mocks.sessionWorktree.mockReturnValue({ path: '/isolated/worktree' });
      mocks.childProof.mockReturnValue({ toolIds: ['vetd_create', 'vetd_sizes'] });
      invoke('child-create', { identity: child });
      await Promise.resolve();
      expect(mocks.designRequest).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: '/isolated/worktree', sessionId: parent.sessionId })
      );
      expect(mocks.sendDesignResult).toHaveBeenCalledWith(
        child,
        'child-create',
        expect.objectContaining({ ok: true })
      );
      emit({ type: 'design-hook', identity: child, event: 'stop' });
      emit({ type: 'child-ended', identity: child });
      expect(mocks.designHook).not.toHaveBeenCalled();
      emit({ type: 'design-hook', identity: parent, event: 'stop' });
      expect(mocks.designHook).toHaveBeenCalledTimes(1);
      mocks.sessionWorktree.mockReset();
    });
    it('legacy coworker design calls require an indexed designer owned by the live root', async () => {
      const legacy = {
        sessionId: `${parent.sessionId}::cw-legacy`,
        generation: '22222222-2222-4222-8222-222222222222',
      };
      mocks.currentIdentity.mockImplementation((id) =>
        id === parent.sessionId ? parent : id === legacy.sessionId ? legacy : undefined
      );
      mocks.coworkerOf.mockReturnValue({ id: legacy.sessionId, agentType: 'worker' });
      invoke('legacy-worker', { identity: legacy });
      expect(mocks.designRequest).not.toHaveBeenCalled();
      expect(mocks.sendDesignResult).toHaveBeenLastCalledWith(
        legacy,
        'legacy-worker',
        expect.objectContaining({ ok: false })
      );
      mocks.coworkerOf.mockImplementation((owner, id) =>
        owner === parent && id === legacy.sessionId ? { id, agentType: 'designer' } : undefined
      );
      invoke('legacy-designer', { identity: legacy });
      await Promise.resolve();
      expect(mocks.designRequest).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: '/repo', sessionId: parent.sessionId })
      );
      expect(mocks.sendDesignResult).toHaveBeenLastCalledWith(
        legacy,
        'legacy-designer',
        expect.objectContaining({ ok: true })
      );
    });
    it('routes user prompt/agent_end and exact session end hooks once, not stale or disabled hooks', () => {
      emit({ type: 'design-hook', identity: parent, event: 'prompt-submit', prompt: 'design it' });
      emit({ type: 'design-hook', identity: parent, event: 'stop' });
      emit({ type: 'design-hook', identity: { ...parent, generation: 'old' }, event: 'stop' });
      emit({ type: 'parent-ended', identity: parent });
      emit({ type: 'parent-ended', identity: parent });
      expect(mocks.designHook.mock.calls.map(([event]) => event.event)).toEqual([
        'prompt-submit',
        'stop',
        'session-end',
      ]);
      expect(mocks.designHook.mock.calls[0][0]).toEqual({
        event: 'prompt-submit',
        cwd: '/repo',
        sessionId: parent.sessionId,
        prompt: 'design it',
      });
      mocks.readSettingsState.mockReturnValue({ designEnabled: false });
      emit({ type: 'design-hook', identity: parent, event: 'stop' });
      expect(mocks.designHook).toHaveBeenCalledTimes(3);
    });
    it('Stop hook is delivered after abort so changed designs can still auto-save history', () => {
      mocks.browserCancellationListener?.(parent, 'abort');
      emit({ type: 'design-hook', identity: parent, event: 'stop' });
      expect(mocks.designHook).toHaveBeenCalledWith(expect.objectContaining({ event: 'stop' }));
    });
  });

  describe('browser bridge', () => {
    const parent = {
      sessionId: 'browser-parent',
      generation: '11111111-1111-4111-8111-111111111111',
    };
    const emit = (event: Record<string, unknown>) =>
      mocks.setAgentEventListener.mock.calls.at(-1)![0]({ seq: 1, ...event });
    const invoke = (requestId: string, overrides = {}) =>
      emit({
        type: 'browser-invoke',
        identity: parent,
        requestId,
        op: 'wait',
        params: { kind: 'text', text: 'ready' },
        ...overrides,
      });
    beforeEach(() => {
      mocks.currentIdentity.mockImplementation((id) =>
        id === parent.sessionId ? parent : undefined
      );
      mocks.isAlive.mockReturnValue(true);
      mocks.readSettingsState.mockReturnValue({ disabledBuiltinTools: [] });
      mocks.browserInvoke.mockReset().mockResolvedValue({ ok: true });
      mocks.sendBrowserResult.mockReset();
    });
    it('旧 generation、结束会话及禁用 browser 均不执行宿主', () => {
      invoke('stale', {
        identity: { ...parent, generation: '22222222-2222-4222-8222-222222222222' },
      });
      mocks.isAlive.mockReturnValue(false);
      invoke('ended');
      mocks.isAlive.mockReturnValue(true);
      mocks.readSettingsState.mockReturnValue({ disabledBuiltinTools: ['browser'] });
      invoke('disabled');
      expect(mocks.browserInvoke).not.toHaveBeenCalled();
      expect(mocks.sendBrowserResult).toHaveBeenCalledTimes(3);
    });
    it('取消绑定身份，重放 requestId 不再次执行，迟到结果不投递', async () => {
      let signal: AbortSignal | undefined;
      let finish: ((result: unknown) => void) | undefined;
      mocks.browserInvoke.mockImplementation((_key, _op, _params, _actor, options) => {
        signal = options?.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      invoke('bound');
      expect(signal?.aborted).toBe(false);
      emit({
        type: 'browser-cancel',
        identity: { ...parent, sessionId: 'other' },
        requestId: 'bound',
      });
      expect(signal?.aborted).toBe(false);
      emit({ type: 'browser-cancel', identity: parent, requestId: 'bound' });
      expect(signal?.aborted).toBe(true);
      invoke('bound');
      expect(mocks.browserInvoke).toHaveBeenCalledTimes(1);
      mocks.sendBrowserResult.mockClear();
      finish?.({ late: true });
      await Promise.resolve();
      await Promise.resolve();
      expect(mocks.sendBrowserResult).not.toHaveBeenCalled();
    });
    it('generation 结束和 worker 退出立即取消 Main，在途完成不能给新代回结果', async () => {
      const signals: AbortSignal[] = [];
      mocks.browserInvoke.mockImplementation((_key, _op, _params, _actor, options) => {
        signals.push(options?.signal);
        return new Promise(() => {});
      });
      invoke('end');
      emit({ type: 'parent-ended', identity: parent, reason: 'released' });
      expect(signals[0]?.aborted).toBe(true);
      emit({
        type: 'parent-ready',
        identity: parent,
        sessionFile: '/tmp/enso-browser.jsonl',
        model: { providerId: 'p', modelId: 'm' },
      });
      invoke('exit');
      expect(signals).toHaveLength(2);
      emit({ type: 'worker-exited' });
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    });
    it('同 generation 的合法驱逐恢复重新开放新请求，但旧 requestId 不复用', async () => {
      invoke('before-eviction');
      await Promise.resolve();
      emit({ type: 'parent-ended', identity: parent, reason: 'evicted' });
      invoke('while-ended');
      expect(mocks.browserInvoke).toHaveBeenCalledTimes(1);
      emit({
        type: 'parent-ready',
        identity: parent,
        sessionFile: '/tmp/enso-browser.jsonl',
        model: { providerId: 'p', modelId: 'm' },
      });
      invoke('after-resume');
      invoke('before-eviction');
      expect(mocks.browserInvoke).toHaveBeenCalledTimes(2);
    });
    it('Main 超时中止宿主，generation 切换后的结果不发给新代', async () => {
      vi.useFakeTimers();
      try {
        let signal: AbortSignal | undefined;
        let finish: ((value: unknown) => void) | undefined;
        mocks.browserInvoke.mockImplementation((_key, _op, _params, _actor, options) => {
          signal = options.signal;
          return new Promise((resolve) => {
            finish = resolve;
          });
        });
        invoke('main-timeout');
        vi.advanceTimersByTime(65_001);
        expect(signal?.aborted).toBe(true);
        expect(mocks.sendBrowserResult).toHaveBeenCalledWith(
          parent,
          'main-timeout',
          expect.objectContaining({ ok: false })
        );
        mocks.sendBrowserResult.mockClear();
        finish?.('late');
        await Promise.resolve();
        expect(mocks.sendBrowserResult).not.toHaveBeenCalled();
        invoke('old-generation');
        mocks.currentIdentity.mockReturnValue({
          ...parent,
          generation: '22222222-2222-4222-8222-222222222222',
        });
        emit({ type: 'status', identity: parent, status: 'idle' });
        expect(signal?.aborted).toBe(true);
        finish?.('stale');
        await Promise.resolve();
        expect(mocks.sendBrowserResult).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
    it('停止/释放门拦截已排队的迟到调用，只有明确启动新轮才恢复', () => {
      mocks.browserCancellationListener?.(parent, 'abort');
      invoke('late-after-abort');
      expect(mocks.browserInvoke).not.toHaveBeenCalled();
      mocks.browserCancellationListener?.(parent, 'resume');
      invoke('new-turn');
      expect(mocks.browserInvoke).toHaveBeenCalledTimes(1);
      mocks.browserSessionEnabled.mockReturnValue(false);
      invoke('spawn-disabled');
      expect(mocks.browserInvoke).toHaveBeenCalledTimes(1);
      mocks.browserSessionEnabled.mockReturnValue(true);
    });
    it('typed child 不因拥有父身份而新增 browser 权限', () => {
      const child = {
        ...parent,
        sessionId: 'child',
        generation: '22222222-2222-4222-8222-222222222222',
        parent,
        instanceId: '33333333-3333-4333-8333-333333333333',
        instanceName: 'Enso',
        typeKey: 'agent:enso',
        profileId: 'enso-locked-v1',
      };
      mocks.currentIdentity.mockImplementation((id) =>
        id === child.sessionId ? child : id === parent.sessionId ? parent : undefined
      );
      invoke('child-forged', {
        identity: child,
        op: 'cdp',
        params: { method: 'Runtime.evaluate', params: { expression: '1' } },
      });
      expect(mocks.browserInvoke).not.toHaveBeenCalled();
    });
    it('模型不能使用 downloads reveal，即便跳过 worker schema', () => {
      invoke('reveal', { op: 'downloads', params: { action: 'reveal', id: 'file' } });
      expect(mocks.browserInvoke).not.toHaveBeenCalled();
    });
  });

  describe('computer bridge', () => {
    const parent = { sessionId: '11111111-1111-4111-8111-111111111111', generation: 'g' };
    const emit = (event: Record<string, unknown>) =>
      mocks.setAgentEventListener.mock.calls.at(-1)![0]({ seq: 1, ...event });

    beforeEach(() => {
      mocks.readSettingsState.mockReturnValue({ disabledBuiltinTools: [] });
      mocks.computerInvoke.mockReset();
      mocks.sendComputerResult.mockReset();
    });

    it('child / coworker 身份的 computer-invoke 在 Main 拒绝', () => {
      emit({
        type: 'computer-invoke',
        identity: { ...parent, sessionId: 'child', parent, instanceId: 'i', instanceName: 'n' },
        requestId: 'r1',
        op: 'run',
        params: { code: 'return 1' },
      });
      expect(mocks.computerInvoke).not.toHaveBeenCalled();
      expect(mocks.sendComputerResult).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'child' }),
        'r1',
        expect.objectContaining({ ok: false })
      );
    });

    it('computer-cancel 中止 Main 侧 run，worker 退出时停下全部', async () => {
      let signal: AbortSignal | undefined;
      mocks.computerInvoke.mockImplementation(
        (_id: string, _op: string, _params: unknown, s: AbortSignal) => {
          signal = s;
          return new Promise((_, reject) =>
            s.addEventListener('abort', () => reject(new Error('Computer action aborted')))
          );
        }
      );
      emit({
        type: 'computer-invoke',
        identity: parent,
        requestId: 'r2',
        op: 'run',
        params: { code: 'await wait(1000)' },
      });
      expect(signal?.aborted).toBe(false);
      emit({ type: 'computer-cancel', identity: parent, requestId: 'r2' });
      expect(signal?.aborted).toBe(true);
      await vi.waitFor(() =>
        expect(mocks.sendComputerResult).toHaveBeenCalledWith(
          parent,
          'r2',
          expect.objectContaining({ ok: false })
        )
      );
      emit({ type: 'worker-exited' });
      expect(mocks.computerCloseAll).toHaveBeenCalled();
    });

    it('默认关闭时不执行', () => {
      mocks.readSettingsState.mockReturnValue({});
      emit({
        type: 'computer-invoke',
        identity: parent,
        requestId: 'r3',
        op: 'run',
        params: { code: 'return 1' },
      });
      expect(mocks.computerInvoke).not.toHaveBeenCalled();
    });
  });
});

describe('device tools bridge', () => {
  const parent = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    generation: '22222222-2222-4222-8222-222222222222',
  };
  const child = {
    ...parent,
    sessionId: 'child',
    parent,
    instanceId: 'i',
    instanceName: 'n',
    typeKey: 'agent:scout',
    profileId: 'p',
  };
  const emit = (event: Record<string, unknown>) =>
    mocks.setAgentEventListener.mock.calls.at(-1)![0]({ seq: 1, ...event });

  beforeEach(() => {
    mocks.handlers.clear();
    registerAgentHandlers();
    mocks.readSettingsState.mockReturnValue({ disabledBuiltinTools: [] });
    mocks.currentIdentity.mockReturnValue(parent);
    mocks.isAlive.mockReturnValue(true);
    mocks.isMainWebContents.mockReturnValue(true);
    mocks.isReady.mockReturnValue(true);
    mocks.deviceCall.mockReset().mockResolvedValue({ result: {} });
    mocks.sendAgentCommand.mockClear();
    mocks.destroyDeviceAccessSession.mockClear();
    const authority = getSourceAuthorityRegistry()!;
    vi.spyOn(authority, 'conversation').mockImplementation((id) =>
      id === parent.sessionId
        ? {
            conversationId: id,
            projectId: 'local',
            kind: 'root',
            lifecycle: 'ready',
            version: 1,
          }
        : undefined
    );
    vi.spyOn(authority, 'project').mockReturnValue({
      projectId: 'local',
      state: 'active',
      version: 1,
      canonicalPath: '/workspace',
    });
  });

  const mainFrame = {};
  const deviceEvent = { sender: { ...sender, mainFrame }, senderFrame: mainFrame };
  const invoke = (channel: string, ...args: unknown[]) =>
    mocks.handlers.get(channel)!(deviceEvent, ...args);
  it('only grants the device port and access IPC to the main workbench top frame', () => {
    registerDeviceHostHandlers();
    const connect = mocks.handlers.get('device-host:connect')!;
    connect(deviceEvent);
    expect(mocks.deviceHostConnect).toHaveBeenCalledWith(deviceEvent.sender);
    const protectedOperations = [
      mocks.deviceHostConnect,
      mocks.listDeviceAccess,
      mocks.listAllowedDeviceAccess,
      mocks.answerDeviceAccess,
      mocks.revokeDeviceAccess,
      mocks.forgetDeviceAccess,
    ];
    for (const spy of protectedOperations) spy.mockClear();
    mocks.isMainWebContents.mockImplementation((id?: number) => id === sender.id);
    for (const bad of [
      { ...deviceEvent, senderFrame: {} },
      { ...deviceEvent, senderFrame: null },
      { ...deviceEvent, sender: { ...deviceEvent.sender, id: 2 } },
    ]) {
      connect(bad);
      expect(mocks.handlers.get(IPC_CHANNELS.DEVICE_ACCESS_LIST)!(bad, parent.sessionId)).toEqual(
        []
      );
      expect(mocks.handlers.get(IPC_CHANNELS.DEVICE_ACCESS_ALLOWED)!(bad)).toEqual([]);
      mocks.handlers.get(IPC_CHANNELS.DEVICE_ACCESS_ANSWER)!(
        bad,
        parent.sessionId,
        'entry',
        'always'
      );
      mocks.handlers.get(IPC_CHANNELS.DEVICE_ACCESS_REVOKE)!(bad, parent.sessionId, 'phone');
      mocks.handlers.get(IPC_CHANNELS.DEVICE_ACCESS_FORGET)!(bad, 'phone');
    }
    for (const spy of protectedOperations) expect(spy).not.toHaveBeenCalled();
  });
  const request = (requestId: string) =>
    emit({
      type: 'device-tool-invoke',
      identity: parent,
      requestId,
      toolName: 'device_snapshot',
      args: {},
    });
  it('publishes only the device entry and keeps generic approval in the worker', () => {
    const entry = {
      kind: 'device_access',
      id: 'entry',
      sessionId: parent.sessionId,
      deviceId: 'phone',
      deviceName: 'Phone',
      expiresAt: 100,
      decision: null,
    };
    mocks.broadcast.mockClear();
    mocks.bindDevice.mock.lastCall![0].changed(entry);
    expect(mocks.broadcast.mock.calls).toEqual([[IPC_CHANNELS.DEVICE_ACCESS_CHANGED, entry]]);
    invoke(IPC_CHANNELS.AGENT_APPROVAL_RESPOND, parent.sessionId, 'entry', 'allowSession');
    expect(mocks.respondApproval).toHaveBeenCalledWith(parent, 'entry', 'allowSession');
  });

  it('routes typed access operations; malformed or untrusted input never reaches the store', () => {
    const {
      DEVICE_ACCESS_LIST: list,
      DEVICE_ACCESS_ANSWER: answer,
      DEVICE_ACCESS_REVOKE: revoke,
      DEVICE_ACCESS_ALLOWED: allowed,
      DEVICE_ACCESS_FORGET: forget,
    } = IPC_CHANNELS;
    const id = parent.sessionId;
    const entries = [{ id: 'entry', sessionId: id }];
    mocks.listDeviceAccess.mockReturnValue(entries);
    mocks.listAllowedDeviceAccess.mockReturnValue(['phone']);
    mocks.answerDeviceAccess.mockClear();
    mocks.revokeDeviceAccess.mockClear();
    mocks.forgetDeviceAccess.mockClear();
    expect(invoke(list, id)).toEqual(entries);
    expect(invoke(answer, id, 'entry', 'session')).toBeUndefined();
    expect(mocks.answerDeviceAccess).toHaveBeenCalledWith(id, 'entry', 'session');
    expect(invoke(revoke, id, 'phone')).toBeUndefined();
    expect(mocks.revokeDeviceAccess).toHaveBeenCalledWith(id, 'phone');
    expect(invoke(allowed)).toEqual(['phone']);
    expect(invoke(forget, 'phone')).toBeUndefined();
    expect(mocks.forgetDeviceAccess).toHaveBeenCalledWith('phone');
    invoke(answer, id, 'entry', 'timeout');
    invoke(answer, {}, 'entry', 'always');
    invoke(answer, 'missing', 'entry', 'always');
    invoke(revoke, id, {});
    invoke(forget, {});
    mocks.isMainWebContents.mockReturnValue(false);
    expect(invoke(list, id)).toEqual([]);
    expect(invoke(allowed)).toEqual([]);
    invoke(answer, id, 'entry', 'always');
    invoke(revoke, id, 'phone');
    invoke(forget, 'phone');
    expect(mocks.answerDeviceAccess).toHaveBeenCalledTimes(1);
    expect(mocks.revokeDeviceAccess).toHaveBeenCalledTimes(1);
    expect(mocks.forgetDeviceAccess).toHaveBeenCalledTimes(1);
  });

  it.each(['abort', 'release', 'worker-exited', 'stop', 'dispose', 'replace', 'parent-ended'])(
    'cancels a pending ask at %s without dropping the session grant',
    async (phase) => {
      const pending = Promise.withResolvers<unknown>();
      mocks.deviceCall.mockReturnValueOnce(pending.promise);
      request('pending');
      const { signal } = mocks.deviceCall.mock.lastCall![0];
      emit({
        type: 'device-tool-cancel',
        identity: { ...parent, generation: 'old' },
        requestId: 'pending',
      });
      expect(signal.aborted).toBe(false);
      if (phase === 'worker-exited') emit({ type: phase });
      else if (phase === 'parent-ended')
        emit({ type: phase, identity: parent, reason: 'released' });
      else if (phase === 'dispose') disposeDeviceRequests();
      else if (phase === 'replace')
        mocks.browserCancellationListener?.({ ...parent, generation: 'new' }, 'resume');
      else if (phase === 'stop') mocks.browserCancellationListener?.();
      else mocks.browserCancellationListener?.(parent, phase);
      expect(signal.aborted).toBe(true);
      expect(mocks.destroyDeviceAccessSession).not.toHaveBeenCalled();
      pending.reject(new Error('late'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(mocks.sendAgentCommand).not.toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'pending' })
      );
    }
  );

  it('isolates identical worker request IDs across sessions, including cancellation', async () => {
    const other = { ...parent, sessionId: 'other-root' };
    const authority = getSourceAuthorityRegistry()!;
    const local = authority.conversation(parent.sessionId)!;
    vi.mocked(authority.conversation).mockImplementation((id) => ({
      ...local,
      conversationId: id,
    }));
    mocks.currentIdentity.mockImplementation((id) => (id === other.sessionId ? other : parent));
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    mocks.deviceCall.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    request('shared-id');
    emit({
      type: 'device-tool-invoke',
      identity: other,
      requestId: 'shared-id',
      toolName: 'device_snapshot',
      args: {},
    });
    expect(mocks.deviceCall.mock.calls).toHaveLength(2);
    emit({ type: 'device-tool-cancel', identity: parent, requestId: 'shared-id' });
    expect(mocks.deviceCall.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(mocks.deviceCall.mock.calls[1]![0].signal.aborted).toBe(false);
    first.resolve({ result: {} });
    second.resolve({ result: {} });
    await vi.waitFor(() =>
      expect(mocks.sendAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({ identity: other, ok: true })
      )
    );
    expect(mocks.sendAgentCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ identity: parent })
    );
  });

  it('forwards a used device turn ending once, never for stale or unrelated turns', async () => {
    mocks.deviceHostPost.mockClear();
    const ended = (identity: typeof parent) => emit({ type: 'turn-completed', identity });
    ended(parent);
    request('device-use');
    await vi.waitFor(() => expect(mocks.sendAgentCommand).toHaveBeenCalled());
    ended({ ...parent, generation: 'old' });
    expect(mocks.deviceHostPost).not.toHaveBeenCalled();
    ended(parent);
    ended(parent);
    expect(mocks.deviceHostPost.mock.calls).toEqual([
      [{ type: 'device-host:turn-ended', sessionId: parent.sessionId }],
    ]);
    expect(mocks.deviceTurnEnded).toHaveBeenCalledWith(parent.sessionId);
    expect(mocks.destroyDeviceAccessSession).not.toHaveBeenCalled();
  });

  it('never admits a stale generation or a child claiming the actual root ID', () => {
    const authority = mocks.bindDevice.mock.lastCall![0].authority;
    expect(authority({ ...parent, generation: 'older' })).toBeNull();
    expect(authority({ ...child, sessionId: parent.sessionId })).toBeNull();
    expect(authority(parent)).toMatchObject({
      sessionId: parent.sessionId,
      projectPath: '/workspace',
    });
    mocks.browserCancellationListener?.(parent, 'release');
    expect(authority(parent)).toBeNull();
    invoke(IPC_CHANNELS.DEVICE_ACCESS_LIST, parent.sessionId);
    expect(mocks.listDeviceAccess).toHaveBeenCalledWith(parent.sessionId);
    mocks.answerDeviceAccess.mockClear();
    invoke(IPC_CHANNELS.DEVICE_ACCESS_ANSWER, parent.sessionId, 'old-entry', 'always');
    expect(mocks.answerDeviceAccess).not.toHaveBeenCalled();
  });

  it('destroys grants only on accepted conversation removal', () => {
    const authority = getSourceAuthorityRegistry()!;
    const value = authority.conversation(parent.sessionId)!;
    const remove = vi.spyOn(authority, 'removeConversation');
    const payload = { requestId: 'remove', conversationId: parent.sessionId, version: 1 };
    remove.mockReturnValueOnce({ accepted: false, error: 'stale' });
    invoke(IPC_CHANNELS.SOURCE_CONVERSATION_REMOVE, payload);
    expect(mocks.destroyDeviceAccessSession).not.toHaveBeenCalled();
    remove.mockReturnValueOnce({ accepted: true, value });
    invoke(IPC_CHANNELS.SOURCE_CONVERSATION_REMOVE, payload);
    expect(mocks.destroyDeviceAccessSession).toHaveBeenCalledWith(parent.sessionId);
    expect(mocks.deviceHostPost).toHaveBeenCalledWith({
      type: 'device-host:sessions-ended',
      sessionIds: [parent.sessionId],
    });
  });

  it("forwards the model call to the device gateway with Main's own session identity", async () => {
    emit({
      type: 'device-tool-invoke',
      identity: parent,
      requestId: 'd1',
      toolName: 'device_snapshot',
      args: {},
    });
    await vi.waitFor(() =>
      expect(mocks.sendAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'device-tool-result', requestId: 'd1' })
      )
    );
  });

  it('refuses a child identity even when the parent session is live', async () => {
    emit({
      type: 'device-tool-invoke',
      identity: child,
      requestId: 'd2',
      toolName: 'device_snapshot',
      args: {},
    });
    await vi.waitFor(() =>
      expect(mocks.sendAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'device-tool-result', requestId: 'd2', ok: false })
      )
    );
  });

  it('answers a repeated requestId once and cancels an abandoned one', async () => {
    emit({
      type: 'device-tool-invoke',
      identity: parent,
      requestId: 'dup',
      toolName: 'device_snapshot',
      args: {},
    });
    emit({
      type: 'device-tool-invoke',
      identity: parent,
      requestId: 'dup',
      toolName: 'device_snapshot',
      args: {},
    });
    emit({ type: 'device-tool-cancel', identity: parent, requestId: 'dup' });
    await vi.waitFor(() =>
      expect(mocks.sendAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'device-tool-result', requestId: 'dup' })
      )
    );
  });

  it('rejects a malformed tool name instead of driving a device', async () => {
    emit({
      type: 'device-tool-invoke',
      identity: parent,
      requestId: 'd3',
      toolName: 'rm -rf /',
      args: {},
    });
    await vi.waitFor(() =>
      expect(mocks.sendAgentCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'device-tool-result', requestId: 'd3', ok: false })
      )
    );
  });
});

describe('压缩完成触发记忆整理', () => {
  const identity = { sessionId: 'conv-1', generation: 'g' };
  const emit = (event: Record<string, unknown>) =>
    mocks.setAgentEventListener.mock.calls.at(-1)![0]({ seq: 1, identity, ...event });
  const distill = vi.fn(async () => {});
  const markCompacted = vi.fn();

  beforeEach(() => {
    mocks.handlers.clear();
    registerAgentHandlers();
    mocks.scheduleMemoryDistill.mockClear();
    distill.mockClear();
    markCompacted.mockClear();
    mocks.sessionFile.mockReturnValue('/tmp/agent/sessions/conv-1.jsonl');
    mocks.getBotServices.mockReturnValue({
      memory: { distill },
      groups: { markCompacted },
      chats: { rootOf: () => undefined },
    });
  });

  const conversation = (bot?: { botId: string; chatId: string | null }) =>
    vi.spyOn(getSourceAuthorityRegistry()!, 'conversation').mockReturnValue({
      conversationId: 'conv-1',
      projectId: 'p',
      kind: 'root',
      lifecycle: 'ready',
      version: 1,
      ...(bot ? { bot } : {}),
    });

  it('Code 会话：成功压缩后按增量水位蒸馏；失败 / 放弃 / 开始不触发', () => {
    conversation();
    emit({ type: 'compaction', state: 'start' });
    emit({ type: 'compaction', state: 'end', error: 'boom' });
    emit({ type: 'compaction', state: 'end', abandoned: true });
    expect(mocks.scheduleMemoryDistill).not.toHaveBeenCalled();
    emit({ type: 'compaction', state: 'end' });
    expect(mocks.scheduleMemoryDistill).toHaveBeenCalledTimes(1);
    expect(mocks.scheduleMemoryDistill).toHaveBeenCalledWith(
      { sessionId: 'conv-1', sessionFile: '/tmp/agent/sessions/conv-1.jsonl', projectId: null },
      { continueFromLastJob: true }
    );
    expect(distill).not.toHaveBeenCalled();
  });

  it('Code 会话结束同样走增量水位', () => {
    conversation();
    emit({ type: 'parent-ended' });
    expect(mocks.scheduleMemoryDistill).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'conv-1' }),
      { continueFromLastJob: true }
    );
  });

  it('Bot 群聊会话：压缩后走 Bot 记忆整理并标记下次补群状态', () => {
    conversation({ botId: 'bot-a', chatId: 'chat-1' });
    emit({ type: 'compaction', state: 'end' });
    expect(distill).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        sessionFile: '/tmp/agent/sessions/conv-1.jsonl',
      })
    );
    expect(markCompacted).toHaveBeenCalledWith('chat-1', 'bot-a', 'conv-1');
    expect(mocks.scheduleMemoryDistill).not.toHaveBeenCalled();
  });

  it('Bot 私聊会话：只整理记忆，不标记群状态', () => {
    conversation({ botId: 'bot-a', chatId: null });
    emit({ type: 'compaction', state: 'end' });
    expect(distill).toHaveBeenCalledTimes(1);
    expect(markCompacted).not.toHaveBeenCalled();
  });

  it('Bot 审批解决及会话结束事件也到达通知门，防止异步通知迟发', () => {
    conversation({ botId: 'bot-a', chatId: 'chat-1' });
    mocks.maybeNotifyBot.mockClear();
    emit({ type: 'approval-resolved', requestId: 'apr' });
    emit({ type: 'parent-ended', reason: 'ended' });
    emit({ type: 'child-ended', reason: 'ended' });
    expect(mocks.maybeNotifyBot.mock.calls.map(([event]) => event.type)).toEqual([
      'approval-resolved',
      'parent-ended',
      'child-ended',
    ]);
  });
});
