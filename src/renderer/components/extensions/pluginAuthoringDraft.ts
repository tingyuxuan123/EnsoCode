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
  const target = draft.hostVersion ?? 'unknown';
  const placement =
    draft.template === 'workspace'
      ? 'activitybar'
      : draft.template === 'sidebar'
        ? 'sidebar'
        : (draft.template ?? 'auto');
  return locale === 'zh'
    ? `请在本会话工作区的 ${directory} 中完成一个可用的 CodeKiln 原生插件。保留 enso-plugin.json 的永久 ID ${id}；当前制作宿主 ${target}，入口 ${placement}。\n先读插件内 HOST-CAPABILITIES.md 和 enso-plugin.d.ts：它们来自实际运行宿主，不要用仓库新接口猜测旧安装版能力或凭空降低 engines。缺少能力要先说明，不得擅自修改宿主源码、安装依赖或删减用户需求。\n沿用原生主题变量和字体、控件与错误/空状态；管理工具默认 activitybar 工作区，临时辅助才用 sidebar，命令和模型工具不强造页面。数据仅放 enso.dataDir，校验旧文件且坏文件不覆盖；升级保持 ID，递增插件版本，说明数据迁移风险，禁止删用户数据。\n先写能失败的行为测试，再实现；工具 schema 完整声明类型并考虑可选空值。通过制作页检查/授权试用副本，不操作正式数据。完成时分别报告静态、自动化测试、运行、业务和双厂商模型工具证据；未做的写“尚未验证”，每项绑定当前 sourceHash，不以静态通过充当交付成功。\n不安装、不启用、不发布插件或宿主；发送模型请求或收费测试必须明确授权。只改本插件目录。\n\n我的需求：\n${request.trim()}`
    : `Build a complete native CodeKiln plugin in ${directory}. Keep permanent ID ${id}; actual authoring host ${target}, entry ${placement}. First read HOST-CAPABILITIES.md and enso-plugin.d.ts supplied by this running host, not unreleased repository APIs. Do not invent minimum compatibility, edit host source, install dependencies, or silently reduce scope. Use native theme/typography/state components; management pages use activitybar, helpers sidebar, headless commands/tools need no page. Store validated data only in enso.dataDir; preserve corrupt originals, stable ID and data on updates, bump plugin version and explain migrations. Write failing behavior tests first. Tool schemas must declare complete types and handle optional placeholders. Distinguish static, automated tests, runtime, business and two-vendor model evidence, all bound to sourceHash; untested means unverified. Do not install, enable, or publish the plugin or host. Preview and model calls require explicit consent, with separate trial data. Change this plugin directory only.\n\nMy request:\n${request.trim()}`;
}
