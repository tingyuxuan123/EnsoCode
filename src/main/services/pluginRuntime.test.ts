import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTypeEntry } from '../../shared/types/assets';
import type { PluginAgentDef, ResolvedPlugins } from './claudePlugins';
import {
  mergePluginAgentTypes,
  type NativePluginAgentDef,
  pluginAgentTypeId,
  setNativeAgentTypeSource,
  withPluginAgentTypes,
} from './pluginRuntime';

const custom = (name: string): AgentTypeEntry => ({
  id: '11111111-1111-4111-8111-111111111111',
  name,
  description: 'user',
  systemPrompt: 'user prompt',
  tools: 'all',
});
const claude = (name: string): PluginAgentDef => ({
  name,
  description: 'claude',
  systemPrompt: 'claude prompt',
  tools: 'all',
  skillPaths: [],
});
const native = (
  pluginId: string,
  name: string,
  patch: Partial<NativePluginAgentDef> = {}
): NativePluginAgentDef => ({
  pluginId,
  name,
  description: `native ${pluginId}`,
  systemPrompt: `prompt ${pluginId}`,
  tools: 'all',
  skillPaths: [],
  ...patch,
});
const resolved = (agents: PluginAgentDef[]): ResolvedPlugins => ({
  skillPaths: [],
  commands: [],
  agents,
  mcpServers: [],
  hooks: [],
});
afterEach(() => setNativeAgentTypeSource(null));

describe('native plugin agent types', () => {
  it('keeps tools, skill paths, stable ids and agent-picked model mode', () => {
    expect(
      mergePluginAgentTypes(
        [],
        [],
        [
          native('example.a', 'a:reader', {
            tools: 'readonly',
            skillPaths: ['/plugins/a/skills/review'],
            modelMode: 'agent_pick',
          }),
        ]
      )
    ).toEqual({
      dropped: [],
      types: [
        {
          id: pluginAgentTypeId('a:reader'),
          name: 'a:reader',
          description: 'native example.a',
          systemPrompt: 'prompt example.a',
          tools: 'readonly',
          modelMode: 'agent_pick',
          pluginSkillPaths: ['/plugins/a/skills/review'],
        },
      ],
    });
  });
  it('uses custom > Claude > native precedence and reports every native collision', () => {
    const result = mergePluginAgentTypes(
      [custom('Shared')],
      [claude('shared'), claude('cp:agent')],
      [native('example.a', 'shared'), native('example.a', 'cp:agent')]
    );
    expect(result.types.map((t) => [t.name, t.description])).toEqual([
      ['Shared', 'user'],
      ['cp:agent', 'claude'],
    ]);
    expect(result.dropped).toEqual([
      { name: 'shared', source: 'claude', shadowedBy: 'custom' },
      { name: 'shared', source: 'native', pluginId: 'example.a', shadowedBy: 'custom' },
      { name: 'cp:agent', source: 'native', pluginId: 'example.a', shadowedBy: 'claude' },
    ]);
  });
  it('sorts native plugins by id and protects builtin/reserved names', () => {
    const result = mergePluginAgentTypes(
      [],
      [],
      [
        native('example.b', 'same'),
        native('example.a', 'same'),
        native('example.a', 'worker'),
        native('example.a', 'custom:x'),
      ]
    );
    expect(result.types.map((t) => t.description)).toEqual(['native example.a']);
    expect(result.dropped.map((d) => d.shadowedBy)).toEqual(['builtin', 'builtin', 'native']);
  });
  it('reads the live source, reports drops, and allows an explicitly empty Bot scope', () => {
    const reportDropped = vi.fn();
    let agents = [native('example.a', 'helper'), native('example.a', 'cp:agent')];
    setNativeAgentTypeSource({ list: () => agents, reportDropped });
    expect(
      withPluginAgentTypes([], undefined, resolved([claude('cp:agent')])).map((t) => t.name)
    ).toEqual(['cp:agent', 'helper']);
    expect(reportDropped).toHaveBeenCalledWith([
      { name: 'cp:agent', source: 'native', pluginId: 'example.a', shadowedBy: 'claude' },
    ]);
    expect(withPluginAgentTypes([], undefined, resolved([]), [])).toEqual([]);
    agents = [];
    expect(withPluginAgentTypes([], undefined, resolved([]))).toEqual([]);
  });
});
