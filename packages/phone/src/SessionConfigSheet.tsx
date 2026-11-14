import type { ProviderEntry, ThinkingLevel } from '@enso/pair';
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

export interface SessionConfig {
  providerId?: string;
  modelId?: string;
  reasoningEnabled?: boolean;
  thinkingLevel?: ThinkingLevel;
}

interface Props {
  providers: ProviderEntry[];
  config: SessionConfig;
  open: boolean;
  onClose(): void;
  onSetModel(providerId: string, modelId: string): void;
  onSetReasoning(enabled: boolean): void;
  onSetThinking(level: ThinkingLevel): void;
}

const LEVEL_LABELS: Record<ThinkingLevel, string> = {
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
};

/**
 * 会话模型/推理档位调整：选择即发命令（与桌面选择器同语义——模型切换
 * 只影响后续 spawn，推理档位对已启动会话即时生效）。当前值来自目录快照，
 * 命令生效后随目录回推自然回显，不做本地乐观状态。
 */
export function SessionConfigSheet({
  providers,
  config,
  open,
  onClose,
  onSetModel,
  onSetReasoning,
  onSetThinking,
}: Props) {
  const provider = providers.find((p) => p.id === config.providerId);
  const reasoningOn = config.reasoningEnabled ?? false;
  const level = config.thinkingLevel ?? 'medium';

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="phone-sheet pb-safe" showCloseButton={false}>
        <SheetHeader className="flex-row items-center gap-3 px-5 pt-2 pb-3 text-left">
          <SheetTitle className="min-w-0 flex-1 text-[17px] leading-[22px] font-semibold">
            会话设置
          </SheetTitle>
          <span className="shrink-0 rounded-full bg-card2 px-2.5 py-1 text-[12px] leading-4 font-medium text-ink2">
            仅本会话
          </span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-faint"
          >
            <span aria-hidden className="text-[18px] leading-none">
              ×
            </span>
          </button>
        </SheetHeader>
        <div className="space-y-2 px-5 pb-6">
          <Field label="模型服务">
            <Select
              items={providers.map((p) => ({ value: p.id, label: p.name }))}
              value={config.providerId ?? ''}
              onValueChange={(v) => {
                const next = providers.find((p) => p.id === v);
                const firstModel = next?.models[0]?.id;
                if (next && firstModel) onSetModel(next.id, firstModel);
              }}
            >
              <SelectTrigger className="h-12 w-full rounded-[16px] border-0 bg-card px-4 text-[15px] leading-5">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>

          <Field label="模型">
            <Select
              items={(provider?.models ?? []).map((m) => ({
                value: m.id,
                label: m.label ?? m.id,
              }))}
              value={config.modelId ?? ''}
              onValueChange={(v) => {
                if (config.providerId) onSetModel(config.providerId, v as string);
              }}
            >
              <SelectTrigger className="h-12 w-full rounded-[16px] border-0 bg-card px-4 text-[15px] leading-5">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                {(provider?.models ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label ?? m.id}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>

          <div className="flex items-center gap-3 rounded-[16px] bg-card px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-5 font-medium">推理</p>
              <p className="text-[12px] leading-4 text-dim">会多花几秒，难题更稳</p>
            </div>
            <Switch checked={reasoningOn} onCheckedChange={onSetReasoning} />
          </div>

          {reasoningOn && (
            <div className="pt-1">
              <p className="px-1 pb-1.5 text-[12px] leading-4 font-medium text-dim">思考等级</p>
              {/* 设计稿 config.tsx：分段胶囊，选中抬到白底 */}
              <div className="flex rounded-full bg-card2 p-1">
                {(Object.keys(LEVEL_LABELS) as ThinkingLevel[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={level === l}
                    onClick={() => onSetThinking(l)}
                    className={
                      level === l
                        ? 'flex h-9 flex-1 items-center justify-center rounded-full bg-card text-[14px] leading-5 font-medium text-ink shadow-[0_1px_3px_rgb(0_0_0/0.08)]'
                        : 'flex h-9 flex-1 items-center justify-center rounded-full text-[14px] leading-5 font-medium text-dim'
                    }
                  >
                    {LEVEL_LABELS[l]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="px-1 pt-1 text-[11px] leading-4 text-faint">
            模型切换对运行中的会话在下次启动时生效；推理档位即时生效。
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 h-12 w-full rounded-full bg-pill text-[15px] font-medium text-pill-ink"
          >
            完成
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="px-1 text-[12px] leading-4 font-medium text-dim">{label}</span>
      {children}
    </label>
  );
}
