import { Circle, CircleCheck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import type { AskUserView } from '@/stores/sessions/timeline';

/** ask_user 行展开：当时的问题、全部选项，并标出用户的选择（自定义回答单独列在最后） */
export function AskUserResult({ ask, waiting }: { ask: AskUserView; waiting: boolean }) {
  const { t } = useI18n();
  const custom = ask.answer !== null && !ask.options.includes(ask.answer) ? ask.answer : null;
  return (
    <div className="space-y-1.5 px-3 py-2 text-[calc(11rem/14)]">
      <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground">
        {ask.question}
      </p>
      {(ask.options.length > 0 || custom !== null) && (
        <ul className="space-y-0.5">
          {ask.options.map((option) => (
            <Choice key={option} selected={option === ask.answer} text={option} />
          ))}
          {custom !== null && (
            <Choice
              selected
              text={custom}
              label={ask.options.length > 0 && !ask.autoSelected ? t('Custom answer') : undefined}
            />
          )}
        </ul>
      )}
      {ask.autoSelected && (
        <p className="text-muted-foreground">{t('No answer in time; the default was selected')}</p>
      )}
      {waiting && ask.answer === null && (
        <p className="text-muted-foreground">{t('Waiting for your answer')}</p>
      )}
    </div>
  );
}

function Choice({ selected, text, label }: { selected: boolean; text: string; label?: string }) {
  const { t } = useI18n();
  const Icon = selected ? CircleCheck : Circle;
  return (
    <li
      data-selected={selected || undefined}
      className={cn(
        'flex items-start gap-1.5 rounded-md px-2 py-1 leading-relaxed',
        selected ? 'bg-primary/10 text-foreground' : 'text-muted-foreground'
      )}
    >
      <Icon
        className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', selected ? 'text-primary' : 'opacity-40')}
      />
      <span className="min-w-0 whitespace-pre-wrap break-words">
        {label && <span className="mr-1.5 text-muted-foreground">{label}</span>}
        {text}
      </span>
      {selected && <span className="sr-only">{t('Selected')}</span>}
    </li>
  );
}
