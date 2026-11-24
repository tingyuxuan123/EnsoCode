import { type AccentColor, resolveAccentColor } from '@shared/accentColor';
import { CHAT_TYPOGRAPHY_PARTS, parseChatTypography } from '@shared/chatTypography';
import {
  CODE_SEARCH_DEFAULT_OFF_SETTINGS_VERSION,
  parseCodeSearchAccountKey,
} from '@shared/codeSearch';
import { resolveCompactStrategy } from '@shared/compactStrategy';
import { normalizeContextMenuOpen, normalizeFileOpenRules } from '@shared/fileOpening';
import { parseImageGenerationSettings } from '@shared/imageGeneration';
import { DEFAULT_LIGHT_PALETTE, parseLightPalette } from '@shared/lightPalette';
import { extractModelOverrides, referencedModelIds } from '@shared/modelDirectory';
import { STATUS_LINE_PRESETS, STATUS_LINE_SEGMENT_IDS } from '@shared/statusLine';
import { type EditMode, type ModelEntry, resolveEditMode } from '@shared/types';
import {
  addCodeSearchDefaultOff,
  addComputerDefaultOff,
  COMPUTER_DEFAULT_OFF_SETTINGS_VERSION,
  effectiveSubagentAllowedModes,
} from '@shared/types/builtinTools';
import { isSpeechModelId } from '@shared/types/speech';
import { parseWebSearchChain } from '@shared/webSearchChain';
import { DEFAULT_MONO_FONT_FAMILY, normalizeDesktopChatTypography } from '@/lib/desktopTypography';

/**
 * 持久化数据的版本迁移。
 *
 * 为什么用 zustand persist 的 `migrate` 而不是 `onRehydrateStorage`：
 * `migrate` 只在持久版本落后时跑一次，结果随下一次落盘写回磁盘，旧字段就此消失
 * （persist 紧随 migrate 的那次回写发生在水合闸门打开前，会被 storage.ts 丢弃；
 * 因此 migrate 必须幂等，落盘前每次启动都会重跑一遍）；
 * `onRehydrateStorage` 每次 rehydrate（含多窗口同步广播）都会执行，且不触发回写，
 * 等于把一次性的形状迁移变成永久的读侧补丁。
 */

/** 当前持久化数据版本；改数据形状时 +1 并在 `migrateSettings` 里加一段 */
export const SETTINGS_VERSION = 23;

