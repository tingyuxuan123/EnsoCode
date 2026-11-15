import {
  type ApprovalMode,
  type AttachedImage,
  type ProjectEntry,
  type ProviderEntry,
  pairProjectListLabel,
  type ThinkingLevel,
} from '@enso/pair';
import { ArrowUp, Check, ChevronDown, ChevronRight, Plus, Sparkles, X } from 'lucide-react';
import { useReducer, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { compressImages } from './image';
import { draftRequest, EMPTY_DRAFT, newSessionDraft } from './newSessionDraft';
import {
  listModelOptions,
  modelPillLabel,
  resolveModelOption,
  THINKING_LEVELS,
  thinkingLevelLabel,
} from './sessionModelChoices';
import { usePhoneBack } from './usePhoneBack';

export interface NewSessionRequest {
  projectId: string;
  providerId: string;
  modelId: string;
  approvalMode?: ApprovalMode;
  reasoningEnabled?: boolean;
  thinkingLevel?: ThinkingLevel;
  /** 还没发出去的输入：调用方收到后种进新会话输入框，不自动发送 */
  draft?: { text: string; images?: AttachedImage[] };
}

/** 「接着上次」的一行：只取会话列表里需要的字段，避免把整份目录塞进来 */
export interface RecentSession {
  id: string;
  title: string;
  projectName: string;
  note?: string;
}

interface Props {
  projects: ProjectEntry[];
  providers: ProviderEntry[];
  open: boolean;
  /** 从项目旁「新会话」进入时预填；顶栏新建不传 */
  preferredProjectId?: string | null;
  /** 顶栏连接 pill 文案（如「书房 · 已连接」）；不传按项目情况给兜底文案 */
  connectionLabel?: string;
  /** 接真实会话列表：最多显示 2 条 */
  recentSessions?: RecentSession[];
  onSelectSession?(sessionId: string): void;
  onClose(): void;
  onCreate(request: NewSessionRequest): void;
}

/** 手选 > 入口预填 > 列表第一项。列表异步到达时对当前项做校验回落。 */
export function resolveNewSessionProjectId(
  projects: readonly { id: string }[],
  pickedId: string | null,
  preferredId?: string | null
): string {
  return (
    projects.find((p) => p.id === pickedId)?.id ??
    projects.find((p) => p.id === preferredId)?.id ??
    projects[0]?.id ??
    ''
  );
}

// 与桌面 ApprovalModePicker 同义（i18n 键 Supervised / Auto-accept edits / Full access）；
// full 是「完全放行」而非「全部需审批」——写反会让用户误以为选了最严档
const APPROVAL_LABELS: Record<ApprovalMode, string> = {
  supervised: '受监督（每步确认）',
  'auto-edits': '自动接受编辑',
  full: '完全放行',
  assistant: '助手代审',
};

const APPROVAL_MODES = Object.keys(APPROVAL_LABELS) as ApprovalMode[];

/**
 * 新建会话：全屏晨光撰写页（design frames/new-session.tsx）。
 * 输入与图片只随 onCreate 作为 draft 交给调用方种进新会话输入框，
 * 不新增 pair 协议、不自动发送；审批 / 推理 / 模型等能力收进点模型胶囊展开的选择区。
 */
export function NewSessionSheet({
  projects,
  providers,
  open,
  preferredProjectId,
  connectionLabel,
  recentSessions,
  onSelectSession,
  onClose,
  onCreate,
}: Props) {
  usePhoneBack(open, onClose, 50);
  // 组件常驻挂载，目录是异步到达的：选中值存"用户是否显式选过"，
  // 实际取值再对当前列表做校验回落，避免初值算在空列表上而永远选不中。
  const [pickedProject, setPickedProject] = useState<string | null>(null);
  const [pickedProvider, setPickedProvider] = useState<string | null>(null);
  const [pickedModel, setPickedModel] = useState<string | null>(null);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('full');
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('medium');
  const [configOpen, setConfigOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [draft, dispatchDraft] = useReducer(newSessionDraft, EMPTY_DRAFT);
  const fileRef = useRef<HTMLInputElement>(null);

  const projectId = resolveNewSessionProjectId(projects, pickedProject, preferredProjectId);
  const modelOptions = listModelOptions(providers);
  const model = resolveModelOption(modelOptions, pickedProvider, pickedModel);
  const providerId = model?.providerId ?? '';
  const modelId = model?.modelId ?? '';
  const canCreate = Boolean(projectId && providerId && modelId) && !imageBusy;
  const recent = (recentSessions ?? []).slice(0, 2);

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setImageBusy(true);
    setImageError(null);
    try {
      dispatchDraft({ type: 'add-images', images: await compressImages([...files]) });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : '图片读取失败');
    } finally {
      setImageBusy(false);
    }
  };

  const submit = () => {
    if (!canCreate) return;
    const attached = draftRequest(draft);
    onCreate({
      projectId,
      providerId,
      modelId,
      approvalMode,
      ...(reasoningEnabled ? { reasoningEnabled, thinkingLevel } : {}),
      ...(attached ? { draft: attached } : {}),
    });
    // onCreate 已把正文/图片交给调用方种进新会话输入框，这里才清；
    // 单纯关闭（onClose）不清，用户回来接着写。
    dispatchDraft({ type: 'create' });
    setPickedProject(null);
    setConfigOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        className="fixed inset-0 h-[100dvh] border-0 bg-page pt-safe pb-safe shadow-none"
        showCloseButton={false}
        initialFocus={false}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>新建会话</SheetTitle>
        </SheetHeader>
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-page">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
            style={{
              background:
                'radial-gradient(90% 62% at 0% 0%, var(--dawn-side) 0%, transparent 70%), radial-gradient(85% 58% at 100% 6%, var(--dawn) 0%, transparent 72%)',
            }}
          />
          <header className="relative flex items-center py-2 pr-4 pl-1">
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="flex size-12 items-center justify-center rounded-full text-ink"
            >
              <X className="size-6" aria-hidden />
            </button>
            <div className="flex-1" />
            <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-card2 px-3">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  connectionLabel || projects.length > 0 ? 'bg-green' : 'bg-faint'
                )}
              />
              <span className="text-[12px] leading-4 font-medium text-ink2">
                {connectionLabel ?? (projects.length > 0 ? '可以开工' : '还没有项目')}
              </span>
            </span>
          </header>

          <div className="relative min-h-0 flex-1 overflow-y-auto pb-8">
            <div className="relative px-5 pt-7">
              <h1 className="text-[30px] leading-[37px] font-bold tracking-[-0.02em]">
                早上好
                <br />
                <span className="phone-greet">今天做点什么</span>
              </h1>
              <p className="mt-3 text-[14px] leading-5 text-dim">
                选一个项目，然后说清楚你要的结果。
              </p>
            </div>

            {/* 项目：横向胶囊，选中即实心墨黑（稿子项目行） */}
            <div className="relative mt-4 flex gap-2 overflow-x-auto px-5">
              {projects.map((p) => {
                const active = p.id === projectId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPickedProject(p.id)}
                    aria-pressed={active}
                    className={cn(
                      'flex h-9 shrink-0 items-center rounded-full px-4 text-[14px] leading-5 font-medium',
                      active ? 'bg-pill text-pill-ink' : 'bg-card text-ink2'
                    )}
                  >
                    {pairProjectListLabel(p)}
                  </button>
                );
              })}
              {projects.length === 0 && (
                <p className="py-2 text-[13px] leading-5 text-red">请先在桌面添加项目。</p>
              )}
            </div>

            <div className="relative mt-4 px-4">
              <div className="rounded-[24px] bg-card p-4 shadow-[0_18px_40px_-24px_rgb(0_0_0/0.35)]">
                <textarea
                  value={draft.text}
                  onChange={(e) => dispatchDraft({ type: 'text', text: e.target.value })}
                  aria-label="要让会话做的事"
                  placeholder="描述要它做的事。可以带文件、截图，或者直接说「修好刚才那个测试」。"
                  className="block min-h-[86px] w-full resize-none bg-transparent text-[16px] leading-[24px] text-ink outline-none placeholder:text-dim"
                />
                {draft.images.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {draft.images.map((img, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 附件只追加、按序号删除，顺序即身份
                      <span key={`${img.mimeType}-${index}`} className="relative">
                        <img
                          src={`data:${img.mimeType};base64,${img.data}`}
                          alt=""
                          className="size-14 rounded-[12px] object-cover"
                        />
                        <button
                          type="button"
                          aria-label={`移除第 ${index + 1} 张图片`}
                          onClick={() => dispatchDraft({ type: 'remove-image', index })}
                          className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-pill text-pill-ink"
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {imageError && (
                  <p className="mt-2 text-[12px] leading-4 text-red" role="alert">
                    {imageError}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="添加附件"
                    disabled={imageBusy}
                    onClick={() => fileRef.current?.click()}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card2 text-ink disabled:opacity-40"
                  >
                    <Plus className="size-5" aria-hidden />
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void addImages(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    aria-label="模型与思考设置"
                    aria-expanded={configOpen}
                    onClick={() => setConfigOpen((v) => !v)}
                    className="flex h-10 min-w-0 items-center gap-1.5 rounded-full bg-card2 px-3 text-[13px] leading-4 font-medium"
                  >
                    <Sparkles className="size-4 shrink-0" aria-hidden />
                    <span className="truncate text-ink2">
                      {modelPillLabel(model?.label ?? '', reasoningEnabled, thinkingLevel)}
                    </span>
                    <ChevronDown
                      className={cn(
                        'size-3.5 shrink-0 text-faint transition-transform',
                        configOpen && 'rotate-180'
                      )}
                      aria-hidden
                    />
                  </button>
                  <div className="flex-1" />
                  <button
                    type="button"
                    aria-label="开始"
                    disabled={!canCreate}
                    onClick={submit}
                    className="flex size-12 shrink-0 items-center justify-center rounded-full bg-pill text-pill-ink disabled:opacity-40"
                  >
                    <ArrowUp className="size-[22px]" aria-hidden />
                  </button>
                </div>

                {configOpen && (
                  <div className="mt-3 max-h-[46vh] overflow-y-auto rounded-[16px] bg-card2 p-3">
                    <p className="px-1 pb-1.5 text-[12px] leading-4 font-medium text-dim">模型</p>
                    <div className="flex flex-col gap-1.5">
                      {modelOptions.map((option) => {
                        const active = option.key === model?.key;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => {
                              setPickedProvider(option.providerId);
                              setPickedModel(option.modelId);
                            }}
                            className={cn(
                              'flex items-center gap-2 rounded-[12px] bg-card px-3 py-2 text-left',
                              active && 'shadow-[inset_0_0_0_2px_var(--color-ink)]'
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] leading-5 font-medium">
                                {option.label}
                              </span>
                              <span className="block truncate text-[11px] leading-4 text-dim">
                                {option.providerName}
                              </span>
                            </span>
                            {active && <Check className="size-4 shrink-0" aria-hidden />}
                          </button>
                        );
                      })}
                      {modelOptions.length === 0 && (
                        <p className="px-1 py-2 text-[12px] leading-4 text-red">
                          桌面端没有可用的模型服务。
                        </p>
                      )}
                    </div>

                    <p className="px-1 pt-3 pb-1.5 text-[12px] leading-4 font-medium text-dim">
                      审批
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {APPROVAL_MODES.map((mode) => {
                        const active = mode === approvalMode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setApprovalMode(mode)}
                            className={cn(
                              'h-8 rounded-full px-3 text-[12px] leading-4 font-medium',
                              active ? 'bg-pill text-pill-ink' : 'bg-card text-ink2'
                            )}
                          >
                            {APPROVAL_LABELS[mode]}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex items-center gap-2 rounded-[12px] bg-card px-3 py-2">
                      <span className="min-w-0 flex-1 text-[13px] leading-4 font-medium">推理</span>
                      <Switch
                        aria-label="推理"
                        checked={reasoningEnabled}
                        onCheckedChange={setReasoningEnabled}
                      />
                    </div>
                    {reasoningEnabled && (
                      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                        {THINKING_LEVELS.map((level) => {
                          const active = level === thinkingLevel;
                          return (
                            <button
                              key={level}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setThinkingLevel(level)}
                              className={cn(
                                'h-8 rounded-full text-[12px] leading-4 font-medium',
                                active ? 'bg-card text-ink' : 'bg-card/60 text-dim'
                              )}
                            >
                              {thinkingLevelLabel(level)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {recent.length > 0 && (
              <div className="relative mt-6 px-5">
                <div className="flex items-center gap-2 pb-1">
                  <span className="text-[13px] leading-[18px] font-medium text-dim">接着上次</span>
                  <div className="flex-1" />
                  <span className="text-[11px] leading-4 text-faint">{recent.length} 个</span>
                </div>
                {recent.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => onSelectSession?.(session.id)}
                    className="flex w-full items-center gap-2 py-2.5 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] leading-[21px] font-medium">
                        {session.title}
                      </span>
                      <span className="block truncate text-[13px] leading-[18px] text-dim">
                        {[session.projectName, session.note].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
