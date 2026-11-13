import { describe, expect, it } from 'vitest';
import { parseAgentCommand, parseAgentWorkerEvent } from './agent';

const identity = { sessionId: 'parent', generation: '11111111-1111-4111-8111-111111111111' };
const base = { identity, seq: 1 };

describe('native plugin event worker protocol', () => {
  it('accepts observe and intercept messages but not malformed payloads or host-only events', () => {
    expect(
      parseAgentWorkerEvent({
        ...base,
        type: 'plugin-event',
        event: 'model_select',
        data: { provider: 'p', modelId: 'm', source: 'set' },
      })
    ).not.toBeNull();
    expect(
      parseAgentWorkerEvent({
        ...base,
        type: 'plugin-intercept',
        requestId: 'r',
        event: 'before_agent_start',
        payload: { prompt: 'hi', kind: 'user' },
      })
    ).not.toBeNull();
    expect(
      parseAgentWorkerEvent({ ...base, type: 'plugin-event', event: 'session_status', data: {} })
    ).toBeNull();
    expect(
      parseAgentWorkerEvent({
        ...base,
        type: 'plugin-event',
        event: 'tool_call',
        data: { toolName: 'bash' },
      })
    ).toBeNull();
  });
  it('validates progress, intercept results, and image injections', () => {
    expect(
      parseAgentCommand({ type: 'plugin-tool-progress', identity, requestId: 'r', text: 'working' })
    ).not.toBeNull();
    expect(
      parseAgentCommand({
        type: 'plugin-tool-progress',
        identity,
        requestId: 'r',
        text: 'x'.repeat(16 * 1024 + 1),
      })
    ).toBeNull();
    expect(
      parseAgentCommand({
        type: 'plugin-intercept-result',
        identity,
        requestId: 'r',
        ok: true,
        result: { append: 'hi' },
      })
    ).not.toBeNull();
    const inject = {
      type: 'plugin-inject',
      identity,
      pluginId: 'example.demo',
      pluginName: 'Demo',
      text: 'hi',
      images: [{ data: 'AAAA', mimeType: 'image/png' }],
      deliverAs: 'followUp',
      triggerTurn: true,
    };
    expect(parseAgentCommand(inject)).not.toBeNull();
    expect(
      parseAgentCommand({ ...inject, images: [{ data: 'AAAA', mimeType: 'text/plain' }] })
    ).toBeNull();
  });
  it('isolates child source identity and disallows child input interception', () => {
    const child = { sessionId: 'parent::cw-scout', generation: identity.generation };
    const agent = { kind: 'coworker', sessionId: child.sessionId, name: 'Scout' };
    const event = {
      type: 'plugin-event',
      identity: child,
      seq: 1,
      agent,
      event: 'agent_end',
      data: {},
    };
    expect(parseAgentWorkerEvent(event)).not.toBeNull();
    expect(parseAgentWorkerEvent({ ...event, agent: { ...agent, sessionId: 'other' } })).toBeNull();
    expect(
      parseAgentWorkerEvent({
        ...event,
        type: 'plugin-intercept',
        requestId: 'r',
        event: 'input',
        payload: { text: 'hi', source: 'interactive' },
      })
    ).toBeNull();
  });
});
