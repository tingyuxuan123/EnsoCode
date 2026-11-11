import { describe, expect, it } from 'vitest';
import { parseSuperAssistantRequest } from './superAssistantProtocol';
import { parseAgentCommand, parseAgentWorkerEvent } from './types/agent';

describe('Super Assistant closed worker protocol', () => {
  const identity = { sessionId: 's', generation: '11111111-1111-4111-8111-111111111111' };
  it('accepts root bridge traffic only and validates operation at the worker boundary', () => {
    const event = {
      type: 'super-assistant-invoke',
      identity,
      seq: 1,
      requestId: 'r',
      request: { operation: 'list' },
    };
    expect(parseAgentWorkerEvent(event)).toEqual(event);
    expect(parseAgentWorkerEvent({ ...event, request: { operation: 'shell' } })).toBeNull();
    const child = {
      ...identity,
      parent: identity,
      instanceId: '22222222-2222-4222-8222-222222222222',
      instanceName: 'worker',
      typeKey: 'builtin:worker',
    };
    expect(parseAgentWorkerEvent({ ...event, identity: child })).toBeNull();
    const result = {
      type: 'super-assistant-result',
      identity,
      requestId: 'r',
      ok: true,
      result: [],
    };
    expect(parseAgentCommand(result)).toEqual(result);
    expect(parseAgentCommand({ ...result, identity: child })).toBeNull();
    expect(parseAgentCommand({ ...result, error: 'contradictory' })).toBeNull();
  });
  it('accepts only typed bounded operations and identifiers, never paths or extra fields', () => {
    expect(parseSuperAssistantRequest({ operation: 'list', limit: 20 })).toEqual({
      operation: 'list',
      limit: 20,
    });
    expect(
      parseSuperAssistantRequest({
        operation: 'dispatch',
        projectId: 'p',
        conversationId: 's',
        prompt: 'fix tests',
      })
    ).not.toBeNull();
    for (const request of [
      { operation: 'shell', command: 'pwd' },
      { operation: 'history', conversationId: 's', limit: 101 },
      { operation: 'history', conversationId: 's', path: '/tmp/x' },
      { operation: 'dispatch', projectId: 'p', prompt: ' ' },
      { operation: 'dispatch', sessionId: 's', task: 'fix tests' },
      { operation: 'cancel', taskId: 123 },
    ])
      expect(parseSuperAssistantRequest(request)).toBeNull();
  });
});
