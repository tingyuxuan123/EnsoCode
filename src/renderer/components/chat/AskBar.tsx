import type { AskRequestInfo } from '@shared/types/agent';
import { MessageCircleQuestion, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { RequestCountdown, useRemainingMs } from './RequestCountdown';

interface AskBarProps {
  asks: AskRequestInfo[];
  onAnswer: (requestId: string, answer: string) => void;
  /** 本机时钟 − host 时钟（手机伴侣显示剩余时间用） */
  clockOffset?: number;
  /** 桌面端提问出现时聚焦输入；手机传 false，避免立刻弹键盘挡住消息 */
  autoFocus?: boolean;
}

/** composer 上方的提问条(与审批条同构):agent 经 ask_user 提问,选项一键答或自由输入 */
export function AskBar({ asks, onAnswer, clockOffset, autoFocus = true }: AskBarProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [responding, setResponding] = useState<string | null>(null);
  const active = asks[0];
  const requestId = active?.requestId;
  const remainingMs = useRemainingMs(active?.expiresAt, clockOffset);
  useEffect(() => {
    if (!autoFocus || !requestId) return;
    inputRef.current?.focus();
  }, [autoFocus, requestId]);
  if (!active) return null;
  const disabled =
    responding === active.requestId || (remainingMs !== undefined && remainingMs <= 0);
  const answer = (value: string) => {
    if (!value.trim()) return;
    setResponding(active.requestId);
    setText('');
    onAnswer(active.requestId, value.trim());
  };

  return (
    <div
      data-slot="ask-bar"
      className="mb-[6px] rounded-[6px] border border-border/70 bg-muted/45 px-[12px] py-[8px] text-[calc(12rem/14)]"
    >
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="mt-[2px] size-[calc(14rem/14)] shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[calc(13rem/14)] leading-[calc(20rem/14)] whitespace-pre-wrap">
          {active.question}
        </span>
        <RequestCountdown remainingMs={remainingMs} expiredLabel="Timed out · no answer" />
        {asks.length > 1 && (
          <span className="shrink-0 text-[calc(11rem/14)] text-muted-foreground tabular-nums">
            1/{asks.length}
          </span>
        )}
      </div>
      {active.options && active.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {active.options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => answer(option)}
              className="rounded-[6px] border border-border/70 px-[10px] py-[4px] text-[calc(12rem/14)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {option}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') answer(text);
          }}
          disabled={disabled}
          placeholder={t('Type an answer…')}
          className="h-[calc(28rem/14)] min-w-0 flex-1 rounded-[6px] border bg-background px-[8px] text-[calc(12rem/14)] outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled || !text.trim()}
          onClick={() => answer(text)}
          className="flex size-[calc(28rem/14)] shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
