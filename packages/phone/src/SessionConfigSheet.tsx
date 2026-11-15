import type { ProviderEntry, ThinkingLevel } from '@enso/pair';
import { Check } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { listModelOptions, THINKING_LEVELS, thinkingLevelLabel } from './sessionModelChoices';
import { usePhoneBack } from './usePhoneBack';

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

/**
 * 会话模型/推理档位调整：选择即发命令（与桌面选择器同语义——模型切换
 * 只影响后续 spawn，推理档位对已启动会话即时生效）。当前值来自目录快照，
 * 命令生效后随目录回推自然回显，不做本地乐观状态。
 * 版式按 design frames/config.tsx：一张模型白卡列表 + 推理开关 + 思考档位胶囊。
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
  usePhoneBack(open, onClose, 50);
  const options = listModelOptions(providers);
  const selectedKey =
    config.providerId && config.modelId ? `${config.providerId}\n${config.modelId}` : '';
  const reasoningOn = config.reasoningEnabled ?? false;
  const level = config.thinkingLevel ?? 'medium';

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        className="phone-sheet pb-safe"
        showCloseButton={false}
        initialFocus={false}
      >
        <SheetHeader className="flex-row items-center gap-3 px-5 pt-2 pb-3 text-left">
          <SheetTitle className="min-w-0 flex-1 text-[17px] leading-[22px] font-semibold">
            会话设置
          </SheetTitle>
          <span className="shrink-0 rounded-full bg-card2 px-2.5 py-1 text-[12px] leading-4 font-medium text-ink2">
            仅本会话
          </span>
        </SheetHeader>

        <div className="min-h-0 overflow-y-auto pb-2">
          <SectionLabel>模型</SectionLabel>
          {/* 上限给到列表：模型多时面板内滚动，不把整张 sheet 撑出屏幕 */}
          <div className="flex max-h-[38vh] flex-col gap-2 overflow-y-auto px-5">
            {options.map((option) => {
              const active = option.key === selectedKey;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSetModel(option.providerId, option.modelId)}
                  className={cn(
                    'flex shrink-0 items-center gap-3 rounded-[16px] bg-card px-4 py-3 text-left',
                    active && 'shadow-[inset_0_0_0_2px_var(--color-ink)]'
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] leading-5 font-medium">
                      {option.label}
                    </span>
                    <span className="block truncate text-[12px] leading-4 text-dim">
                      {option.providerName}
                    </span>
                  </span>
                  {active && <Check className="size-4 shrink-0" aria-hidden />}
                </button>
              );
            })}
            {options.length === 0 && (
              <p className="py-2 text-[12px] leading-4 text-red">桌面端没有可用的模型服务。</p>
            )}
          </div>

          <SectionLabel>推理</SectionLabel>
          <div className="px-5">
            <div className="flex items-center gap-3 rounded-[16px] bg-card px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-5 font-medium">推理</span>
                <span className="block text-[12px] leading-4 text-dim">会多花几秒，难题更稳</span>
              </span>
              <ReasoningToggle on={reasoningOn} onChange={onSetReasoning} />
            </div>
          </div>

          <SectionLabel>思考等级</SectionLabel>
          <div className="px-5">
            {/* 稿子上的「关」由上面推理开关表达；现有 6 档一个不删 */}
            <div className="flex rounded-full bg-card2 p-1">
              {THINKING_LEVELS.map((value) => {
                const active = value === level;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSetThinking(value)}
                    className={cn(
                      'flex h-9 flex-1 items-center justify-center rounded-full text-[14px] leading-5 font-medium',
                      active ? 'bg-card text-ink shadow-[0_1px_3px_rgb(0_0_0/0.08)]' : 'text-dim'
                    )}
                  >
                    {thinkingLevelLabel(value)}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="px-6 pt-3 text-[11px] leading-4 text-faint">
            模型切换对运行中的会话在下次启动时生效；推理档位即时生效。
          </p>
        </div>

        <div className="px-5 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="h-12 w-full rounded-full bg-pill text-[15px] font-medium text-pill-ink"
          >
            完成
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-6 pt-4 pb-2 text-[13px] leading-[18px] font-medium text-dim">{children}</h3>
  );
}

/** 稿子 48×28 黑白开关：开 = 墨黑轨道 + 白钮，关 = 纸灰轨道 + 白钮 */
function ReasoningToggle({ on, onChange }: { on: boolean; onChange(enabled: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="推理"
      onClick={() => onChange(!on)}
      className={cn(
        'flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors',
        on ? 'bg-pill' : 'bg-card2'
      )}
    >
      <span
        className={cn(
          'size-5 rounded-full bg-card shadow-[0_1px_2px_rgb(0_0_0/0.18)]',
          on && 'ml-auto bg-pill-ink'
        )}
      />
    </button>
  );
}
