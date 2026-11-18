import { ArrowUpRight, Bug, Compass, FlaskConical, History, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/i18n';

const SUGGESTIONS: { icon: LucideIcon; title: string; hint: string; prompt: string }[] = [
  {
    icon: Compass,
    title: 'Map the project',
    hint: 'Entry points, modules and key dependencies',
    prompt:
      "Walk me through this project's structure: entry points, module layout and key dependencies.",
  },
  {
    icon: Bug,
    title: 'Find potential issues',
    hint: 'Suspicious logic and unhandled edge cases',
    prompt:
      'Review this project for potential bugs, suspicious logic and unhandled edge cases, and list them by severity.',
  },
  {
    icon: FlaskConical,
    title: 'Add unit tests',
    hint: 'Cover the core modules with tests',
    prompt: 'Find the core modules that lack tests and add unit tests for them.',
  },
  {
    icon: History,
    title: 'Summarize recent changes',
    hint: 'A digest based on git log',
    prompt: 'Summarize the recent changes in this repository based on git log.',
  },
];

/** 空会话的建议卡片：点击把对应提示词填进输入框，由用户确认后发送 */
export function WelcomeSuggestions({ onPick }: { onPick: (prompt: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid w-full grid-cols-1 gap-[10px] text-left @min-[36rem]:grid-cols-2">
      {SUGGESTIONS.map(({ icon: Icon, title, hint, prompt }) => (
        <button
          key={title}
          type="button"
          onClick={() => onPick(t(prompt))}
          data-slot="welcome-suggestion"
          className="group relative flex min-h-[calc(72rem/14)] items-start gap-[calc(11rem/14)] overflow-hidden rounded-[calc(13rem/14)] border border-border/70 bg-secondary/35 px-[calc(12rem/14)] py-[calc(11rem/14)] pr-[calc(34rem/14)] text-left transition-[border-color,background-color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] hover:-translate-y-[1px] hover:border-foreground/15 hover:bg-card hover:shadow-sm focus-visible:border-brand/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          <span
            data-slot="welcome-suggestion-icon"
            className="flex size-[calc(30rem/14)] shrink-0 items-center justify-center rounded-[calc(9rem/14)] bg-card text-brand shadow-[inset_0_0_0_1px_var(--color-border)] transition-[color,background-color] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] group-hover:bg-brand/8 motion-reduce:transition-none"
          >
            <Icon className="size-[calc(14.5rem/14)]" />
          </span>
          <span className="min-w-0 pt-[calc(1rem/14)]">
            <span className="block text-[calc(13rem/14)] font-medium">{t(title)}</span>
            <span className="mt-[calc(2rem/14)] block text-[calc(11rem/14)] leading-[calc(18rem/14)] text-muted-foreground">
              {t(hint)}
            </span>
          </span>
          <ArrowUpRight
            aria-hidden="true"
            className="absolute top-[calc(12rem/14)] right-[calc(11rem/14)] size-[calc(13rem/14)] -translate-x-[2px] translate-y-[2px] text-muted-foreground opacity-0 transition-[opacity,transform] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transition-none"
          />
        </button>
      ))}
    </div>
  );
}
