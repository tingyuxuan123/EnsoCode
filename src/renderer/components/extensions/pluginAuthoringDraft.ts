import type { PluginAuthoringDraft } from '@shared/extensionPlugins/types';
import type { Locale } from '@shared/i18n';
import { handleDraftRequest } from '@/plugins/draftBridge';

type DraftRevision = { generation: string; rev: string };

export function readEmptyAuthoringDraft(sessionId: string): DraftRevision | null {
  const result = handleDraftRequest({ sessionId, op: 'readDraft', payload: {} });
  if (!result.ok) return null;
  const value = result.value;
  if (
    !value ||
    typeof value !== 'object' ||
    !('text' in value) ||
    value.text !== '' ||
    !('hasReferences' in value) ||
    value.hasReferences !== false ||
    !('generation' in value) ||
    typeof value.generation !== 'string' ||
    !('rev' in value) ||
    typeof value.rev !== 'string'
  )
    return null;
  return { generation: value.generation, rev: value.rev };
}

export function fillPluginAuthoringDraft(
  sessionId: string,
  expect: DraftRevision | null,
  text: string
): boolean {
  return (
    expect !== null &&
    handleDraftRequest({ sessionId, op: 'replaceDraft', payload: { expect, text } }).ok
  );
}

export function buildPluginAuthoringPrompt(
  draft: PluginAuthoringDraft,
  request: string,
  locale: Locale
): string {
  const directory = `\`${draft.directory}/\``;
  const id = `\`${draft.id}\``;
  return locale === 'zh'
    ? `请在本会话工作区的 ${directory} 中实现一个 CodeKiln 原生插件。保留 enso-plugin.json 的插件 ID ${id}，根据需求修改显示名和实现，只声明必要权限。不安装、不启用、不发布插件。完成后说明改动、所需权限和手动试用步骤。\n\n我的需求：\n${request.trim()}`
    : `Build a native CodeKiln plugin in ${directory} in this session's workspace. Keep the plugin ID ${id} in enso-plugin.json. Update the display name and implementation to fit the request, and declare only necessary permissions. Do not install, enable, or publish the plugin. Summarize the implementation, permissions, and manual test steps.\n\nMy request:\n${request.trim()}`;
}
