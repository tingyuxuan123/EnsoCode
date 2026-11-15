import type { AskRequestInfo } from '@shared/types/agent';
import { ArrowUp, Check, CircleHelp, MessageCircleQuestion, Send, Timer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { RequestCountdown, useRemainingMs } from './RequestCountdown';

interface AskBarProps {
  appearance?: 'default' | 'phone';
  asks: AskRequestInfo[];
  onAnswer: (requestId: string, answer: string) => void;
  /** 本机时钟 − host 时钟（手机伴侣显示剩余时间用） */
  clockOffset?: number;
  /** 桌面端提问出现时聚焦输入；手机传 false，避免立刻弹键盘挡住消息 */
  autoFocus?: boolean;
}

/** composer 上方的提问条(与审批条同构):agent 经 ask_user 提问,选项一键答或自由输入 */
export function AskBar({
  asks,
  onAnswer,
  clockOffset,
  autoFocus = true,
  appearance = 'default',
}: AskBarProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [responding, setResponding] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ requestId: string; value: string } | null>(null);
  const active = asks[0];
  const requestId = active?.requestId;
  const remainingMs = useRemainingMs(active?.expiresAt, clockOffset);
  useEffect(() => {
    if (appearance !== 'phone' || !requestId) return;
    setText('');
    setPicked(null);
  }, [requestId, appearance]);
  useEffect(() => {
    if (!autoFocus || !requestId) return;
    inputRef.current?.focus();
  }, [autoFocus, requestId]);
  if (!active) return null;
  const disabled =
    responding === active.requestId || (remainingMs !== undefined && remainingMs <= 0);
  const answer = (value: string) => {
    if (disabled || (!active.selectionOnly && !value.trim())) return;
    setResponding(active.requestId);
    setText('');
    onAnswer(active.requestId, active.selectionOnly ? value : value.trim());
  };

  if (appearance === 'phone') {
    const selected = picked?.requestId === active.requestId ? picked.value : '';
    const submission = active.selectionOnly ? selected : text || selected;
    return (
      <section data-slot="ask-bar" className="mb-2">
        <header className="flex items-center gap-2">
          <CircleHelp className="size-[18px] shrink-0 text-yellow" />
          <h2 className="min-w-0 flex-1 text-[15px] leading-5 font-semibold">它在问你</h2>
          <Timer className="size-3.5 text-dim" />
          <RequestCountdown remainingMs={remainingMs} expiredLabel="Timed out · no answer" />
          {asks.length > 1 && <span className="text-[11px] text-dim">1/{asks.length}</span>}
        </header>
        <p className="mt-3 text-[15px] leading-[22px]">{active.question}</p>
        <div role="radiogroup" aria-label={active.question} className="mt-3 flex flex-col gap-2">
          {active.options?.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected === option}
              disabled={disabled}
              onClick={() => {
                setPicked({ requestId: active.requestId, value: option });
                setText('');
              }}
              className="flex items-center gap-3 rounded-[16px] bg-card px-4 py-3.5 text-left text-[15px] leading-5 font-medium disabled:opacity-50"
              style={{
                boxShadow:
                  selected === option
                    ? 'inset 0 0 0 2px var(--ink)'
                    : 'inset 0 0 0 0.75px var(--line)',
              }}
            >
              <span className="min-w-0 flex-1">{option}</span>
              {selected === option ? (
                <Check className="size-4 shrink-0" />
              ) : (
                <span className="size-4 shrink-0 rounded-full border border-line" />
              )}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          {!active.selectionOnly && (
            <input
              ref={inputRef}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setPicked(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing)
                  answer(text || selected);
              }}
              disabled={disabled}
              placeholder="或者直接写你的回答"
              aria-label="回答"
              className="h-12 min-w-0 flex-1 rounded-3xl border border-line bg-card px-4 text-[15px] placeholder:text-dim"
            />
          )}
          {active.selectionOnly && (
            <button
              type="button"
              onClick={() => answer('')}
              disabled={disabled}
              className="h-12 flex-1 rounded-full bg-card text-[15px] text-ink2"
            >
              {t('Cancel')}
            </button>
          )}
          <button
            type="button"
            data-ask-submit=""
            onClick={() => answer(submission)}
            disabled={disabled || !submission.trim()}
            className="glass-ink flex h-12 shrink-0 items-center gap-1.5 rounded-full px-5 text-[15px] font-medium disabled:opacity-40"
          >
            回答
            <ArrowUp className="size-[18px]" />
          </button>
        </div>
      </section>
    );
  }

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
      {active.selectionOnly ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => answer('')}
          className="mt-2 rounded-[6px] border border-border/70 px-[10px] py-[4px] text-[calc(12rem/14)] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {t('Cancel')}
        </button>
      ) : (
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
      )}
    </div>
  );
}
