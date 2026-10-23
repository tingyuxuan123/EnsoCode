import { addSidePanelSubagent } from '@/lib/sidePanelDock';
import { resolveSubagentTarget } from '@/lib/subagentTargets';
import { useSessionsStore } from '@/stores/sessions';

/** 只订阅可打开的身份集合，流式正文变化不重渲染父工具摘要。点击时再次校验归属。 */
export function useSubagentProcess(
  parentId: string | null | undefined,
  agentIds: readonly string[]
) {
  const available =
    useSessionsStore((state) =>
      parentId
        ? agentIds
            .filter((id) => resolveSubagentTarget(state.conversations, parentId, id))
            .join('\0')
        : ''
    ) ?? '';
  const openableAgentIds = new Set(available ? available.split('\0') : []);
  return {
    openableAgentIds,
    openAgent: (agentId: string) => {
      if (!parentId) return;
      const target = resolveSubagentTarget(
        useSessionsStore.getState().conversations,
        parentId,
        agentId
      );
      if (target) addSidePanelSubagent(target);
    },
  };
}