export function mergeSettingsState<T extends { editMode: EditMode; accentColor: AccentColor }>(
  persisted: unknown,
  current: T
): T {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) return current;
  const source = stripLegacyMemorySettings(persisted as Record<string, unknown>);
  const { hashlineEditEnabled, bashInterceptEnabled, voiceModel, lcuEnabled, ...rest } = source;
  const editMode =
    'editMode' in source || 'hashlineEditEnabled' in source
      ? resolveEditMode(source.editMode, hashlineEditEnabled)
      : current.editMode;
  // 外部手改 settings.json 可能写进未知强调色，非法值落回默认
  const accentColor =
    'accentColor' in source ? resolveAccentColor(source.accentColor) : current.accentColor;
  const lightAppearance =
    'lightPalette' in source || 'lightPalette' in current
      ? { lightPalette: parseLightPalette(source.lightPalette) ?? DEFAULT_LIGHT_PALETTE }
      : {};
  // 已下架的识别模型（如 enso-asr）保留当前值，与 Main 的回落一致
  const voice = isSpeechModelId(voiceModel) ? { voiceModel } : {};
  const search =
    'webSearchChain' in source
      ? { webSearchChain: parseWebSearchChain(source.webSearchChain) }
      : {};
  const codeSearch =
    'codeSearchAccountKey' in source
      ? { codeSearchAccountKey: parseCodeSearchAccountKey(source.codeSearchAccountKey) }
      : {};
  void bashInterceptEnabled;
  void lcuEnabled; // Removed desktop preference; never merge it back from disk.
  const fileOpening =
    'fileOpenRules' in source || 'fileOpenRules' in current
      ? { fileOpenRules: normalizeFileOpenRules(source.fileOpenRules) }
      : {};
  const contextMenuOpening =
    'contextMenuOpen' in source || 'contextMenuOpen' in current
      ? { contextMenuOpen: normalizeContextMenuOpen(source.contextMenuOpen) }
      : {};
  const browserLinkOpening =
    'openLinksInBuiltinBrowser' in source || 'openLinksInBuiltinBrowser' in current
      ? { openLinksInBuiltinBrowser: source.openLinksInBuiltinBrowser !== false }
      : {};
  const design =
    'designEnabled' in source || 'designEnabled' in current
      ? { designEnabled: source.designEnabled !== false }
      : {};
  return {
    ...current,
    ...rest,
    ...voice,
    ...search,
    ...codeSearch,
    ...('imageGeneration' in source
      ? { imageGeneration: parseImageGenerationSettings(source.imageGeneration) }
      : {}),
    ...fileOpening,
    ...contextMenuOpening,
    ...browserLinkOpening,
    ...design,
    ...('pluginAutoUpdate' in source || 'pluginAutoUpdate' in current
      ? { pluginAutoUpdate: source.pluginAutoUpdate !== false }
      : {}),
    ...('pluginTheme' in source || 'pluginTheme' in current
      ? {
          pluginTheme:
            typeof source.pluginTheme === 'string' &&
            /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+\/[a-zA-Z0-9_-]+$/.test(source.pluginTheme)
              ? source.pluginTheme
              : '',
        }
      : {}),
    ...lightAppearance,
    ...('chatTypography' in source || 'chatTypography' in current
      ? { chatTypography: normalizeDesktopChatTypography(source.chatTypography) }
      : {}),
    editMode,
    accentColor,
  } as T;
}

/**
 * v0 → v1：`ModelProvider.oauthProviderId` 改名为 `oauthAccountKey`。
 * v1 → v2：新增必填 `defaultModel`，旧设置明确迁为 null，不把数组第一项冒充用户选择。
 * v2 → v3：新增标题总结：缺省关闭（不让升级用户静默多烧 token）、无独立模型。
 * v3 → v4：新增助手代审模型，缺省未选（该档禁用）。
 * v4 → v5：记住上次审批档；缺省未选，新会话仍走代审可用性默认。
 * v8 → v9：压缩策略改为互斥枚举；旧 `smartCompactEnabled` 布尔迁为 `compactStrategy`，缺字段不动。
 * v9 → v10：文件编辑模式改为互斥枚举；旧 hashline 开关迁移后删除。
 * v10 → v11：移除 Hashline 与 bash 拦截；hashline 回落 replace。
 * v11 → v12：默认编辑模式改为 apply_patch，已有 replace 一并切过去。
 * v12 → v13：subagent/coworker 合并；旧开关迁为 mode 掩码。
 * v15 → v16：OAuth 条目的 models 从登录时冻结的全量拷贝收缩为稀疏覆盖表
 * （只留禁用/别名/能力覆盖及选型引用行）；清单改由 Main 侧统一模型目录派生，
 * 老账号不再错过新版本静态表里的新模型（gemini-3.8-flash 事故的根修）。
 * 幂等：对已是稀疏表的条目重跑 extractModelOverrides 结果不变。
 * v16 → v17：全局与项目内置工具列表补 code_search 默认关，避免升级时静默云端发送代码。
 * v17 → v18：界面默认强调色由靛蓝改为晴空蓝；旧版落盘的 indigo 即旧默认值，随之换成 ocean。
 * v18 → v19：统计行旧默认精简为 Token / 缓存 / 上下文，保留自定义顺序、完整预设和全关。
 * v19 → v20：桌面采用 Kettu 默认字体与字号；只迁移完整旧默认，保留自定义排版与字体。
 * v22 → v23：移除内置 Wiki 设置（包括更早的项目记忆设置），保留本地模型空闲设置。不读写用户笔记文件。
 */
