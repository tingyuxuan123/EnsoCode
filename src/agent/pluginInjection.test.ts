import { expect, it, vi } from 'vitest';
import { PluginEventInvoker } from './pluginEvents';
import { PluginInjectionReceiver } from './pluginInjection';

const identity = { sessionId: 's', generation: '11111111-1111-4111-8111-111111111111' };
const command = {
  type: 'plugin-inject' as const,
  identity,
  requestId: 'r',
  pluginId: 'a.b',
  pluginName: 'A',
  text: 'todo',
  triggerTurn: true,
  deliverAs: 'followUp' as const,
};
it('accepts once without waiting for the model turn; routes asynchronous launch failures to the session', async () => {
  let reject!: (error: Error) => void;
  const sender = vi.fn(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      })
  );
  const invoker = new PluginEventInvoker({ observe: [], intercept: [], inject: true }, vi.fn());
  invoker.bindSender(sender);
  const managed = { identity, pluginEvents: invoker };
  const emit = vi.fn();
  const failed = vi.fn();
  const receiver = new PluginInjectionReceiver(() => managed, emit, failed);
  receiver.receive(command);
  receiver.receive(command);
  expect(sender).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenLastCalledWith({
    type: 'plugin-inject-result',
    identity,
    requestId: 'r',
    ok: true,
  });
  reject(new Error('startup failed'));
  await Promise.resolve();
  expect(failed).toHaveBeenCalledWith(managed, 'startup failed');
});

it('rejects unknown, stale, child, or not-ready targets explicitly', () => {
  const emit = vi.fn();
  let managed:
    | { identity: typeof identity; parentId?: string; pluginEvents?: PluginEventInvoker }
    | undefined;
  const receiver = new PluginInjectionReceiver(() => managed, emit, vi.fn());
  for (const [requestId, value] of [
    ['missing', undefined],
    ['stale', { identity: { ...identity, generation: '22222222-2222-4222-8222-222222222222' } }],
    ['child', { identity, parentId: 'p' }],
    ['not-ready', { identity }],
  ] as const) {
    managed = value;
    receiver.receive({ ...command, requestId });
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId, ok: false, error: expect.any(String) })
    );
  }
});

it('bounds live receipts without evicting an executable delivery ID', () => {
  const sender = vi.fn();
  const invoker = new PluginEventInvoker({ observe: [], intercept: [], inject: true }, vi.fn());
  invoker.bindSender(sender);
  const managed = { identity, pluginEvents: invoker };
  const emit = vi.fn();
  const receiver = new PluginInjectionReceiver(() => managed, emit, vi.fn(), 2);
  for (const requestId of ['first', 'second', 'third']) receiver.receive({ ...command, requestId });
  expect(sender).toHaveBeenCalledTimes(2);
  expect(emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ requestId: 'third', ok: false, error: expect.any(String) })
  );
  receiver.receive({ ...command, requestId: 'first' });
  expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 'first', ok: true }));
  expect(sender).toHaveBeenCalledTimes(2);
});

it('rejects invalid receipt capacities rather than disabling the bound', () => {
  for (const capacity of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => new PluginInjectionReceiver(() => undefined, vi.fn(), vi.fn(), capacity)).toThrow(
      RangeError
    );
});

it.each([
  { compaction: undefined, isCompacting: true },
  { compaction: 'running' as const, isCompacting: false },
])('rejects compaction without replaying later: %j', ({ compaction, isCompacting }) => {
  const sender = vi.fn();
  const invoker = new PluginEventInvoker({ observe: [], intercept: [], inject: true }, vi.fn());
  invoker.bindSender(sender);
  const managed: {
    identity: typeof identity;
    pluginEvents: PluginEventInvoker;
    compaction?: 'running';
    session: { isCompacting: boolean };
  } = { identity, pluginEvents: invoker, compaction, session: { isCompacting } };
  const emit = vi.fn();
  const receiver = new PluginInjectionReceiver(() => managed, emit, vi.fn());
  receiver.receive(command);
  expect(sender).not.toHaveBeenCalled();
  expect(emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ requestId: command.requestId, ok: false, error: expect.any(String) })
  );
  managed.session.isCompacting = false;
  managed.compaction = undefined;
  receiver.receive(command);
  expect(sender).not.toHaveBeenCalled();
  receiver.receive({ ...command, requestId: 'after-compaction' });
  expect(sender).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ requestId: 'after-compaction', ok: true })
  );
});

it('reclaims ended or replaced generations, but old IDs cannot execute again', () => {
  const sender = vi.fn();
  const invoker = new PluginEventInvoker({ observe: [], intercept: [], inject: true }, vi.fn());
  invoker.bindSender(sender);
  const other = { sessionId: 'other', generation: identity.generation };
  const sessions = new Map([
    [identity.sessionId, { identity, pluginEvents: invoker }],
    [other.sessionId, { identity: other, pluginEvents: invoker }],
  ]);
  const emit = vi.fn();
  const receiver = new PluginInjectionReceiver((id) => sessions.get(id), emit, vi.fn(), 2);
  receiver.receive({ ...command, requestId: 'keep' });
  receiver.receive({ ...command, identity: other, requestId: 'ended' });
  sessions.delete(other.sessionId);
  receiver.receive({ ...command, requestId: 'new-after-exit' });
  expect(sender).toHaveBeenCalledTimes(3);
  receiver.receive({ ...command, identity: other, requestId: 'ended' });
  expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 'ended', ok: false }));
  const replacement = { ...identity, generation: '22222222-2222-4222-8222-222222222222' };
  sessions.set(identity.sessionId, { identity: replacement, pluginEvents: invoker });
  receiver.receive({ ...command, identity: replacement, requestId: 'new-after-replacement' });
  expect(sender).toHaveBeenCalledTimes(4);
  receiver.receive({ ...command, requestId: 'keep' });
  expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 'keep', ok: false }));
  receiver.receive({ ...command, identity: replacement, requestId: 'new-after-replacement' });
  expect(sender).toHaveBeenCalledTimes(4);
});
