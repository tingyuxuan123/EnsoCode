export interface PluginNoticeView {
  type: 'warning' | 'success';
  titleKey: string;
  params: Record<string, string>;
  actionKey: string;
  pluginId: string;
}
export function describePluginNotice(raw: unknown): PluginNoticeView | null {
  if (!raw || typeof raw !== 'object') return null;
  const notice = raw as Record<string, unknown>;
  if (
    typeof notice.pluginId !== 'string' ||
    !/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/.test(notice.pluginId) ||
    typeof notice.name !== 'string' ||
    !notice.name
  )
    return null;
  const { pluginId, name } = notice;
  if (notice.kind === 'inject-denied')
    return {
      type: 'warning',
      titleKey: '{{name}} tried to message another session and was blocked',
      params: { name },
      actionKey: 'Review permissions',
      pluginId,
    };
  if (typeof notice.version !== 'string' || !notice.version) return null;
  const version = notice.version;
  if (notice.kind === 'update-needs-approval')
    return {
      type: 'warning',
      titleKey: '{{name}} {{version}} needs new permissions',
      params: { name, version },
      actionKey: 'Review permissions',
      pluginId,
    };
  if (notice.kind === 'auto-updated')
    return {
      type: 'success',
      titleKey: '{{name}} updated to {{version}}',
      params: { name, version },
      actionKey: 'View',
      pluginId,
    };
  return null;
}
