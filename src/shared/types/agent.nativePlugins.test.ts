import { describe, expect, it } from 'vitest';
import { parseAgentCommand, parseAgentWorkerEvent } from './agent';

const identity = { sessionId: 'parent', generation: '11111111-1111-4111-8111-111111111111' };
const descriptor = {
  name: 'plugin_enso-example__check',
  description: 'check',
  pluginId: 'enso.example',
  fingerprint: 'a'.repeat(64),
  parameters: {
    type: 'object',
    properties: { value: { type: 'string' } },
    additionalProperties: false,
  },
};
const spawn = {
  type: 'spawn-parent',
  identity,
  cwd: '/tmp/workspace',
  model: {
    api: 'openai-completions',
    baseUrl: 'https://fixture.invalid',
    apiKey: 'fixture',
    modelId: 'fixture',
    settingsProviderId: 'fixture',
  },
  pluginTools: [descriptor],
};

describe('native plugin worker contracts', () => {
  it('接受完整工具清单，拒重复名/伪插件id/缺schema类型/缺fingerprint', () => {
    expect(parseAgentCommand(spawn)).toEqual(spawn);
    expect(parseAgentCommand({ ...spawn, pluginTools: [descriptor, descriptor] })).toBeNull();
    for (const tool of [
      { ...descriptor, pluginId: 'other.plugin' },
      { ...descriptor, parameters: {} },
      { ...descriptor, fingerprint: '' },
      { ...descriptor, name: 'bash' },
    ])
      expect(parseAgentCommand({ ...spawn, pluginTools: [tool] })).toBeNull();
  });
  it('插件invoke必须携带generation、版本指纹、对象参数，cancel/result严格收窄', () => {
    const event = {
      type: 'plugin-tool-invoke',
      identity,
      seq: 1,
      requestId: 'invoke-1',
      toolName: descriptor.name,
      fingerprint: descriptor.fingerprint,
      args: { value: 'x' },
    };
    expect(parseAgentWorkerEvent(event)).toEqual(event);
    expect(parseAgentWorkerEvent({ ...event, identity: { sessionId: 'parent' } })).toBeNull();
    expect(parseAgentWorkerEvent({ ...event, fingerprint: undefined })).toBeNull();
    expect(parseAgentWorkerEvent({ ...event, args: '{"value":"x"}' })).toBeNull();
    expect(
      parseAgentWorkerEvent({ type: 'plugin-tool-cancel', identity, seq: 2, requestId: 'invoke-1' })
    ).not.toBeNull();
    expect(
      parseAgentCommand({
        type: 'plugin-tool-result',
        identity,
        requestId: 'invoke-1',
        ok: true,
        result: { content: 'ok' },
      })
    ).not.toBeNull();
    expect(
      parseAgentCommand({ type: 'plugin-tool-result', identity, requestId: 'invoke-1', ok: false })
    ).toBeNull();
  });
  it('内层MCP list/call/cancel必须绑定同一个parent generation，凭证配置不能用脏形状', () => {
    const command = {
      type: 'plugin-mcp-call',
      identity,
      requestId: 'inner-1',
      servers: [],
      server: 'fixture',
      tool: 'check',
      args: { value: 'x' },
    };
    expect(parseAgentCommand(command)).toEqual(command);
    expect(parseAgentCommand({ ...command, identity: undefined })).toBeNull();
    expect(parseAgentCommand({ ...command, servers: [null] })).toBeNull();
    expect(
      parseAgentCommand({ type: 'plugin-mcp-list', identity, requestId: 'inner-1', servers: [] })
    ).not.toBeNull();
    expect(
      parseAgentCommand({ type: 'plugin-mcp-cancel', identity, requestId: 'inner-1' })
    ).not.toBeNull();
    expect(
      parseAgentWorkerEvent({
        type: 'plugin-mcp-result',
        identity,
        requestId: 'inner-1',
        ok: true,
        value: [],
      })
    ).not.toBeNull();
  });
});