export function migrateSettings(persisted: unknown, version: number): unknown {
  if (version >= SETTINGS_VERSION) return persisted;
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) return persisted;

  let state = stripLegacyMemorySettings(persisted as Record<string, unknown>);
  if (version < 1 && Array.isArray(state.providers)) {
    state = {
      ...state,
      providers: state.providers.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
        const provider = entry as Record<string, unknown>;
        if (typeof provider.oauthProviderId !== 'string') return provider;
        const { oauthProviderId, ...rest } = provider;
        return { ...rest, oauthAccountKey: oauthProviderId };
      }),
    };
  }

  if (version < 2) {
    state = { ...state, defaultModel: null };
  }

  if (version < 3) {
    state = { ...state, titleSummaryEnabled: false, titleSummaryModel: null };
  }
  if (version < 4) {
    state = { ...state, approvalReviewer: null };
  }
  if (version < 5) {
    state = { ...state, lastApprovalMode: null };
  }
  if (
    version < 9 &&
    (typeof state.smartCompactEnabled === 'boolean' || 'compactStrategy' in state)
  ) {
    state = {
      ...state,
      compactStrategy: resolveCompactStrategy(state.compactStrategy, state.smartCompactEnabled),
    };
  }
  if (version < 10) {
    const { hashlineEditEnabled, ...rest } = state;
    state = {
      ...rest,
      editMode: resolveEditMode(state.editMode, hashlineEditEnabled),
    };
  }
  if (version < 11) {
    const { bashInterceptEnabled, ...rest } = state;
    state = {
      ...rest,
      editMode: resolveEditMode(state.editMode),
    };
    void bashInterceptEnabled;
  }
  if (version < 12) {
    state = { ...state, editMode: 'apply_patch' };
  }
  if (version < 13) {
    state = migrateAgentToolModes(state);
  }
  if (version < COMPUTER_DEFAULT_OFF_SETTINGS_VERSION) {
    state = addComputerDefaultOff(state);
  }
  if (version < 15 && Array.isArray(state.statusLineSegments)) {
    const segments = state.statusLineSegments;
    const oldDefault = [
      'model',
      'tokens',
      'cache',
      'context',
      'turns',
      'speed',
      'duration',
      'sessionTime',
    ];
    const oldFull = STATUS_LINE_SEGMENT_IDS.filter((id) => id !== 'requestBody');
    const matches = (preset: readonly string[]) =>
      segments.length === preset.length && preset.every((id, i) => segments[i] === id);
    if (matches(oldDefault))
      state = { ...state, statusLineSegments: [...STATUS_LINE_PRESETS.default] };
    else if (matches(oldFull))
      state = { ...state, statusLineSegments: [...STATUS_LINE_PRESETS.full] };
  }
  if (version < 16 && Array.isArray(state.providers)) {
    state = {
      ...state,
      providers: state.providers.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
        const provider = entry as Record<string, unknown>;
        if (typeof provider.oauthAccountKey !== 'string') return provider;
        if (!Array.isArray(provider.models)) return provider;
        return {
          ...provider,
          models: extractModelOverrides(
            provider.models as ModelEntry[],
            undefined,
            referencedModelIds(state, provider.id)
          ),
        };
      }),
    };
  }
  if (version < CODE_SEARCH_DEFAULT_OFF_SETTINGS_VERSION) {
    state = addCodeSearchDefaultOff(state);
  }
  if (version < 18 && state.accentColor === 'indigo') {
    state = { ...state, accentColor: 'ocean' };
  }
  if (version < 19 && Array.isArray(state.statusLineSegments)) {
    const segments = state.statusLineSegments;
    // 必须冻结旧序列，不能用会随版本变化的新默认作匹配。
    // 与旧默认完全同序的手动配置无法区分，随默认升级；其它自定义（含空数组）不动。
    const oldDefault = [
      'model',
      'tokens',
      'cache',
      'context',
      'requestBody',
      'turns',
      'speed',
      'duration',
      'sessionTime',
    ];
    if (segments.length === oldDefault.length && oldDefault.every((id, i) => segments[i] === id)) {
      state = { ...state, statusLineSegments: [...STATUS_LINE_PRESETS.default] };
    }
  }
  if (version < 20) {
    if (state.terminalFontFamily === 'ui-monospace, SF Mono, Menlo, Monaco, Consolas, monospace') {
      state = { ...state, terminalFontFamily: DEFAULT_MONO_FONT_FAMILY };
    }
    const typography = parseChatTypography(state.chatTypography);
    // 冻结 v19 旧默认；与旧默认完全相同的显式配置无法区分，随默认升级。
    // 只要改过任意一项，就保留整套配置，不逐项猜测用户意图。
    const oldSizes = { body: 15, headings: 18, table: 15, codeBlock: 11, inlineCode: 11 };
    if (
      typography &&
      CHAT_TYPOGRAPHY_PARTS.every(
        (part) =>
          typography[part].fontSize === oldSizes[part] &&
          typography[part].fontWeight === (part === 'headings' ? 600 : 400)
      )
    ) {
      state = { ...state, chatTypography: normalizeDesktopChatTypography(undefined) };
    }
  }
  return state;
}

