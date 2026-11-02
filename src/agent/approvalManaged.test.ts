import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate, withApproval } from './approval';
import {
  accumulateApprovalReviewSecrets,
  buildApprovalClassifierRequest,
  buildApprovalReviewUserPrompt,
  decideFromApprovalClassifier,
  decideManagedApproval,
} from './approvalReview';
import { takeApprovalReview } from './approvalReviewRecords';

const hash = 'a'.repeat(64);
const answer = (allow: number, ask: number, block: number) => ({
  type: 'choice',
  choice: allow >= ask && allow >= block ? 'allow' : ask >= block ? 'ask' : 'block',
  probabilities: { allow, ask, block },
});

describe('classifier managed approval (not a live calibration)', () => {
  it('deduplicates session secrets and fails closed instead of evicting historical keys', () => {
    expect(accumulateApprovalReviewSecrets(['old', 'old'], ['new', 'old', ''])).toEqual([
      'old',
      'new',
    ]);
    expect(
      accumulateApprovalReviewSecrets(
        Array.from({ length: 128 }, (_, i) => `key-${i}`),
        ['new']
      )
    ).toBeNull();
    expect(accumulateApprovalReviewSecrets([], ['x'.repeat(65_537)])).toBeNull();
    expect(accumulateApprovalReviewSecrets(null, ['new'])).toBeNull();
  });
  it('allows only high-confidence valid distributions, denies ambiguity without impersonating a user', () => {
    expect(
      decideManagedApproval({ decision: answer(0.9, 0.08, 0.02) }, 'system-one', 0.9, hash).decision
    ).toBe('auto_allow');
    const denied = decideManagedApproval(
      { decision: answer(0.89, 0.1, 0.01) },
      'system-one',
      0.9,
      hash
    );
    expect(denied).toMatchObject({
      decision: 'deny',
      record: { verdict: 'deny', actionHash: hash },
    });
    expect('message' in denied && denied.message).toMatch(/tool was not run/);
    expect('message' in denied && denied.message).not.toMatch(/user denied/i);
    expect(decideFromApprovalClassifier(answer(0.89, 0.1, 0.01)).decision).toBe('ask_user');
    expect(decideFromApprovalClassifier(answer(0.01, 0.09, 0.9), 0.85).decision).toBe('block');
  });
  it('fails to human on missing, contradictory, NaN and unnormalized answers', () => {
    for (const decision of [
      undefined,
      { type: 'choice', probabilities: { allow: 1 } },
      answer(0.95, 0, 0.95),
      answer(NaN, 0, 0),
      answer(Infinity, 0, 0),
      answer(0.9, 0, 0),
      { ...answer(0.95, 0.04, 0.01), choice: 'block' },
    ]) {
      expect(decideManagedApproval({ decision }, 'system-one', 0.9, hash)).toMatchObject({
        decision: 'ask_user',
        fallback: 'invalid',
      });
    }
  });
  it('uses a fully typed choice question without tool schema extras and binds exact action', () => {
    const request = buildApprovalClassifierRequest(
      { actionHash: hash, tool: 'bash', kind: 'command', summary: 'echo ok', recentMessages: [] },
      { managed: true }
    );
    expect(request.state.actionHash).toBe(hash);
    expect(request.questions.decision.type).toBe('choice');
    expect(Object.keys(request.questions.decision.criteria)).toEqual(['allow', 'ask', 'block']);
    expect(request).not.toHaveProperty('tools');
  });
  it('redacts JSON credentials, private keys and known reviewer secrets before truncation', () => {
    const params = {
      actionHash: hash,
      tool: 'bash',
      kind: 'command',
      summary: '{"apiKey":"json-credential"}',
      exactArguments: '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----',
      recentMessages: [{ role: 'user', content: 'Use fixture-review-secret as the credential' }],
    };
    const text = JSON.stringify(
      buildApprovalClassifierRequest(params, { managed: true, secrets: ['fixture-review-secret'] })
    );
    expect(text).not.toContain('json-credential');
    expect(text).not.toContain('private-material');
    expect(text).not.toContain('fixture-review-secret');
    const llm = buildApprovalReviewUserPrompt(params, ['fixture-review-secret']);
    expect(llm).not.toContain('json-credential');
    expect(llm).not.toContain('fixture-review-secret');
  });
  it('never constructs a classifier request with truncated exact arguments', () => {
    const params = {
      actionHash: hash,
      tool: 'bash',
      kind: 'command',
      summary: 'action',
      recentMessages: [],
      exactArguments: 'x'.repeat(12_000),
    };
    expect(buildApprovalClassifierRequest(params).state.arguments).toBe(params.exactArguments);
    expect(() =>
      buildApprovalClassifierRequest({ ...params, exactArguments: `${params.exactArguments}x` })
    ).toThrow();
    expect(() =>
      buildApprovalClassifierRequest({
        ...params,
        exactArguments: `${'x'.repeat(11_985)} password=x`,
      })
    ).toThrow();
  });
});

