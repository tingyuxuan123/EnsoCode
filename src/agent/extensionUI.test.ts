import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getModel } from '@earendil-works/pi-ai/compat';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type { AskRequestInfo } from '@shared/types/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AskManager } from './ask';
import { bindExtensionUI } from './extensionUI';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

async function harness() {
  const root = mkdtempSync(path.join(tmpdir(), 'enso-extension-ui-'));
  const agentDir = path.join(root, 'agent');
  mkdirSync(agentDir);
  const runtime = await ModelRuntime.create({
    authPath: path.join(agentDir, 'auth.json'),
    modelsPath: path.join(agentDir, 'models.json'),
    refreshOnCreate: false,
  });
  let starts = 0;
  let current = true;
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [
      (pi) => {
        pi.on('session_start', () => {
          starts++;
        });
      },
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: root,
    agentDir,
    modelRuntime: runtime,
    model: getModel('openai', 'gpt-4o-mini'),
    resourceLoader: loader,
    settingsManager: SettingsManager.inMemory(),
    sessionManager: SessionManager.inMemory(root),
    noTools: 'all',
  });
  const requests: AskRequestInfo[] = [];
  const resolved: string[] = [];
  const asks = new AskManager(
    (info) => {
      requests.push(info);
    },
    (id) => resolved.push(id)
  );
  cleanups.push(() => {
    asks.cancelAll();
    session.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  bindExtensionUI(session.extensionRunner, asks, () => current);
  const context = session.extensionRunner.createContext();
  return {
    session,
    context,
    requests,
    resolved,
    asks,
    starts: () => starts,
    expire: () => {
      current = false;
    },
  };
}

describe('Pi 扩展 UI 桥接（真实 SDK，无网络、无用户配置）', () => {
  it('提供协议式交互，不触发 session_start，也不提前选中任何授权', async () => {
    const h = await harness();
    expect(h.context.hasUI).toBe(true);
    expect(h.context.mode).toBe('rpc');
    expect(h.starts()).toBe(0);
    const choices = [
      'Allow once',
      'Allow this conversation',
      'Always allow',
      'Deny',
      '  保留原文  ',
    ];
    const result = h.context.ui.select('Allow Computer Use to use TextEdit?', choices);
    expect(h.requests[0]).toMatchObject({ options: choices, selectionOnly: true });
    expect(h.asks.snapshot()).toHaveLength(1);
    h.asks.respond(h.requests[0].requestId, choices[4]);
    await expect(result).resolves.toBe(choices[4]);
    expect(h.resolved).toEqual([h.requests[0].requestId]);
  });

  it('取消和未知选项都只返回 undefined，不扩大到任何允许范围', async () => {
    const h = await harness();
    for (const answer of ['', 'Allow everything']) {
      const result = h.context.ui.select('授权？', ['Allow once', 'Deny']);
      h.asks.respond(h.requests.at(-1)!.requestId, answer);
      await expect(result).resolves.toBeUndefined();
    }
  });

  it('预先取消不发卡片，等待中取消立即清理卡片', async () => {
    const h = await harness();
    await expect(
      h.context.ui.select('q', ['Allow'], { signal: AbortSignal.abort() })
    ).resolves.toBeUndefined();
    expect(h.requests).toHaveLength(0);
    const controller = new AbortController();
    const result = h.context.ui.select('q', ['Allow'], { signal: controller.signal });
    controller.abort();
    await expect(result).resolves.toBeUndefined();
    expect(h.asks.snapshot()).toEqual([]);
    expect(h.resolved).toHaveLength(1);
  });

  it('确认超时或会话取消返回 false，只有明确选择允许才返回 true', async () => {
    const h = await harness();
    vi.useFakeTimers();
    const timeout = h.context.ui.confirm('确认', '继续？', { timeout: 10 });
    await vi.advanceTimersByTimeAsync(10);
    await expect(timeout).resolves.toBe(false);
    const cancelled = h.context.ui.confirm('确认', '继续？');
    h.asks.cancelAll();
    await expect(cancelled).resolves.toBe(false);
    const allowed = h.context.ui.confirm('确认', '继续？');
    h.asks.respond(h.requests.at(-1)!.requestId, 'Allow');
    await expect(allowed).resolves.toBe(true);
  });

  it('旧代不能创建请求，也不能采纳失效前一刻的迟到授权', async () => {
    const h = await harness();
    const late = h.context.ui.select('q', ['Allow']);
    h.asks.respond(h.requests[0].requestId, 'Allow');
    h.expire();
    await expect(late).resolves.toBeUndefined();
    await expect(h.context.ui.select('old', ['Allow'])).resolves.toBeUndefined();
    expect(h.requests).toHaveLength(1);
  });
});
