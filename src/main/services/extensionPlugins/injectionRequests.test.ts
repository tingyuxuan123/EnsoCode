import { type AgentCommand, parseAgentCommand } from '@shared/types/agent';
import { afterEach, expect, it, vi } from 'vitest';
import { PluginInjectionRequests } from './injectionRequests';

const identity = { sessionId: 's', generation: '11111111-1111-4111-8111-111111111111' };
const message = {
  pluginId: 'a.b',
  pluginName: 'A',
  text: 'todo',
  images: [],
  deliverAs: 'followUp' as const,
  triggerTurn: true,
  sessionId: 'must-not-leak',
};
afterEach(() => vi.useRealTimers());

it('projects actual injection producer to strict parser and waits for exact worker acceptance', async () => {
  const post = vi.fn((_command: AgentCommand) => ({ ok: true }));
  const requests = new PluginInjectionRequests(post, () => identity);
  const pending = requests.inject(identity, message);
  const command = post.mock.calls[0][0];
  if (command.type !== 'plugin-inject') throw new Error('missing injection');
  expect(parseAgentCommand(command)).toEqual(command);
  expect(command).not.toHaveProperty('sessionId');
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  requests.settle({
    type: 'plugin-inject-result',
    requestId: command.requestId,
    identity: { ...identity, generation: '22222222-2222-4222-8222-222222222222' },
    ok: true,
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  requests.settle({
    type: 'plugin-inject-result',
    requestId: command.requestId,
    identity,
    ok: true,
  });
  await expect(pending).resolves.toEqual({ ok: true });
});

it('fails on timeout/exit/generation changes; late acceptance cannot revive a delivery', async () => {
  vi.useFakeTimers();
  const post = vi.fn((_command: AgentCommand) => ({ ok: true }));
  let live = identity;
  const requests = new PluginInjectionRequests(post, () => live, 100);
  const pending = requests.inject(identity, message);
  await vi.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toMatchObject({ ok: false });
  const exited = requests.inject(identity, message);
  requests.failAll('worker exited');
  await expect(exited).resolves.toEqual({ ok: false, error: 'worker exited' });
  const changed = requests.inject(identity, message);
  const command = post.mock.calls.at(-1)![0];
  if (command.type !== 'plugin-inject') throw new Error('missing injection');
  live = { ...identity, generation: '22222222-2222-4222-8222-222222222222' };
  requests.settle({
    type: 'plugin-inject-result',
    requestId: command.requestId,
    identity,
    ok: true,
  });
  await expect(changed).resolves.toMatchObject({ ok: false });
  expect(post).toHaveBeenCalledTimes(3);
});
