import { type ChildProfileToolOptions, childProfileToolIds } from '@shared/childProfileTools';
import type { AgentTypeSpawnConfig } from '@shared/types/agent';

type CapabilityType = Pick<AgentTypeSpawnConfig, 'name' | 'allowModelOverride'> &
  Partial<Pick<AgentTypeSpawnConfig, 'description' | 'tools' | 'writeScope' | 'mcpServers'>>;

export const DELEGATION_CAPABILITY_GUIDANCE =
  'Match the task to the listed agent capabilities before spawning. Read-only agents have no shell: do not ask them to run git log/show/diff, tests or commands; inspect those yourself and include bounded evidence, or select an appropriately authorized type. ' +
  'If a required capability is missing, the child must report the limitation early rather than search unrelated projects or invent evidence. Do not grant extra permissions or choose a model silently.';

/** 仅格式化已下发的工具档、模型策略及范围，绝不序列化模型凭证或 MCP env。 */
export function agentTypeCapabilitySummary(
  type: CapabilityType,
  profile?: ChildProfileToolOptions
): string {
  const parts = [type.name + (type.description ? ` (${type.description})` : '')];
  if (type.tools) {
    parts.push(`built-in tools: ${childProfileToolIds(type.tools, profile).join(', ')}`);
    if (type.tools === 'readonly' || profile?.workspaceWrite === false) {
      parts.push('no shell or file-edit tools');
    }
    if (type.tools === 'all' && profile?.workspaceWrite !== false && type.writeScope?.length) {
      parts.push(
        `file-edit scope: ${type.writeScope.join(', ')}; never bypass this scope with shell commands`
      );
    }
    if (type.mcpServers?.length) {
      parts.push(
        'configured MCP tools may also be available after connection; they are not a general shell'
      );
    }
  } else {
    parts.push('tool capability details unavailable; do not assume shell access');
  }
  parts.push(
    type.allowModelOverride
      ? 'model required (exact enum id)'
      : 'model override not allowed (fixed or follows parent)'
  );
  return parts.join('; ');
}
