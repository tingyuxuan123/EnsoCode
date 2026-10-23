import type { AgentRunProgress } from '@shared/types/agent';
import { useEffect } from 'react';
import { selectSubagentDirectory } from '@/lib/subagentTargets';
import { useSessionsStore } from '@/stores/sessions';
import { useSubagentRunsStore } from '@/stores/subagentRuns';

const EMPTY_RUNS: AgentRunProgress[] = [];

export function useSubagentDirectory(parentId: string) {
  const runs = useSubagentRunsStore((state) => state.byConversation[parentId] ?? EMPTY_RUNS);
  const entries = useSessionsStore((state) =>
    selectSubagentDirectory(state.conversations, parentId, runs)
  );
  useEffect(() => {
    const read = window.electronAPI.agent.subagentProgress;
    if (!read) return;
    let active = true;
    const baseline = useSubagentRunsStore.getState().revisionByConversation[parentId] ?? 0;
    void read(parentId).then(
      (next) => {
        // initial 查询可能晚于实时推送，不覆盖更近的 Main 状态。
        if (
          active &&
          (useSubagentRunsStore.getState().revisionByConversation[parentId] ?? 0) === baseline
        ) {
          useSubagentRunsStore.getState().replace(parentId, next);
        }
      },
      () => {}
    );
    return () => {
      active = false;
    };
  }, [parentId]);
  return entries;
}
