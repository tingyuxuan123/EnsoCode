import { describe, expect, it } from 'vitest';
import { parseAgentCommand, parseAgentWorkerEvent } from './agent';

describe('plugin readonly agent worker protocol', () => {
  const command = {
    type: 'plugin-agent-run',
    requestId: 'request-1',
    identity: { sessionId: 'parent', generation: '11111111-1111-4111-8111-111111111111' },
    prompt: 'read README.md',
    context: 'fork',
    timeoutMs: 10000,
  };
  it('accepts typed commands and rejects forged model, paths, timeout and invalid fields', () => {
    expect(parseAgentCommand(command)).toEqual(command);
    for (const patch of [
      { prompt: '' },
      { timeoutMs: Infinity },
      { timeoutMs: -1 },
      { context: 'anything' },
      { model: { apiKey: 'forged' } },
      { cwd: '/etc' },
    ]) {
      expect(parseAgentCommand({ ...command, ...patch })).toBeNull();
    }
  });
  it('parses only bounded progress events and excludes credentials', () => {
    const event = {
      type: 'plugin-agent-event',
      requestId: 'request-1',
      event: {
        type: 'end',
        ok: true,
        text: 'proof',
        model: 'model',
      },
    };
    expect(parseAgentWorkerEvent(event)).toEqual(event);
    expect(
      parseAgentWorkerEvent({ ...event, event: { ...event.event, apiKey: 'secret' } })
    ).toBeNull();
    expect(
      parseAgentWorkerEvent({ ...event, event: { type: 'text', text: 'x'.repeat(65537) } })
    ).toBeNull();
  });
});
