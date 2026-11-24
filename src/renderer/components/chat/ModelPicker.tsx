import { pickModelCapabilityOverrides, resolveCustomModelView } from '@shared/modelCatalog';
import { clampProjectThinkingLevel, visibleThinkingLevels } from '@shared/modelThinking';
import { CUSTOM_VENDOR_ID, groupProviders } from '@shared/providerGroups';
import type {
  ModelCapabilityOverrides,
  ModelEntry,
  ModelMeta,
  ModelProvider,
  OauthProviderInfo,
} from '@shared/types';
import { THINKING_LEVELS, type ThinkingLevel } from '@shared/types/agent';
import {
  findVirtualModel,
  VIRTUAL_PROVIDER_ID,
  type VirtualModelEntry,
} from '@shared/virtualModels';
import {
  BadgeCheck,
  Brain,
  Check,
  ChevronDown,
  KeyRound,
  Search,
  Shuffle,
  Sparkle,
} from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { providerDisplayName } from '@/components/settings/chatgptPool';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu';
import { Switch } from '@/components/ui/switch';
import { prefetchAccountUsage, useCachedAccountUsage } from '@/hooks/useAccountUsage';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useModelMeta } from '@/stores/modelMeta';
import { formatTokens } from '@/stores/sessions/stats';
import { pickRailKey, providerRailKey, showsPickerRail, VIRTUAL_RAIL_KEY } from './modelPickerRail';
import { type SessionUsageAccount, usageAccountKeyForProvider } from './sessionUsageAccount';
import { ThinkingLevelSlider } from './ThinkingLevelSlider';
import { showsThinkingSlider } from './thinkingLevelTrack';

export const OPEN_CHAT_MODEL_PICKER_EVENT = 'enso:open-chat-model-picker';

/** 表单/设置里的整行下拉触发器 */
export const MODEL_PICKER_FORM_TRIGGER_CLASS =
  'h-8 w-full max-w-none border border-input bg-background px-2.5 text-sm text-foreground hover:bg-accent';

export function requestOpenChatModelPicker() {
  window.dispatchEvent(new Event(OPEN_CHAT_MODEL_PICKER_EVENT));
}

/** catalog 未声明支持集时只改展示，不回写。 */
export function persistClampedThinkingLevel(
  level: ThinkingLevel,
  declared: ThinkingLevel[] | undefined
): ThinkingLevel | undefined {
  const next = clampProjectThinkingLevel(level, declared);
  return next === level ? undefined : next;
}

/** 展示复用运行时能力分层；乐观默认可以预览，但不能当成已知支持集回写。 */
export function resolvePickerCapabilities(
  provider: ModelProvider | undefined,
  row: ModelEntry | undefined,
  meta: ModelMeta | undefined,
  overrides?: ModelCapabilityOverrides
): {
  reasoning: boolean | undefined;
  thinkingLevels: ThinkingLevel[] | undefined;
  declaredThinkingLevels: ThinkingLevel[] | undefined;
} {
  const knownMeta = meta?.source === 'unknown' ? undefined : meta;
  if (provider?.oauthAccountKey) {
    return {
      reasoning: knownMeta?.reasoning,
      thinkingLevels: knownMeta?.thinkingLevels,
      declaredThinkingLevels: knownMeta?.thinkingLevels,
    };
  }
  const view = resolveCustomModelView({ ...row, ...pickModelCapabilityOverrides(overrides) }, meta);
  // 子模型的深度是可编辑覆盖，不是不可突破的模型能力上限；选低档不能删掉更高档入口。
  if (overrides !== undefined) {
    return {
      reasoning: view.reasoning,
      thinkingLevels: [...THINKING_LEVELS],
      declaredThinkingLevels: undefined,
    };
  }
  return {
    reasoning: view.reasoning,
    thinkingLevels: view.thinkingLevels,
    declaredThinkingLevels:
      view.source.thinkingLevel === 'override' || knownMeta?.thinkingLevels !== undefined
        ? view.thinkingLevels
        : undefined,
  };
}

/** 档位显示文案的 t() key（不是已翻译文本）；沿用既有英文短词，字典里已配好中文译文 */
const LEVEL_LABEL_KEYS: Record<ThinkingLevel, string> = {
  minimal: 'Min',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'Extra',
  max: 'Max',
};

/**
 * 账号身份数据来自厂商侧（外部输入），渲染前在解析边界做防御性兜底：剔除控制字符
 * （避免破坏渲染/布局），超长截断（避免撑破固定宽度的菜单，配合渲染侧的 max-w+truncate
 * 双重兜底，不是互相替代）。
 */
function sanitizeAccountText(value: string, maxLength: number): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }
  out = out.trim();
  return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
}

/**
 * base-ui Menu 在弹层打开时会把方向键/回车/Esc 当菜单导航、把可打印字符当 typeahead 处理——
 * 后者会在 keydown 阶段抢先 `preventDefault()`，导致弹层内的搜索框完全打不进字。修法是只拦截
 * "会被当 typeahead 吞掉"的按键，方向键/回车/Esc/Tab 仍放行冒泡给 Menu 的根级键盘处理器——
 * 这样搜索框能正常打字，同时不破坏方向键选中、回车确认、Esc 关闭。
 */
const MENU_NAV_KEYS: Record<string, true> = {
  ArrowUp: true,
  ArrowDown: true,
  ArrowLeft: true,
  ArrowRight: true,
  Enter: true,
  Escape: true,
  Tab: true,
};

