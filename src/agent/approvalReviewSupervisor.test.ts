import type { ApprovalRequestInfo, ProjectedMessage } from '@shared/types/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalGate, type ApprovalReviewContext, type ApprovalReviewResult } from './approval';
import { SessionSupervisor } from './supervisor';

afterEach(() => vi.restoreAllMocks());
type ReviewSupervisor = {
  handleCommand: SessionSupervisor['handleCommand'];
  reviewApproval(
    info: ApprovalRequestInfo,
    signal?: AbortSignal,
    context?: ApprovalReviewContext
  ): Promise<ApprovalReviewResult>;
  approvalReviewer: unknown;
  execute(command: Parameters<SessionSupervisor['handleCommand']>[0]): Promise<void>;
  sessions: Map<string, unknown>;
};
const valid = {
  stopReason: 'stop',
  answers: {
    decision: {
      type: 'choice',
      choice: 'allow',
      probabilities: { allow: 0.95, ask: 0.04, block: 0.01 },
    },
  },
};

function fixture(managed = true) {
  const classify = vi.fn().mockResolvedValue(valid);
  const runtime = {
    getModelsOfType: vi.fn().mockReturnValue([{ id: 'jev', provider: 'typesafe' }]),
    classify,
  };
  const source = {
    classifier: { provider: 'typesafe', modelId: 'jev', apiKey: 'fixture-review-secret' },
    managed,
  };
  const sessions = new Map();
  const supervisor = Object.assign(Object.create(SessionSupervisor.prototype), {
    sessions,
    approvalReviewer: source,
    getRuntime: async () => runtime,
  }) as ReviewSupervisor;
  const create = (id: string, text: string) => {
    const gate = new ApprovalGate(
      'assistant',
      () => {},
      () => {},
      { review: (info, signal, context) => supervisor.reviewApproval(info, signal, context) }
    );
    const owner = {
      identity: { sessionId: id, generation: id },
      gate,
      messages: [{ role: 'user', content: [{ type: 'text', text }] }] as ProjectedMessage[],
    };
    sessions.set(id, owner);
    return { owner, gate };
  };
  return { classify, runtime, source, supervisor, create };
}

