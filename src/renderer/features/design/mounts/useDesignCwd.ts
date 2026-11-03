import { useSessionsStore } from '@/stores/sessions';
import { sessionWorkspaceCwd } from '@/stores/sessions/workspaceCwd';
import { useSettingsStore } from '@/stores/settings';

export function useDesignCwd(id?: string): string | undefined {
  const projects = useSettingsStore((state) => state.projects);
  return useSessionsStore((state) => {
    const project = projects.find((item) => item.id === state.conversations[id ?? '']?.projectId);
    return id ? sessionWorkspaceCwd(project, id, state.conversations) : undefined;
  });
}