function stopTypeaheadOnly(e: KeyboardEvent<HTMLInputElement>): void {
  if (!MENU_NAV_KEYS[e.key]) e.stopPropagation();
}

interface ModelPickerProps {
  providers: ModelProvider[];
  /** 传入时在条目轨里多一个虚拟模型入口（仅会话主模型与默认模型的选择场景） */
  virtualModels?: readonly VirtualModelEntry[];
  /** 选中虚拟模型时附在触发器上的实际路由模型 */
  routedModelLabel?: string;
  /** 当前会话真实请求的订阅账号；设置场景不传，池额度保持隐藏。
   *
   * Subscription account of the current session's actual request; settings omit it and keep pool usage hidden. */
  activeAccount?: SessionUsageAccount;
  providerId: string;
  modelId: string;
  reasoningEnabled: boolean;
  thinkingLevel: ThinkingLevel;
  /** 子模型三态；不传时保留主会话的二态开关。 */
  reasoningMode?: 'follow' | 'on' | 'off';
  onReasoningModeChange?: (mode: 'follow' | 'on' | 'off', level: ThinkingLevel) => void;
  /** 仅当前选中自定义模型的条目覆盖；OAuth 能力仍以 catalog 为准。 */
  modelCapabilityOverrides?: ModelCapabilityOverrides;
  /** 仅需 provider/model 级联的场景可隐藏推理栏。 */
  showReasoningControls?: boolean;
  /** 仅会话工具行：响应全局「切换模型」快捷键并聚焦搜索框 */
  listenHotkey?: boolean;
  onSelect: (providerId: string, modelId: string) => void;
  onReasoningChange: (enabled: boolean) => void;
  onThinkingChange: (level: ThinkingLevel) => void;
  /** 模型能力约束触发的自动归一化；缺省复用用户变更回调。 */
  onReasoningNormalize?: (enabled: boolean) => void;
  onThinkingNormalize?: (level: ThinkingLevel) => void;
  /** 弹层层级；对话框内须高于模态层 */
  zIndex?: number;
  /** 未选模型时触发器文案 */
  emptyLabel?: string;
  /** 覆盖触发器文案；设置页「跟随上次选择」等不显示具体模型名 */
  triggerLabel?: string;
  triggerClassName?: string;
  side?: 'top' | 'bottom';
}

/**
 * 子序列模糊匹配打分：query 的字符必须按顺序（不要求连续）出现在 target 里，
 * 全部命中才算命中，否则返回 null（不显示）。打分口径（越高越靠前排）：
 * - 每个命中字符 +1；
 * - 与上一个命中字符紧邻（连续片段）额外 +3——让连续子串盖过分散命中；
 * - 命中位置在词首或紧跟 `-_. /` 分隔符之后 +2——贴近人类感知的“单词边界”；
 * - 首个命中位置越靠后扣分越多（扣分 = 首位置 * 0.1）——越靠前的匹配更符合直觉。
 */
function fuzzyMatchScore(query: string, target: string): number | null {
  if (!query) return 0;
  if (!target) return null;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastMatch = -1;
  let firstMatch = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    if (firstMatch === -1) firstMatch = ti;
    score += 1;
    if (lastMatch === ti - 1) score += 3;
    if (ti === 0 || /[-_. /]/.test(t[ti - 1])) score += 2;
    lastMatch = ti;
    qi++;
  }
  if (qi < q.length) return null;
  return score - firstMatch * 0.1;
}

/** 多字段取最高（加权）分；模型 id/label 权重高于条目/厂商名，避免"名字撞了但模型不对"排到前面 */
function bestFieldScore(
  query: string,
  fields: readonly (readonly [text: string, weight: number])[]
): number | null {
  let best: number | null = null;
  for (const [text, weight] of fields) {
    if (!text) continue;
    const score = fuzzyMatchScore(query, text);
    if (score === null) continue;
    const weighted = score * weight;
    if (best === null || weighted > best) best = weighted;
  }
  return best;
}

/** 挂载即向 onData 上报该 provider 的模型元数据；用于在弹层里为多个 provider 并发订阅 useModelMeta */
function ModelMetaBridge({
  provider,
  onData,
}: {
  provider: ModelProvider;
  onData: (providerId: string, meta: Record<string, ModelMeta>) => void;
}) {
  const meta = useModelMeta(provider);
  useEffect(() => {
    onData(provider.id, meta);
  }, [provider.id, meta, onData]);
  return null;
}

/**
 * 一行模型的内容：名称 + 模型 id（小字）+ （可选）所属条目标签 + 上下文窗口 + 选中标记。
 *
 * 模型 id 恒定显示而不是「重名时才显示」：一个网关背后挂多个上游时，
 * `auto/gpt-6.2-sol` 和 `gonshi/gpt-6.1-sol` 的显示名可能一模一样，而 id 是唯一稳定的身份；
 * 每行都带 id 也让行高恒定，切换条目时列表不会忽高忽低。
 *
 * 窗口缺失时整段不渲染（不留占位符，有值才显示；`catalog-fallback` 来源仍标「估算」——
 * 那是有值，只是不够权威，⛔ 不编造数字）。
 *
 * ⚠️ 选中标记的槽位恒定占宽（`selected` 为 false 时槽位仍渲染，只是内部空着），不能写成
 * `selected && <Check/>` 那种整个节点条件渲染——`MenuItem` 是 flex 行，名称那一列用的是
 * `flex-1`（会自动吃掉行内剩余空间），选中标记要是时有时无，行内其余 shrink-0 兄弟元素的
 * 总宽度就会跟着变，挤压/放宽名称列，导致上下文窗口值的横坐标随选中状态左右跳动。
 */