describe('supervisor classifier protocol (stubbed runtime, not calibration)', () => {
  it('redacts reviewer and session credentials in the production chat reviewer request', async () => {
    const f = fixture();
    f.supervisor.approvalReviewer = {
      model: {
        api: 'openai-completions',
        baseUrl: 'https://review.invalid',
        apiKey: 'fixture-review-secret',
        modelId: 'review-model',
      },
    };
    const completeSimple = vi.fn().mockImplementation(async (_model, request) => {
      const text = request.messages[0].content as string;
      const actionHash = JSON.parse(text.slice(text.indexOf('{'))).actionHash;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ actionHash, decision: 'auto_allow', riskLevel: 'low' }),
          },
        ],
      };
    });
    Object.assign(f.runtime, {
      getModels: () => [],
      getModel: () => ({ id: 'review-model', provider: 'fixture' }),
      registerProvider: vi.fn(),
      getProvider: () => ({}),
      registerNativeProvider: vi.fn(),
      completeSimple,
    });
    const { gate, owner } = f.create(
      'chat',
      'Use fixture-review-secret and fixture-session-secret'
    );
    Object.assign(owner, { reviewSecrets: ['fixture-session-secret'] });
    await expect(
      gate.ask('bash', 'command', 'echo fixture-review-secret', undefined)
    ).resolves.toBe('allow');
    const request = JSON.stringify(completeSimple.mock.calls[0][1]);
    expect(request).not.toContain('fixture-review-secret');
    expect(request).not.toContain('fixture-session-secret');
  });
  it('preserves in-flight review for identical settings pushes, but revokes changed content', async () => {
    for (const change of ['same', 'managed', 'threshold', 'model', 'key'] as const) {
      const f = fixture();
      const deferred = Promise.withResolvers<typeof valid>();
      f.classify.mockReturnValue(deferred.promise);
      const { gate } = f.create('a', 'task');
      const pending = gate.ask('bash', 'command', 'echo A', undefined);
      await vi.waitFor(() => expect(f.classify).toHaveBeenCalledOnce());
      f.supervisor.handleCommand({
        type: 'set-approval-reviewer',
        classifier: {
          ...f.source.classifier,
          ...(change === 'model' ? { modelId: 'other' } : {}),
          ...(change === 'key' ? { apiKey: 'other-secret' } : {}),
        },
        ...(change === 'managed' ? {} : { managed: true }),
        ...(change === 'threshold' ? { allowThreshold: 0.95 } : {}),
      });
      deferred.resolve(valid);
      if (change === 'same') await expect(pending).resolves.toBe('allow');
      else {
        await vi.waitFor(() => expect(gate.snapshot()[0]?.reviewFallback).toBe('error'));
        gate.respond(gate.snapshot()[0].requestId, 'deny');
        await expect(pending).resolves.toBe('deny');
      }
    }
  });
  it('falls back with a distinct reason rather than reviewing truncated arguments', async () => {
    const f = fixture();
    const { gate } = f.create('a', 'task');
    const pending = gate.ask(
      'bash',
      'command',
      'large action',
      undefined,
      'call',
      undefined,
      undefined,
      {
        exactArguments: 'x'.repeat(12_001),
      }
    );
    await vi.waitFor(() => expect(gate.snapshot()[0]?.reviewFallback).toBe('too-large'));
    expect(f.classify).not.toHaveBeenCalled();
    gate.respond(gate.snapshot()[0].requestId, 'deny');
    await expect(pending).resolves.toBe('deny');
  });
  it('falls back before classification when redaction makes arguments exceed the limit', async () => {
    const f = fixture();
    const { gate } = f.create('a', 'task');
    const exactArguments = `${'x'.repeat(11_985)} password=x`;
    expect(exactArguments.length).toBeLessThan(12_000);
    const pending = gate.ask('bash', 'command', 'action', undefined, 'call', undefined, undefined, {
      exactArguments,
    });
    await vi.waitFor(() => expect(gate.snapshot()[0]?.reviewFallback).toBe('too-large'));
    expect(f.classify).not.toHaveBeenCalled();
    gate.respond(gate.snapshot()[0].requestId, 'deny');
    await expect(pending).resolves.toBe('deny');
  });
  it('keeps historical credentials redacted after switching the session model', async () => {
    const f = fixture();
    const { gate, owner } = f.create('a', 'Use old-provider-key and new-provider-key');
    Object.assign(owner, {
      reviewSecrets: ['old-provider-key'],
      session: { messages: [], setModel: vi.fn() },
      seq: 0,
    });
    Object.assign(f.supervisor, { options: { emit: vi.fn() } });
    Object.assign(f.runtime, {
      getModels: () => [],
      getModel: () => ({ id: 'new-model', provider: 'fixture' }),
      registerProvider: vi.fn(),
      getProvider: () => ({}),
      registerNativeProvider: vi.fn(),
    });
    await f.supervisor.execute({
      type: 'set-model',
      identity: owner.identity,
      model: {
        api: 'openai-completions',
        baseUrl: 'https://model.invalid',
        apiKey: 'new-provider-key',
        modelId: 'new-model',
        settingsProviderId: 'fixture',
      },
    });
    await expect(gate.ask('bash', 'command', 'echo task', undefined)).resolves.toBe('allow');
    const request = JSON.stringify(f.classify.mock.calls[0][1]);
    expect(request).not.toContain('old-provider-key');
    expect(request).not.toContain('new-provider-key');
  });
  it('redacts known reviewer and session credentials in the production classifier request', async () => {
    const f = fixture();
    const { gate, owner } = f.create('a', 'Use fixture-review-secret and fixture-session-secret');
    Object.assign(owner, { reviewSecrets: ['fixture-session-secret'] });
    await expect(
      gate.ask('bash', 'command', 'echo fixture-session-secret', undefined)
    ).resolves.toBe('allow');
    const request = JSON.stringify(f.classify.mock.calls[0][1]);
    expect(request).not.toContain('fixture-review-secret');
    expect(request).not.toContain('fixture-session-secret');
  });
  it('never sends review evidence after the historical secret budget is exhausted', async () => {
    const f = fixture();
    const { gate, owner } = f.create('a', 'historical credential');
    Object.assign(owner, { reviewSecrets: null });
    const pending = gate.ask('bash', 'command', 'echo task', undefined);
    await vi.waitFor(() => expect(gate.snapshot()[0]?.reviewFallback).toBe('error'));
    expect(f.classify).not.toHaveBeenCalled();
    gate.respond(gate.snapshot()[0].requestId, 'deny');
    await expect(pending).resolves.toBe('deny');
  });
  it('uses the exact concurrent request owner, action hash and context', async () => {
    const f = fixture();
    const a = f.create('a', 'task A');
    const b = f.create('b', 'task B');
    const results = await Promise.all([
      a.gate.ask('bash', 'command', 'echo A', undefined, 'call'),
      b.gate.ask('bash', 'command', 'echo B', undefined, 'call'),
    ]);
    expect(results).toEqual(['allow', 'allow']);
    const states = f.classify.mock.calls.map((call) => call[1].state);
    expect(states[0].recentMessages[0].content).toBe('task A');
    expect(states[1].recentMessages[0].content).toBe('task B');
    expect(states[0].actionHash).not.toBe(states[1].actionHash);
  });
  it('falls back when model/provider cannot be resolved, without invoking a classifier', async () => {
    const f = fixture();
    f.runtime.getModelsOfType.mockReturnValue([]);
    const { gate } = f.create('a', 'task');
    const pending = gate.ask('bash', 'command', 'echo A', undefined);
    await vi.waitFor(() => expect(gate.snapshot()[0]?.reviewFallback).toBe('error'));
    expect(f.classify).not.toHaveBeenCalled();
    gate.respond(gate.snapshot()[0].requestId, 'deny');
    await expect(pending).resolves.toBe('deny');
  });
  it('rejects late permission after generation or reviewer source changes', async () => {
    for (const change of ['generation', 'reviewer']) {
      const f = fixture();
      const deferred = Promise.withResolvers<typeof valid>();
      f.classify.mockReturnValue(deferred.promise);
      const { gate } = f.create('a', 'task');
      const pending = gate.ask('bash', 'command', 'echo A', undefined);
      await vi.waitFor(() => expect(f.classify).toHaveBeenCalledOnce());
      if (change === 'generation') f.supervisor.sessions.set('a', {});
      else f.supervisor.approvalReviewer = { ...f.source, managed: false };
      deferred.resolve(valid);
      await vi.waitFor(() => expect(gate.snapshot()[0]?.reviewFallback).toBe('error'));
      gate.respond(gate.snapshot()[0].requestId, 'deny');
      await expect(pending).resolves.toBe('deny');
    }
  });
  it('times out to a human even when classify ignores AbortSignal', async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const f = fixture();
    const deferred = Promise.withResolvers<typeof valid>();
    f.classify.mockReturnValue(deferred.promise);
    const { gate } = f.create('a', 'task');
    const pending = gate.ask('bash', 'command', 'echo A', undefined);
    await vi.waitFor(() => expect(f.classify).toHaveBeenCalledOnce());
    timeout.abort();
    await vi.waitFor(() => expect(gate.snapshot()[0]?.reviewFallback).toBe('timeout'));
    deferred.resolve(valid);
    await Promise.resolve();
    expect(gate.snapshot()).toHaveLength(1);
    gate.respond(gate.snapshot()[0].requestId, 'deny');
    await expect(pending).resolves.toBe('deny');
  });
  it('does not convert ordinary non-managed ambiguity into a managed denial', async () => {
    const f = fixture(false);
    f.classify.mockResolvedValue({
      ...valid,
      answers: {
        decision: {
          type: 'choice',
          choice: 'allow',
          probabilities: { allow: 0.6, ask: 0.3, block: 0.1 },
        },
      },
    });
    const { gate } = f.create('a', 'task');
    const pending = gate.ask('bash', 'command', 'echo A', undefined);
    await vi.waitFor(() => expect(gate.snapshot()[0]?.phase).toBeUndefined());
    expect(gate.snapshot()).toHaveLength(1);
    expect(gate.snapshot()[0]).not.toHaveProperty('reviewFallback');
    gate.respond(gate.snapshot()[0].requestId, 'allow');
    await expect(pending).resolves.toBe('allow');
  });
});