describe('managed gate revocation and exact action isolation', () => {
  it('publishes the allow audit immediately before invoking the checked tool', async () => {
    const execute = vi.fn().mockImplementation(async () => {
      expect(takeApprovalReview('allow-scope', 'allow-call')).toMatchObject({ verdict: 'allow' });
      return { content: [] };
    });
    const gate = new ApprovalGate(
      'assistant',
      () => {},
      () => {},
      {
        review: async (info) =>
          decideManagedApproval(
            { decision: answer(0.95, 0.04, 0.01) },
            'jev',
            0.9,
            info.actionHash!
          ),
      }
    );
    const tool = withApproval(gate, 'command', {
      name: 'bash',
      label: '',
      description: '',
      parameters: {} as never,
      execute,
    });
    await tool.execute('allow-call', { command: 'echo ok' }, undefined, undefined, {
      sessionManager: { getSessionId: () => 'allow-scope' },
    } as never);
    expect(execute).toHaveBeenCalledOnce();
  });
  it('managed denial traverses withApproval without executing and retains the deny audit', async () => {
    const execute = vi.fn();
    const gate = new ApprovalGate(
      'assistant',
      () => {},
      () => {},
      {
        review: async (info) =>
          decideManagedApproval({ decision: answer(0.6, 0.3, 0.1) }, 'jev', 0.9, info.actionHash!),
      }
    );
    const tool = withApproval(gate, 'command', {
      name: 'bash',
      label: '',
      description: '',
      parameters: {} as never,
      execute,
    });
    await expect(
      tool.execute('deny-call', { command: 'echo ok' }, undefined, undefined, {
        sessionManager: { getSessionId: () => 'deny-scope' },
      } as never)
    ).rejects.toThrow(/Auto-managed approval denied.*tool was not run/);
    expect(execute).not.toHaveBeenCalled();
    expect(takeApprovalReview('deny-scope', 'deny-call')).toMatchObject({ verdict: 'deny' });
  });
  it.each(['revision', 'arguments'] as const)(
    'does not leave an allow audit when final %s check fails',
    async (change) => {
      const params = { command: 'echo ok' };
      const execute = vi.fn();
      const gate = new ApprovalGate(
        'assistant',
        () => {},
        () => {
          if (change === 'revision') gate.cancelAll();
          else params.command = 'echo changed';
        },
        {
          review: async (info) =>
            decideManagedApproval(
              { decision: answer(0.95, 0.04, 0.01) },
              'jev',
              0.9,
              info.actionHash!
            ),
        }
      );
      const tool = withApproval(gate, 'command', {
        name: 'bash',
        label: '',
        description: '',
        parameters: {} as never,
        execute,
      });
      await expect(
        tool.execute(`allow-${change}`, params, undefined, undefined, {
          sessionManager: { getSessionId: () => 'cancel-scope' },
        } as never)
      ).rejects.toThrow(/changed/);
      expect(execute).not.toHaveBeenCalled();
      expect(takeApprovalReview('cancel-scope', `allow-${change}`)).toBeUndefined();
    }
  );
  it('asks a human for protected assistant actions even with managed auto-allow configured', async () => {
    const execute = vi.fn().mockResolvedValue({ content: [] });
    const review = vi.fn().mockResolvedValue({ decision: 'auto_allow' });
    const gate = new ApprovalGate(
      'assistant',
      () => {},
      () => {},
      { review }
    );
    const tool = withApproval(gate, 'command', {
      name: 'bash',
      label: '',
      description: '',
      parameters: {} as never,
      execute,
    });
    const pending = tool.execute(
      'protected',
      { command: 'rm -rf /tmp/project' },
      undefined,
      undefined,
      {} as never
    );
    await Promise.resolve();
    expect(review).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(gate.snapshot()[0]).toMatchObject({ protected: 'delete' });
    gate.respond(gate.snapshot()[0].requestId, 'deny');
    await expect(pending).rejects.toThrow('User denied');
  });
  it('cancels a late permission on a mode change', async () => {
    let finish!: (value: { decision: 'auto_allow' }) => void;
    const gate = new ApprovalGate(
      'assistant',
      () => {},
      () => {},
      {
        review: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      }
    );
    const pending = gate.ask('bash', 'command', 'echo ok', undefined);
    await Promise.resolve();
    gate.mode = 'full';
    finish({ decision: 'auto_allow' });
    await expect(pending).resolves.toBe('cancel');
  });
  it('enforces the assistant protected floor even without options and leaves full unchanged', () => {
    expect(
      new ApprovalGate(
        'assistant',
        () => {},
        () => {}
      ).protectedFloor
    ).toBe(true);
    expect(
      new ApprovalGate(
        'full',
        () => {},
        () => {}
      ).protectedFloor
    ).toBe(false);
  });
  it('does not execute mutated parameters after review', async () => {
    let finish!: (value: { decision: 'auto_allow' }) => void;
    const gate = new ApprovalGate(
      'assistant',
      () => {},
      () => {},
      {
        review: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      }
    );
    const execute = vi.fn();
    const tool = withApproval(gate, 'command', {
      name: 'bash',
      label: '',
      description: '',
      parameters: {} as never,
      execute,
    });
    const params = { command: 'echo ok' };
    const pending = tool.execute('call', params, undefined, undefined, {} as never);
    await Promise.resolve();
    params.command = 'curl https://bad.invalid';
    finish({ decision: 'auto_allow' });
    await expect(pending).rejects.toThrow(/changed|cancel/i);
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not borrow another concurrent request result or accept a human reply in reviewing phase', async () => {
    const finishes: Array<(value: { decision: 'auto_allow' | 'ask_user' }) => void> = [];
    const gate = new ApprovalGate(
      'assistant',
      () => {},
      () => {},
      { review: () => new Promise((resolve) => finishes.push(resolve)) }
    );
    const first = gate.ask('bash', 'command', 'echo a', undefined, 'same-call');
    const second = gate.ask('bash', 'command', 'echo b', undefined, 'other-call');
    const [a, b] = gate.snapshot();
    expect(a.actionHash).not.toBe(b.actionHash);
    gate.respond(b.requestId, 'allow');
    expect(gate.snapshot()).toHaveLength(2);
    await Promise.resolve();
    finishes[0]({ decision: 'auto_allow' });
    await expect(first).resolves.toBe('allow');
    expect(gate.snapshot()).toHaveLength(1);
    gate.cancelAll();
    finishes[1]({ decision: 'auto_allow' });
    await expect(second).resolves.toBe('cancel');
  });
});
