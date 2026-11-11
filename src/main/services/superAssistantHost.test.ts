import { describe, expect, it } from 'vitest';
import { SuperAssistantHost } from './superAssistantHost';

const identity = { sessionId: 'coordinator', generation: 'g' };
function setup() {
  let busy = true;
  const sent: string[] = [];
  const host = new SuperAssistantHost({
    coordinator: () => 'coordinator',
    current: (id) => ({ sessionId: id, generation: 'g' }),
    list: () => [
      { projectId: 'p', projectName: 'Project', conversationId: 'target', title: 'Test' },
    ],
    create: () => 'target',
    history: async () => ({ messages: [] }),
    busy: () => busy,
    prepare: async (id) => ({ sessionId: id, generation: 'g' }),
    prompt: (_identity, _text, deliveryId) => {
      sent.push(deliveryId);
      return { ok: true };
    },
    abort: () => ({ ok: true }),
    changed: () => {},
  });
  return {
    host,
    sent,
    idle: () => {
      busy = false;
    },
  };
}
describe('SuperAssistantHost', () => {
  it('rejects ordinary, stale and child callers', async () => {
    const { host } = setup();
    for (const caller of [
      { ...identity, sessionId: 'target' },
      { ...identity, generation: 'old' },
      { ...identity, parent: identity },
    ]) {
      expect((await host.invoke(caller, { operation: 'list' })).ok).toBe(false);
    }
  });
  it('queues busy targets and settles only the acknowledged generation delivery on a terminal turn', async () => {
    const { host, sent, idle } = setup();
    await host.invoke(identity, {
      operation: 'dispatch',
      projectId: 'p',
      conversationId: 'target',
      prompt: 'do work',
    });
    expect(host.snapshot().tasks[0].status).toBe('queued');
    expect(sent).toEqual([]);
    idle();
    host.observe({
      type: 'status',
      identity: { sessionId: 'target', generation: 'g' },
      seq: 1,
      status: 'idle',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toHaveLength(1);
    const target = { sessionId: 'target', generation: 'g' };
    host.observe({ type: 'turn-completed', identity: target, seq: 2, turnId: 'unrelated' });
    expect(host.snapshot().tasks[0].status).toBe('queued');
    expect(host.cancel(sent[0]).ok).toBe(false);
    host.observe({ type: 'delivery-settled', identity: target, seq: 3, deliveryId: sent[0] });
    host.observe({ type: 'status', identity: target, seq: 4, status: 'idle' });
    expect(host.snapshot().tasks[0].status).toBe('running');
    host.observe({
      type: 'turn-completed',
      identity: { ...target, generation: 'old' },
      seq: 5,
      turnId: 'old',
    });
    expect(host.snapshot().tasks[0].status).toBe('running');
    host.observe({
      type: 'turn-completed',
      identity: target,
      seq: 6,
      turnId: 'done',
      digest: { firstUserText: '', userText: '', assistantText: 'result' },
    });
    expect(host.snapshot().tasks[0]).toMatchObject({ status: 'finished', summary: 'result' });
  });
  it('worker exit interrupts unknown deliveries and never replays them', async () => {
    const { host } = setup();
    await host.invoke(identity, {
      operation: 'dispatch',
      projectId: 'p',
      conversationId: 'target',
      prompt: 'work',
    });
    host.observe({ type: 'worker-exited' });
    expect(host.snapshot().tasks[0].status).toBe('failed');
  });
  it('rechecks a queued root when its busy child settles without using child output as a root receipt', async () => {
    const { host, sent, idle } = setup();
    const root = { sessionId: 'target', generation: 'g' };
    const child = {
      ...root,
      sessionId: 'child',
      parent: root,
      instanceId: 'child',
      instanceName: 'Worker',
      typeKey: 'builtin:worker' as const,
    };
    await host.invoke(identity, {
      operation: 'dispatch',
      projectId: 'p',
      conversationId: 'target',
      prompt: 'work',
    });
    expect(sent).toHaveLength(0);
    idle();
    host.observe({ type: 'status', identity: child, seq: 1, status: 'idle' });
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    host.observe({ type: 'delivery-settled', identity: root, seq: 2, deliveryId: sent[0] });
    host.observe({ type: 'turn-completed', identity: child, seq: 3, turnId: 'child-turn' });
    expect(host.snapshot().tasks[0].status).toBe('running');
  });
  it('denies history and dispatch to unlisted projects, bot/child/remote targets', async () => {
    const { host } = setup();
    for (const request of [
      { operation: 'history', conversationId: 'bot' },
      { operation: 'dispatch', projectId: 'ssh', conversationId: 'target', prompt: 'work' },
      { operation: 'dispatch', projectId: 'p', conversationId: 'child', prompt: 'work' },
    ])
      expect((await host.invoke(identity, request)).ok).toBe(false);
    expect(host.snapshot().tasks).toEqual([]);
  });
  it('cancels a queued task without sending it when idle arrives', async () => {
    const { host, sent, idle } = setup();
    await host.invoke(identity, {
      operation: 'dispatch',
      projectId: 'p',
      conversationId: 'target',
      prompt: 'work',
    });
    expect(host.cancel(host.snapshot().tasks[0].id).ok).toBe(true);
    idle();
    host.observe({
      type: 'status',
      identity: { sessionId: 'target', generation: 'g' },
      seq: 1,
      status: 'idle',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([]);
    expect(host.snapshot().tasks[0].status).toBe('canceled');
  });
});