function ModelRowContent({
  model,
  meta,
  entryTag,
  selected,
}: {
  model: ModelEntry;
  meta: ModelMeta | undefined;
  entryTag?: string;
  selected: boolean;
}) {
  const { t } = useI18n();
  // 行覆盖（ModelEntry.contextWindow，含 Fetch Models 落地的元数据）优先于 catalog；
  // 与设置页 ProviderModelRow 同一套分层，不另写一份判定。
  const view = resolveCustomModelView(model, meta);
  const windowTokens = view.contextWindow;
  const estimated =
    windowTokens !== undefined &&
    view.source.contextWindow === 'catalog' &&
    meta?.source === 'catalog-fallback';
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col items-start justify-center">
        <span className="max-w-full truncate">{model.label ?? model.id}</span>
        <span
          data-model-row-id={model.id}
          className="max-w-full truncate font-mono text-[calc(10.5rem/14)] leading-[calc(14rem/14)] text-muted-foreground/65"
        >
          {model.id}
        </span>
      </span>
      {entryTag && (
        <span className="max-w-24 shrink-0 truncate text-[calc(11rem/14)] text-muted-foreground/60">
          {entryTag}
        </span>
      )}
      {windowTokens !== undefined && (
        <span
          className="shrink-0 text-[calc(10.5rem/14)] tabular-nums text-muted-foreground/70"
          title={estimated ? t('Estimated context window (catalog fallback)') : t('Context window')}
        >
          {formatTokens(windowTokens)}
          {estimated ? '*' : ''}
        </span>
      )}
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {selected && <Check className="h-3.5 w-3.5 text-brand" />}
      </span>
    </>
  );
}

/**
 * 一个供应商「条目」（订阅账号或 API-key 配置）在列表顶部的展示名。
 * 读法与设置页 `ProvidersSettings.tsx` 同款口径对齐（同一套账号信息，不让用户学两遍）：
 * 订阅条目主位放账号身份——邮箱优先，没有邮箱退回账号 key，都没有才退回 provider.name
 * （厂商名已经是列表顶部的分组名，不重复放主位）；`plan` 单独返回供调用方渲染成徽标。
 * API-key 条目主位仍是 `provider.name`（用户自定义命名本身就是区分信息），host 当副标题。
 */
function entryLabelOf(
  provider: ModelProvider,
  oauthAccountsByKey: Record<string, { email?: string; plan?: string }>,
  t: (key: string) => string
): { primary: string; secondary?: string; plan?: string; isSubscription: boolean } {
  if (provider.oauthAccountPool) {
    return { primary: providerDisplayName(provider, t), isSubscription: true };
  }
  if (provider.oauthAccountKey) {
    const account = oauthAccountsByKey[provider.oauthAccountKey];
    const email = account?.email ? sanitizeAccountText(account.email, 64) : undefined;
    const plan = account?.plan ? sanitizeAccountText(account.plan, 16) : undefined;
    return {
      primary: email || provider.oauthAccountKey || provider.name,
      plan,
      isSubscription: true,
    };
  }
  let host: string | undefined;
  try {
    host = new URL(provider.baseUrl).hostname;
  } catch {
    host = undefined;
  }
  return { primary: provider.name, secondary: host, isSubscription: false };
}

/** 条目轨上的一个入口：订阅账号 / API-key 网关 / 虚拟模型。图标位放条目首字母，重名靠 title 区分。 */
interface RailEntry {
  key: string;
  providerId?: string;
  title: string;
  initial: string;
  isVirtual: boolean;
}

/** 没有图标时用条目名首字符做头像，和 open-vetta 的第一栏同一种读法。 */
function railInitial(label: string): string {
  return Array.from(label.trim())[0]?.toUpperCase() ?? '?';
}

/**
 * 条目轨的一项。用 MenuItem 而不是裸 button：菜单的方向键导航只认 MenuItem，
 * 裸 button 会被排除在 roving focus 之外，键盘用户就切不了条目。
 * `closeOnClick={false}`——切条目只换右两栏的内容，不该顺手关掉整个浮层。
 */
function RailItem({
  entry,
  active,
  onSelect,
}: {
  entry: RailEntry;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <MenuItem
      closeOnClick={false}
      data-model-picker-rail={entry.key}
      aria-current={active ? 'true' : undefined}
      title={entry.title}
      onClick={onSelect}
      className={cn(
        'size-9 min-h-0 shrink-0 justify-center gap-0 rounded-[7px] p-0 text-[calc(11.5rem/14)] font-semibold',
        active
          ? 'bg-accent text-accent-foreground data-highlighted:bg-accent'
          : 'text-muted-foreground'
      )}
    >
      {entry.isVirtual ? (
        <Shuffle className="size-4" />
      ) : (
        <span className="leading-none">{entry.initial}</span>
      )}
    </MenuItem>
  );
}

