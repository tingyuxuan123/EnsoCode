import { describe, expect, it } from 'vitest';
import { parseAgentCommand, parseAgentWorkerEvent } from './agent';

const identity = { sessionId: 's', generation: '11111111-1111-4111-8111-111111111111' };

describe('生图 worker 协议', () => {
  it('只接受完整 typed 配置与调用，不把 key 夹进协议', () => {
    const config = { type: 'set-image-generation-config', generate: true, edit: false };
    expect(parseAgentCommand(config)).toEqual(config);
    expect(parseAgentCommand({ ...config, apiKey: 'secret' })).toBeNull();
    const request = {
      type: 'image-generation-invoke',
      identity,
      seq: 1,
      requestId: 'call',
      tool: 'generate_image',
      params: { prompt: 'cat' },
    };
    expect(parseAgentWorkerEvent(request)).toEqual(request);
    expect(parseAgentWorkerEvent({ ...request, tool: 'arbitrary_tool' })).toBeNull();
    expect(parseAgentWorkerEvent({ ...request, apiKey: 'secret' })).toBeNull();
    const cancel = { type: 'image-generation-cancel', identity, seq: 2, requestId: 'call' };
    expect(parseAgentWorkerEvent(cancel)).toEqual(cancel);
    expect(parseAgentWorkerEvent({ ...cancel, tool: 'generate_image' })).toBeNull();
  });
});