const LEGACY_MEMORY_SETTINGS = [
  'localMemoryEnabled',
  'memoryModel',
  'memoryConcurrency',
  'memoryEmbeddingModel',
  'memoryEmbeddingAutoDownload',
  'memoryEmbeddingRemoteProviderId',
  'memoryKgEnabled',
  'memoryDistillEnabled',
  'memoryDistillModel',
  'memoryChatModel',
  'memoryLanguage',
] as const;

function stripLegacyMemorySettings(state: Record<string, unknown>): Record<string, unknown> {
  const migrated = { ...state };
  for (const key of LEGACY_MEMORY_SETTINGS) delete migrated[key];
  const stripTool = (entry: Record<string, unknown>): Record<string, unknown> => {
    const disabled = entry.disabledBuiltinTools;
    return Array.isArray(disabled) && disabled.includes('memory')
      ? { ...entry, disabledBuiltinTools: disabled.filter((id) => id !== 'memory') }
      : entry;
  };
  if (Array.isArray(migrated.projects)) {
    migrated.projects = migrated.projects.map((project) =>
      project && typeof project === 'object' && !Array.isArray(project)
        ? stripTool(project as Record<string, unknown>)
        : project
    );
  }
  return stripTool(migrated);
}

function migrateAgentToolModes(state: Record<string, unknown>): Record<string, unknown> {
  const migrateEntry = (entry: Record<string, unknown>): Record<string, unknown> => {
    if (!Array.isArray(entry.disabledBuiltinTools)) return entry;
    const legacy = entry.disabledBuiltinTools.filter((id): id is string => typeof id === 'string');
    const modes = effectiveSubagentAllowedModes(entry.subagentAllowedModes, legacy);
    const disabled = legacy.filter((id) => id !== 'coworker' && id !== 'subagent');
    if (modes.length === 0) disabled.push('subagent');
    return {
      ...entry,
      disabledBuiltinTools: [...new Set(disabled)],
      subagentAllowedModes: modes,
    };
  };
  const migrated = migrateEntry(state);
  if (!Array.isArray(migrated.projects)) return migrated;
  return {
    ...migrated,
    projects: migrated.projects.map((project) =>
      project && typeof project === 'object' && !Array.isArray(project)
        ? migrateEntry(project as Record<string, unknown>)
        : project
    ),
  };
}