/** 当前条目是订阅账号时，列表顶部的额度块：只在该条目被展开时拉取（60s 共享缓存）；无数据/出错静默隐藏 */
function EntryUsage({ accountKey }: { accountKey: string }) {
  const { t } = useI18n();
  const info = useCachedAccountUsage(accountKey);
  if (!info || info.error || info.windows.length === 0) return null;
  return (
    <div className="shrink-0 space-y-1 border-b border-border/60 px-2 py-1.5">
      {info.windows.map((windowInfo) => (
        <div
          key={windowInfo.label}
          className="flex min-w-0 items-center gap-2 text-[calc(11rem/14)]"
        >
          <span className="w-8 shrink-0 truncate text-muted-foreground" title={windowInfo.label}>
            {windowInfo.label}
          </span>
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${Math.max(0, Math.min(100, windowInfo.usedPercent))}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
            {Math.round(windowInfo.usedPercent)}%
          </span>
          {windowInfo.resetsAt !== undefined && (
            <span className="min-w-0 truncate text-muted-foreground/60">
              {t('Resets {{time}}', {
                time: new Date(windowInfo.resetsAt).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

interface SearchHit {
  provider: ModelProvider;
  model: ModelEntry;
  entryTag: string;
  score: number;
}

/**
 * 模型选择浮层：三栏——条目轨（账号 / 网关 / 虚拟模型）｜所选条目的模型列表（顶部跨条目搜索）
 * ｜所选模型的推理档位。结构对齐 open-vetta 的选模型面板：来源不占一次点击，模型不再藏在二级菜单；
 * 推理控制件仍用本应用自己的开关 + 档位滑杆，只是从列表底部搬到右栏，和它真正作用的模型对齐。
 *
 * 关键词非空时中间栏改为跨条目的扁平模糊搜索列表。
 */
export function ModelPicker({
  providers,
  virtualModels,
  routedModelLabel,
  activeAccount,
  providerId,
  modelId,
  reasoningEnabled,
  thinkingLevel,
  modelCapabilityOverrides,
  reasoningMode,
  onReasoningModeChange,
  showReasoningControls = true,
  listenHotkey = false,
  onSelect,
  onReasoningChange,
  onThinkingChange,
  onReasoningNormalize,
  onThinkingNormalize,
  zIndex,
  emptyLabel,
  triggerLabel: triggerLabelProp,
  triggerClassName,
  side = 'top',
}: ModelPickerProps) {
  const { t } = useI18n();
  const normalizeReasoning = onReasoningNormalize ?? onReasoningChange;
  const normalizeThinking = onThinkingNormalize ?? onThinkingChange;
  const reasoningInherited = reasoningMode === 'follow';
  const thinkingInherited = reasoningMode !== undefined && !modelCapabilityOverrides?.thinkingLevel;
  const [open, setOpen] = useState(false);
  /** 浮层要贴整张输入条，而不是贴胶囊：贴胶囊会盖住输入区上半部，贴输入条则整块浮在它上面 */
  const [composerAnchor, setComposerAnchor] = useState<HTMLElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [keyword, setKeyword] = useState('');
  const [activeRailKey, setActiveRailKey] = useState<string | undefined>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingSearchFocusRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  const [oauthInfos, setOauthInfos] = useState<OauthProviderInfo[]>([]);
  const [metaByProvider, setMetaByProvider] = useState<Record<string, Record<string, ModelMeta>>>(
    {}
  );

  const selectableVirtualModels = useMemo(
    () =>
      (virtualModels ?? []).filter(
        (entry) =>
          entry.enabled &&
          providers.some(
            (p) =>
              p.id === entry.primary.providerId &&
              p.models.some((m) => m.id === entry.primary.modelId && m.enabled !== false)
          )
      ),
    [virtualModels, providers]
  );
  const currentVirtual = findVirtualModel(virtualModels, { providerId, modelId });
  // 虚拟模型的推理能力按主模型展示与钳位
  const capabilityRef = currentVirtual?.primary ?? { providerId, modelId };
  const currentProvider = useMemo(
    () => providers.find((p) => p.id === capabilityRef.providerId),
    [providers, capabilityRef.providerId]
  );
  const current = currentProvider?.models.find((m) => m.id === capabilityRef.modelId);
  const formTrigger = Boolean(triggerClassName);
  const modelName = currentVirtual
    ? routedModelLabel
      ? `${currentVirtual.name} · ${routedModelLabel}`
      : currentVirtual.name
    : current?.label || current?.id || modelId;
  const hasSelection = Boolean(modelName);
  const triggerLabel =
    triggerLabelProp ??
    (hasSelection
      ? (formTrigger || currentProvider?.oauthAccountPool) &&
        currentProvider?.name &&
        !currentVirtual
        ? `${providerDisplayName(currentProvider, t)} / ${modelName}`
        : modelName
      : emptyLabel || t('Select model'));

  const groups = useMemo(() => groupProviders(providers, oauthInfos), [providers, oauthInfos]);

  // 弹层打开时才刷新订阅账号展示名（登录/登出可能已发生），关闭时不必轮询。
  // 同时预热订阅账号的额度：额度探测要打厂商端点（可能秒级延迟），
  // 若等切到该条目才拉，第一次展开往往还没返回；预热后命中 60s 共享缓存。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.electronAPI.providers.listOauth().then((infos) => {
      if (!cancelled) setOauthInfos(infos);
    });
    for (const provider of providers) {
      const accountKey = usageAccountKeyForProvider(provider, activeAccount);
      if (accountKey) prefetchAccountUsage(accountKey);
    }
    return () => {
      cancelled = true;
    };
  }, [open, providers, activeAccount]);

  // 打开时只清搜索词，并把条目轨回到「当前模型所属条目」——上次浏览的条目不该成为这次的开场。
  // 搜索框 tabIndex=-1，避免根菜单 initialFocus 落到第一个可聚焦的 input 上；
  // 级联退场后 Esc 一律关整棵，所以没有「先退搜索再关菜单」这一层了。
  useEffect(() => {
    if (!open) return;
    setKeyword('');
    const trigger = wrapperRef.current?.querySelector<HTMLElement>('[data-model-picker="trigger"]');
    // 只有输入条里的胶囊才换锚点；设置页/表单里的选择器依旧贴自己的触发器
    setComposerAnchor(trigger?.closest<HTMLElement>('[data-slot="composer"]') ?? null);
    const focusSearch = pendingSearchFocusRef.current;
    pendingSearchFocusRef.current = false;
    if (!focusSearch) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => searchInputRef.current?.focus());
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open]);

  useEffect(() => {
    if (!listenHotkey) return;
    const onHotkey = () => {
      if (openRef.current) {
        searchInputRef.current?.focus();
        return;
      }
      pendingSearchFocusRef.current = true;
      setOpen(true);
    };
    window.addEventListener(OPEN_CHAT_MODEL_PICKER_EVENT, onHotkey);
    return () => window.removeEventListener(OPEN_CHAT_MODEL_PICKER_EVENT, onHotkey);
  }, [listenHotkey]);

  const oauthAccountsByKey = useMemo(() => {
    const table: Record<string, { email?: string; plan?: string }> = {};
    for (const info of oauthInfos) {
      for (const account of info.accounts) table[account.key] = account;
    }
    return table;
  }, [oauthInfos]);

  // 每个 provider 条目对应的厂商名 + 条目展示名，供列表顶部标题与搜索命中行的消歧标签共用
  const entryInfoByProviderId = useMemo(() => {
    const table: Record<
      string,
      {
        vendorLabel: string;
        primary: string;
        secondary?: string;
        plan?: string;
        isSubscription: boolean;
      }
    > = {};
    for (const group of groups) {
      const vendorLabel = group.vendorId === CUSTOM_VENDOR_ID ? t('Custom') : group.label;
      for (const provider of group.providers) {
        const { primary, secondary, plan, isSubscription } = entryLabelOf(
          provider,
          oauthAccountsByKey,
          t
        );
        table[provider.id] = { vendorLabel, primary, secondary, plan, isSubscription };
      }
    }
    return table;
  }, [groups, oauthAccountsByKey, t]);

  const handleMetaData = useCallback((pid: string, meta: Record<string, ModelMeta>) => {
    setMetaByProvider((prev) => (prev[pid] === meta ? prev : { ...prev, [pid]: meta }));
  }, []);

  const searching = keyword.trim().length > 0;

  const searchHits = useMemo<SearchHit[]>(() => {
    if (!searching) return [];
    const q = keyword.trim();
    const hits: SearchHit[] = [];
    for (const provider of providers) {
      const info = entryInfoByProviderId[provider.id];
      const entryTag = info ? `${info.vendorLabel} · ${info.primary}` : provider.name;
      for (const model of provider.models) {
        if (model.enabled === false) continue;
        const score = bestFieldScore(q, [
          [model.id, 1],
          [model.label ?? '', 1],
          [info?.primary ?? provider.name, 0.5],
          [info?.vendorLabel ?? '', 0.4],
        ]);
        if (score === null) continue;
        hits.push({ provider, model, entryTag, score });
      }
    }
    return hits.sort((a, b) => b.score - a.score);
  }, [searching, keyword, providers, entryInfoByProviderId]);
  const virtualHits = useMemo(
    () =>
      searching
        ? selectableVirtualModels.filter(
            (entry) => fuzzyMatchScore(keyword.trim(), entry.name) !== null
          )
        : selectableVirtualModels,
    [searching, keyword, selectableVirtualModels]
  );
  /** 虚拟模型行：条目轨与搜索态共用一份，选择仍回传虚拟引用 */
  const virtualItems = virtualHits.map((entry) => (
    <MenuItem
      key={`virtual/${entry.id}`}
      data-model-picker-virtual={entry.id}
      onClick={() => handleSelectModel(VIRTUAL_PROVIDER_ID, entry.id)}
    >
      <Shuffle className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {currentVirtual?.id === entry.id && <Check className="h-3.5 w-3.5 text-brand" />}
      </span>
    </MenuItem>
  ));

  const handleSelectModel = useCallback(
    (targetProviderId: string, targetModelId: string) => {
      onSelect(targetProviderId, targetModelId);
      // 同一次交互内钳位:目标模型已知的支持档集若不含当前档,自动降到最近支持档并回写
      const target = findVirtualModel(virtualModels, {
        providerId: targetProviderId,
        modelId: targetModelId,
      })?.primary ?? { providerId: targetProviderId, modelId: targetModelId };
      const meta = metaByProvider[target.providerId]?.[target.modelId];
      const provider = providers.find((entry) => entry.id === target.providerId);
      const row = provider?.models.find((entry) => entry.id === target.modelId);
      const capability = resolvePickerCapabilities(
        provider,
        row,
        meta,
        // 切模型只替换 provider/model id，条目覆盖仍保留；归一化必须按切换后的同一份覆盖计算。
        modelCapabilityOverrides
      );
      const persisted = persistClampedThinkingLevel(
        thinkingLevel,
        capability.declaredThinkingLevels
      );
      if (persisted && !thinkingInherited) normalizeThinking(persisted);
      setOpen(false);
    },
    [
      onSelect,
      providers,
      virtualModels,
      modelCapabilityOverrides,
      metaByProvider,
      thinkingLevel,
      thinkingInherited,
      normalizeThinking,
    ]
  );

  const currentProviderMeta = useModelMeta(currentProvider);
  const currentModelMeta = currentProviderMeta[capabilityRef.modelId];
  const capability = useMemo(
    () =>
      resolvePickerCapabilities(
        currentProvider,
        current,
        currentModelMeta,
        modelCapabilityOverrides
      ),
    [currentProvider, current, currentModelMeta, modelCapabilityOverrides]
  );
  const supportedLevels = capability.thinkingLevels;
  const visibleLevels = useMemo(() => visibleThinkingLevels(supportedLevels), [supportedLevels]);
  const reasoningUnsupported = capability.reasoning === false || supportedLevels?.length === 0;
  const displayedReasoningEnabled =
    !reasoningUnsupported && (reasoningMode ? reasoningMode === 'on' : reasoningEnabled);
  const displayedThinkingLevel =
    visibleLevels.length > 0
      ? clampProjectThinkingLevel(thinkingLevel, visibleLevels)
      : thinkingLevel;

  /**
   * 归一化 effect：钳位不能只挂在 handleSelectModel 的 onClick 上，两条路径会漏掉——
   * ① 元数据是异步查询，选完模型那一刻可能还没到，到达后没人回头核对当前档是否仍合法；
   * ② 恢复已持久化会话完全不经过 onSelect，会话记忆里的档位可能对新连上的模型早已不支持。
   * 两种情况都要在 currentModelMeta 到位/变化时补一次回写；归一化回调缺省仍走会话状态
   * （分别对应 setThinking/setReasoning），不能只改本地显示，否则重启又变回不支持的值——
   * 这也顺带修好了 `reasoning:false` 时 Switch `checked={true} disabled` 打不开也关不掉的问题
   * （enabled 会被同步拨回 false）。
   * 只在「确实不支持」时才回写，`clampProjectThinkingLevel` 对已合法档位是恒等操作，
   * 配合这个判断，每次 meta 到位最多触发一次修正性 setState，不会死循环。
   */
  useEffect(() => {
    if (reasoningUnsupported) {
      if (reasoningEnabled && !reasoningInherited) normalizeReasoning(false);
      return;
    }
    if (!reasoningEnabled) return;
    const persisted = persistClampedThinkingLevel(thinkingLevel, capability.declaredThinkingLevels);
    if (persisted && !thinkingInherited) normalizeThinking(persisted);
  }, [
    capability.declaredThinkingLevels,
    reasoningUnsupported,
    reasoningEnabled,
    reasoningInherited,
    thinkingLevel,
    thinkingInherited,
    normalizeReasoning,
    normalizeThinking,
  ]);

  /** 条目轨：虚拟模型排第一，其余按厂商分组顺序平铺（同厂商多账号 / 多网关各占一项） */
  const railEntries = useMemo<RailEntry[]>(() => {
    const entries: RailEntry[] = [];
    if (selectableVirtualModels.length > 0) {
      entries.push({
        key: VIRTUAL_RAIL_KEY,
        title: t('Virtual models'),
        initial: '',
        isVirtual: true,
      });
    }
    for (const group of groups) {
      for (const provider of group.providers) {
        const info = entryInfoByProviderId[provider.id];
        const primary = info?.primary ?? provider.name;
        entries.push({
          key: providerRailKey(provider.id),
          providerId: provider.id,
          title: [info?.vendorLabel, primary].filter(Boolean).join(' · '),
          initial: railInitial(primary),
          isVirtual: false,
        });
      }
    }
    return entries;
  }, [groups, entryInfoByProviderId, selectableVirtualModels, t]);

  const railKeys = useMemo(() => railEntries.map((entry) => entry.key), [railEntries]);
  // 用户点过就以点击为准；没点过 / 条目已被删（账号移除、设置页未选模型）时回落到当前模型所属条目。
  // 用原始 providerId 而不是 capabilityRef：虚拟模型的能力按主模型算，但它自己的家在虚拟条目里。
  const railKey =
    activeRailKey && railKeys.includes(activeRailKey)
      ? activeRailKey
      : pickRailKey(railKeys, providerId);
  const activeEntry = railEntries.find((entry) => entry.key === railKey);
  const activeProvider = activeEntry?.providerId
    ? providers.find((provider) => provider.id === activeEntry.providerId)
    : undefined;
  const activeInfo = activeEntry?.providerId
    ? entryInfoByProviderId[activeEntry.providerId]
    : undefined;
  const activeModels = useMemo(
    () => activeProvider?.models.filter((m) => m.enabled !== false) ?? [],
    [activeProvider]
  );
  // 额度只跟当前条目走：池模式下用当前会话实际接替的账号，避免把别的成员额度当成这一条的
  const activeAccountKey = activeProvider
    ? usageAccountKeyForProvider(activeProvider, activeAccount)
    : undefined;
  const railTitle = activeEntry?.isVirtual
    ? t('Virtual models')
    : (activeInfo?.vendorLabel ?? activeProvider?.name ?? '');
  const entryMeta = activeEntry?.isVirtual
    ? undefined
    : [activeInfo?.primary, activeInfo?.secondary].filter(Boolean).join(' · ');
  const currentModelLabel = currentVirtual?.name ?? current?.label ?? current?.id ?? modelId;

  return (
    <div ref={wrapperRef} className={cn('min-w-0 max-w-full', triggerClassName && 'w-full')}>
      <Menu open={open} onOpenChange={setOpen}>
        <MenuTrigger
          data-model-picker="trigger"
          data-open={open ? '' : undefined}
          className={cn(
            'flex h-[calc(28rem/14)] min-w-14 max-w-64 shrink items-center gap-[calc(6rem/14)] rounded-[6px] px-[calc(8rem/14)] text-[calc(12rem/14)] transition-colors',
            // 常态是一枚安静的胶囊：淡底 + 前景色文字，而不是一行悬在输入条上的灰字
            formTrigger
              ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
              : 'bg-muted/45 text-foreground hover:bg-muted',
            // 展开态与浮层同开同关：胶囊被点亮，浮层才有「从这里长出来」的锚点
            !formTrigger && open && 'bg-muted',
            triggerClassName
          )}
          title={triggerLabel}
        >
          {!formTrigger && (
            <Sparkle className="size-[calc(14rem/14)] shrink-0 text-brand" aria-hidden />
          )}
          <span className="flex min-w-0 items-center gap-[calc(6rem/14)]">
            <span className="min-w-0 truncate">{triggerLabel}</span>
            {hasSelection && showReasoningControls && reasoningMode ? (
              <span
                className="shrink-0 text-[calc(11rem/14)]"
                data-reasoning-summary={reasoningMode}
              >
                {t(
                  reasoningMode === 'follow'
                    ? 'Follow parent'
                    : reasoningMode === 'on'
                      ? 'On'
                      : 'Off'
                )}
                {reasoningMode === 'on' && ` · ${t(LEVEL_LABEL_KEYS[displayedThinkingLevel])}`}
              </span>
            ) : hasSelection && showReasoningControls && displayedReasoningEnabled ? (
              // 档位是一枚小块而不是跟模型名并排的散字：名字可能很长，档位需要在被截断时仍然读得到
              <span
                className="flex h-[calc(17rem/14)] shrink-0 items-center gap-[3px] rounded-[4px] bg-brand/[0.14] px-[calc(4rem/14)] text-brand"
                data-trigger-thinking={displayedThinkingLevel}
              >
                <Brain className="h-[calc(11rem/14)] w-[calc(11rem/14)]" />
                <span className="text-[calc(10.5rem/14)] font-medium leading-none">
                  {t(LEVEL_LABEL_KEYS[displayedThinkingLevel])}
                </span>
              </span>
            ) : null}
          </span>
          <ChevronDown
            className={cn(
              'h-3 w-3 shrink-0 transition-transform',
              formTrigger && 'ms-auto opacity-80',
              open && '-rotate-180'
            )}
          />
        </MenuTrigger>
        <MenuPopup
          data-model-picker="root"
          side={side}
          // 输入条里：整块浮在输入条上方、右边缘对齐输入条右边缘
          anchor={composerAnchor ?? undefined}
          align={composerAnchor ? 'end' : 'start'}
          sideOffset={composerAnchor ? 6 : 4}
          className="w-[596px] max-w-[calc(100vw-1rem)]"
          zIndex={zIndex}
        >
          {providers.map((provider) => (
            <ModelMetaBridge key={provider.id} provider={provider} onData={handleMetaData} />
          ))}

          {/* 三栏面板：抵消 MenuPopup 内层容器的 6px 内边距，自己管分栏与滚动 */}
          <div
            data-model-picker="panel"
            className="-m-1.5 flex overflow-hidden rounded-[5px]"
            style={{ height: 'min(368px, calc(var(--available-height, 420px) - 12px))' }}
          >
            {showsPickerRail(railKeys) && (
              <div
                data-model-picker="rail"
                className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border/60 bg-muted/40 p-1"
              >
                {railEntries.map((entry) => (
                  <RailItem
                    key={entry.key}
                    entry={entry}
                    active={entry.key === railKey}
                    onSelect={() => setActiveRailKey(entry.key)}
                  />
                ))}
              </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="shrink-0 p-2 pb-1">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
                    aria-hidden
                  />
                  <input
                    ref={searchInputRef}
                    data-model-picker="search"
                    tabIndex={-1}
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={stopTypeaheadOnly}
                    placeholder={t('Search models, accounts or gateways')}
                    className={cn(
                      'h-8 w-full rounded-[6px] border bg-transparent pl-7 text-[calc(12rem/14)] outline-none placeholder:text-muted-foreground focus:border-ring',
                      listenHotkey && !keyword ? 'pr-11' : 'pr-2'
                    )}
                  />
                  {listenHotkey && !keyword && (
                    <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 rounded-[4px] border px-1 font-mono text-[calc(10rem/14)] leading-[calc(15rem/14)] text-muted-foreground/70">
                      ⌘P
                    </span>
                  )}
                </div>
              </div>

              {searching ? (
                <div
                  data-model-picker="results"
                  className="min-h-0 flex-1 overflow-y-auto px-1 pb-1"
                >
                  {virtualItems}
                  {searchHits.map(({ provider, model, entryTag }) => (
                    <MenuItem
                      key={`${provider.id}/${model.id}`}
                      onClick={() => handleSelectModel(provider.id, model.id)}
                    >
                      <ModelRowContent
                        model={model}
                        meta={metaByProvider[provider.id]?.[model.id]}
                        entryTag={entryTag}
                        selected={provider.id === providerId && model.id === modelId}
                      />
                    </MenuItem>
                  ))}
                  {searchHits.length === 0 && virtualItems.length === 0 && (
                    <p className="px-1 py-4 text-center text-[calc(11rem/14)] text-muted-foreground">
                      {t('No models found')}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {/* 条目头：厂商名留在左，账号邮箱 / 网关地址跟右——来源信息不丢，但不占一次点击 */}
                  <div className="flex h-7 shrink-0 items-center gap-1.5 px-2">
                    <span className="flex min-w-0 shrink items-center gap-1 text-[calc(11rem/14)] text-muted-foreground">
                      {activeEntry?.isVirtual ? (
                        <Shuffle className="size-3 shrink-0" aria-hidden />
                      ) : activeInfo?.isSubscription ? (
                        <BadgeCheck className="size-3 shrink-0" aria-hidden />
                      ) : (
                        <KeyRound className="size-3 shrink-0" aria-hidden />
                      )}
                      <span className="truncate">{railTitle}</span>
                    </span>
                    {entryMeta && (
                      <span className="min-w-0 flex-1 truncate text-right font-mono text-[calc(10.5rem/14)] text-muted-foreground/60">
                        {entryMeta}
                      </span>
                    )}
                    {activeInfo?.plan && (
                      <Badge
                        variant="outline"
                        size="sm"
                        className="max-w-20 shrink-0 truncate text-[calc(10rem/14)] uppercase"
                      >
                        {activeInfo.plan}
                      </Badge>
                    )}
                  </div>

                  {activeAccountKey && <EntryUsage accountKey={activeAccountKey} />}

                  <div
                    data-model-picker="models"
                    className="min-h-0 flex-1 overflow-y-auto px-1 pb-1"
                  >
                    {activeEntry?.isVirtual
                      ? virtualItems
                      : activeModels.map((model) => (
                          <MenuItem
                            key={model.id}
                            onClick={() => handleSelectModel(activeProvider?.id ?? '', model.id)}
                          >
                            <ModelRowContent
                              model={model}
                              meta={
                                activeProvider
                                  ? metaByProvider[activeProvider.id]?.[model.id]
                                  : undefined
                              }
                              selected={activeProvider?.id === providerId && model.id === modelId}
                            />
                          </MenuItem>
                        ))}
                    {(activeEntry?.isVirtual
                      ? virtualItems.length === 0
                      : activeModels.length === 0) && (
                      <p className="px-1 py-4 text-center text-[calc(11rem/14)] text-muted-foreground">
                        {t('No models found')}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 推理栏：开关 / 三态 + 档位滑杆，与它真正作用的那个模型同栏 */}
            {showReasoningControls && (
              <div
                data-model-picker="reasoning"
                className="flex w-[212px] shrink-0 flex-col border-l border-border/60 bg-muted/25 px-2.5 py-2"
              >
                <div className="flex h-6 shrink-0 items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-[calc(11rem/14)] text-muted-foreground">
                    <Brain className="size-3.5" aria-hidden />
                    {t('Reasoning')}
                  </span>
                  {!reasoningMode && (
                    <Switch
                      tabIndex={-1}
                      aria-label={t('Reasoning')}
                      checked={displayedReasoningEnabled}
                      onCheckedChange={onReasoningChange}
                      disabled={reasoningUnsupported}
                    />
                  )}
                </div>
                {hasSelection && (
                  <p
                    className="mt-0.5 shrink-0 truncate text-[calc(11rem/14)] text-muted-foreground/70"
                    title={currentModelLabel}
                  >
                    {currentModelLabel}
                  </p>
                )}

                {reasoningMode && (
                  <div
                    className="mt-2 flex shrink-0 gap-1"
                    role="group"
                    aria-label={t('Reasoning')}
                  >
                    {(['follow', 'on', 'off'] as const).map((mode) => (
                      <Button
                        key={mode}
                        type="button"
                        size="sm"
                        variant={reasoningMode === mode ? 'default' : 'outline'}
                        className="h-7 min-w-0 flex-1 px-1 text-[calc(11rem/14)]"
                        aria-pressed={reasoningMode === mode}
                        data-reasoning-mode={mode}
                        disabled={
                          mode === 'on' &&
                          !!currentProvider?.oauthAccountKey &&
                          reasoningUnsupported
                        }
                        onClick={() => onReasoningModeChange?.(mode, displayedThinkingLevel)}
                      >
                        {t(mode === 'follow' ? 'Follow parent' : mode === 'on' ? 'On' : 'Off')}
                      </Button>
                    ))}
                  </div>
                )}

                {/* 当前档由滑杆的滑块 + 高亮标签共同表达，不再重复一行"深度：xx"。
                    只有一个可用档时不画滑杆：没有可调范围，禁用态只会让人以为坏了 */}
                <div className="flex min-h-0 flex-1 flex-col justify-center">
                  {displayedReasoningEnabled && visibleLevels.length === 1 && (
                    <p
                      className="text-[calc(11rem/14)] text-muted-foreground"
                      data-thinking-fixed=""
                    >
                      {t(LEVEL_LABEL_KEYS[visibleLevels[0]])}
                    </p>
                  )}
                  {displayedReasoningEnabled && showsThinkingSlider(visibleLevels.length) && (
                    <ThinkingLevelSlider
                      levels={visibleLevels}
                      level={displayedThinkingLevel}
                      labels={LEVEL_LABEL_KEYS}
                      ariaLabel={t('Thinking level')}
                      onChange={onThinkingChange}
                    />
                  )}
                </div>

                {reasoningUnsupported && (!reasoningMode || !!currentProvider?.oauthAccountKey) && (
                  <p className="shrink-0 text-[calc(11rem/14)] leading-[calc(16rem/14)] text-muted-foreground/70">
                    {t('{{model}} does not support reasoning', {
                      model: current?.label ?? modelId,
                    })}
                  </p>
                )}
              </div>
            )}
          </div>
        </MenuPopup>
      </Menu>
    </div>
  );
}
