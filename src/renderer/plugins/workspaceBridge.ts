import {
  type PluginWorkspaceContext,
  type PluginWorkspaceProjects,
  parsePluginWorkspaceContext,
  workspaceContextKey,
} from '@shared/extensionPlugins/workspace';

/** The selection belongs to this frame, not the active chat or other plugin instances. */
export function createWorkspaceBridge(deps: {
  list(): Promise<PluginWorkspaceProjects>;
  call(
    method: string,
    args: unknown,
    gesture: boolean,
    workspace: PluginWorkspaceContext | null | undefined
  ): Promise<unknown>;
}) {
  let selected: PluginWorkspaceContext | null | undefined;
  let selectionVersion = 0;
  return async (method: string, args: unknown, gesture: boolean): Promise<unknown> => {
    if (method === '__host.projects.list') {
      const result = await deps.list();
      return { ...result, current: selected === undefined ? result.current : selected };
    }
    if (method === '__host.projects.select') {
      if (!gesture) throw new Error('只能由用户操作切换项目');
      const context = parsePluginWorkspaceContext(args);
      if (context === undefined) throw new Error('项目标识无效');
      const version = ++selectionVersion;
      const result = await deps.list();
      if (version !== selectionVersion) throw new Error('项目选择已变化');
      if (
        context !== null &&
        !result.projects.some(
          (item) => workspaceContextKey(item.context) === workspaceContextKey(context)
        )
      )
        throw new Error('项目已移除或不是有效本地项目');
      selected = context;
      return { current: selected };
    }
    // Capture before awaiting: switching projects never retargets an already pending edit.
    return deps.call(method, args, gesture, selected);
  };
}
