import {
  type ApprovalMode,
  type ProjectEntry,
  type ProviderEntry,
  pairProjectListLabel,
  type ThinkingLevel,
} from '@enso/pair';
import { useState } from 'react';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Z_INDEX } from '@/lib/z-index';

export interface NewSessionRequest {
  projectId: string;
  providerId: string;
  modelId: string;
  approvalMode?: ApprovalMode;
  reasoningEnabled?: boolean;
  thinkingLevel?: ThinkingLevel;
}

interface Props {
  projects: ProjectEntry[];
  providers: ProviderEntry[];
  open: boolean;
  /** 从项目旁「新会话」进入时预填；顶栏新建不传 */
  preferredProjectId?: string | null;
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

// 与 SessionConfigSheet 同一套档位文案，保持两处选择器观感一致
const LEVEL_LABELS: Record<ThinkingLevel, string> = {
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
};

/** 新建会话：只能选桌面已添加的项目（cwd 由 main 反查）与已启用的模型 */
export function NewSessionSheet({
  projects,
  providers,
  open,
  preferredProjectId,
  onClose,
  onCreate,
}: Props) {
  // 组件常驻挂载，目录是异步到达的：选中值存"用户是否显式选过"，
  // 实际取值再对当前列表做校验回落，避免初值算在空列表上而永远选不中。
  const [pickedProject, setPickedProject] = useState<string | null>(null);
  const [pickedProvider, setPickedProvider] = useState<string | null>(null);
  const [pickedModel, setPickedModel] = useState<string | null>(null);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('full');
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('medium');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPickedProject(null);
  }

  const projectId = resolveNewSessionProjectId(projects, pickedProject, preferredProjectId);
  const provider = providers.find((p) => p.id === pickedProvider) ??
    providers[0] ?? { id: '', models: [] };
  const providerId = provider.id;
  const modelId =
    provider.models.find((m) => m.id === pickedModel)?.id ?? provider.models[0]?.id ?? '';

  const canCreate = Boolean(projectId && providerId && modelId);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="phone-sheet pb-safe" showCloseButton={false}>
        <SheetHeader className="sr-only">
          <SheetTitle>新建会话</SheetTitle>
        </SheetHeader>
        {/* 设计稿 new-session.tsx：晨光 + 两行问候 + 项目胶囊 + 白卡，不是下拉表 */}
        <div className="relative min-h-[86vh] overflow-hidden bg-page">
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
              <span aria-hidden className="text-[22px] leading-none">
                ×
              </span>
            </button>
            <div className="flex-1" />
            <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-card2 px-3">
              <span className="size-1.5 rounded-full bg-green" />
              <span className="text-[12px] leading-4 font-medium text-ink2">
                {projects.length > 0 ? '可以开工' : '桌面端还没有项目'}
              </span>
            </span>
          </header>

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
          <div className="relative mt-4 flex gap-2 overflow-x-auto px-5 pb-1">
            {projects.map((p) => {
              const active = p.id === projectId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPickedProject(p.id)}
                  aria-pressed={active}
                  className={
                    active
                      ? 'flex h-9 shrink-0 items-center rounded-full bg-pill px-4 text-[14px] leading-5 font-medium text-pill-ink'
                      : 'flex h-9 shrink-0 items-center rounded-full bg-card px-4 text-[14px] leading-5 font-medium text-ink2'
                  }
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
              <p className="text-[15px] leading-[24px] text-dim">
                建好之后直接在会话里说要它做什么；模型和审批随时可以在会话设置里改。
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Select
                  items={providers.flatMap((p) =>
                    p.models.map((m) => ({
                      value: `${p.id}\n${m.id}`,
                      label: `${p.name} · ${m.label ?? m.id}`,
                    }))
                  )}
                  value={`${providerId}\n${modelId}`}
                  onValueChange={(v) => {
                    const [pid, mid] = String(v).split('\n');
                    setPickedProvider(pid ?? null);
                    setPickedModel(mid ?? null);
                  }}
                >
                  <SelectTrigger className="h-9 rounded-full border-0 bg-card2 px-3 text-[13px] leading-4">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                    {providers.flatMap((p) =>
                      p.models.map((m) => (
                        <SelectItem key={`${p.id}:${m.id}`} value={`${p.id}\n${m.id}`}>
                          {p.name} · {m.label ?? m.id}
                        </SelectItem>
                      ))
                    )}
                  </SelectPopup>
                </Select>
                <Select
                  items={(Object.keys(APPROVAL_LABELS) as ApprovalMode[]).map((mode) => ({
                    value: mode,
                    label: APPROVAL_LABELS[mode],
                  }))}
                  value={approvalMode}
                  onValueChange={(v) => setApprovalMode(v as ApprovalMode)}
                >
                  <SelectTrigger className="h-9 rounded-full border-0 bg-card2 px-3 text-[13px] leading-4">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                    {(Object.keys(APPROVAL_LABELS) as ApprovalMode[]).map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {APPROVAL_LABELS[mode]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <span className="flex h-9 items-center gap-2 rounded-full bg-card2 px-3">
                  <span className="text-[13px] leading-4 text-dim">推理</span>
                  <Switch checked={reasoningEnabled} onCheckedChange={setReasoningEnabled} />
                </span>
                {reasoningEnabled && (
                  <Select
                    items={(Object.keys(LEVEL_LABELS) as ThinkingLevel[]).map((l) => ({
                      value: l,
                      label: LEVEL_LABELS[l],
                    }))}
                    value={thinkingLevel}
                    onValueChange={(v) => setThinkingLevel(v as ThinkingLevel)}
                  >
                    <SelectTrigger className="h-9 rounded-full border-0 bg-card2 px-3 text-[13px] leading-4">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                      {(Object.keys(LEVEL_LABELS) as ThinkingLevel[]).map((l) => (
                        <SelectItem key={l} value={l}>
                          {LEVEL_LABELS[l]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                )}
              </div>
              {providers.length === 0 && (
                <p className="mt-2 text-[12px] leading-4 text-red">桌面端没有可用的模型服务。</p>
              )}
            </div>
          </div>

          <div className="relative mt-5 flex items-center gap-2.5 px-5 pb-8">
            <button
              type="button"
              onClick={onClose}
              className="h-12 flex-1 rounded-full bg-card2 text-[15px] font-medium text-ink2"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!canCreate}
              onClick={() =>
                onCreate({
                  projectId,
                  providerId,
                  modelId,
                  approvalMode,
                  ...(reasoningEnabled ? { reasoningEnabled, thinkingLevel } : {}),
                })
              }
              className="h-12 flex-[1.4] rounded-full bg-pill text-[15px] font-medium text-pill-ink disabled:opacity-40"
            >
              开工
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
