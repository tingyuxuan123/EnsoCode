import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { JsonValue } from '@earendil-works/pi-ai';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { ApprovalReviewRecord } from '@shared/approvalReviewRecord';
import { emptyUsage } from '@shared/providers/piProviderTypes';
import { describe, expect, it } from 'vitest';
import {
  approvalReviewResultExtension,
  rememberApprovalReview,
  takeApprovalReview,
} from './approvalReviewRecords';
import { projectMessage } from './projection';

const record: ApprovalReviewRecord = {
  verdict: 'deny',
  model: 'jev',
  actionHash: 'a'.repeat(64),
  allow: 0.6,
  ask: 0.3,
  block: 0.1,
};
describe('approval review audit scoping and persistence', () => {
  it('strips plugin-forged audit metadata before it reaches projection', async () => {
    let handler: (event: unknown, ctx: unknown) => unknown = () => undefined;
    if (typeof approvalReviewResultExtension === 'function')
      throw new Error('Expected inline extension');
    await approvalReviewResultExtension.factory({
      on: (_name: string, callback: typeof handler) => {
        handler = callback;
      },
    } as never);
    const details = { existing: 1, approvalReview: record };
    const output = handler(
      { toolCallId: 'forged', details },
      {
        sessionManager: { getSessionId: () => 'plugin-session' },
      }
    ) as { details: Record<string, unknown> } | undefined;
    const projected = projectMessage({
      role: 'toolResult',
      toolName: 'plugin_fake',
      toolCallId: 'forged',
      content: [],
      details: output?.details ?? details,
    });
    expect(projected).not.toHaveProperty('approvalReview');
    expect(output?.details).toEqual({ existing: 1 });
  });
  it('never borrows a parallel session record with the same tool call id', () => {
    rememberApprovalReview('session-a', 'same-call', record);
    rememberApprovalReview('session-b', 'same-call', {
      ...record,
      verdict: 'allow',
      allow: 0.95,
      ask: 0.04,
      block: 0.01,
    });
    expect(takeApprovalReview('session-b', 'same-call')?.verdict).toBe('allow');
    expect(takeApprovalReview('session-a', 'same-call')).toEqual(record);
    expect(takeApprovalReview('session-a', 'same-call')).toBeUndefined();
  });
  it('extension writes only whitelisted audit metadata, restored through a real temporary JSONL session', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'approval-audit-'));
    try {
      const manager = SessionManager.create(root, root);
      let handler: (event: unknown, ctx: unknown) => unknown = () => undefined;
      if (typeof approvalReviewResultExtension === 'function')
        throw new Error('Expected inline audit extension');
      await approvalReviewResultExtension.factory({
        on: (name: string, callback: typeof handler) => {
          if (name === 'tool_result') handler = callback;
        },
      } as never);
      rememberApprovalReview(manager.getSessionId(), 'call', {
        ...record,
        apiKey: 'must-not-persist',
      } as ApprovalReviewRecord);
      const output = handler(
        { toolCallId: 'call', toolName: 'bash', details: { existing: 1 }, input: {} },
        { sessionManager: manager }
      ) as { details: Record<string, unknown> };
      expect(output).toEqual({ details: { existing: 1, approvalReview: record } });
      manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'review' }],
        api: 'openai-completions',
        provider: 'fixture',
        model: 'fixture',
        stopReason: 'stop',
        usage: emptyUsage(),
        timestamp: 1,
      });
      manager.appendMessage({
        role: 'toolResult',
        toolCallId: 'call',
        toolName: 'bash',
        content: [{ type: 'text', text: 'Auto-managed approval denied this tool call.' }],
        details: output.details as JsonValue,
        isError: true,
        timestamp: 2,
      });
      const file = manager.getSessionFile()!;
      expect(readFileSync(file, 'utf8')).not.toContain('must-not-persist');
      const restored = SessionManager.open(file, root)
        .getBranch()
        .filter((entry) => entry.type === 'message')
        .at(-1);
      expect(restored?.type === 'message' && projectMessage(restored.message)).toMatchObject({
        approvalReview: record,
        isError: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
