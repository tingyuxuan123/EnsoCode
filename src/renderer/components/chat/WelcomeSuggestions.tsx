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
          className="group relative flex min-h-[calc(68rem/14)] items-center gap-[calc(12rem/14)] overflow-hidden rounded-xl border border-border/80 bg-card/90 px-[calc(14rem/14)] py-[calc(12rem/14)] pr-[calc(34rem/14)] text-left shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-[border-color,background-color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] hover:-translate-y-[1px] hover:border-foreground/20 hover:bg-card hover:shadow-[0_4px_12px_-4px_rgb(0_0_0/0.08)] active:translate-y-0 active:scale-[0.995] focus-visible:border-brand/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-card/70 dark:shadow-none dark:hover:border-foreground/22 dark:hover:bg-card dark:hover:shadow-[0_6px_16px_-6px_rgb(0_0_0/0.45)] motion-reduce:transition-none motion-reduce:active:scale-100 motion-reduce:hover:translate-y-0"
        >
          <span
            data-slot="welcome-suggestion-icon"
            className="flex size-[calc(34rem/14)] shrink-0 items-center justify-center rounded-lg bg-brand/[0.08] text-brand ring-1 ring-brand/15 ring-inset transition-[background-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] group-hover:bg-brand/[0.14] group-hover:ring-brand/25 motion-reduce:transition-none"
          >
            <Icon className="size-[calc(16rem/14)] stroke-[1.75]" />
          </span>
          <span className="min-w-0">
            <span className="block font-medium text-[calc(13rem/14)] text-foreground leading-[calc(18rem/14)]">
              {t(title)}
            </span>
            <span className="mt-[calc(2rem/14)] block text-[calc(12rem/14)] text-muted-foreground leading-[calc(17rem/14)]">
              {t(hint)}
            </span>
          </span>
          <ArrowUpRight
            aria-hidden="true"
            className="absolute top-1/2 right-[calc(12rem/14)] size-[calc(14rem/14)] -translate-x-[3px] -translate-y-1/2 text-muted-foreground opacity-0 transition-[opacity,transform] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] group-hover:translate-x-0 group-hover:opacity-75 group-focus-visible:translate-x-0 group-focus-visible:opacity-75 motion-reduce:transition-none"
          />
        </button>
      ))}
    </div>
  );
}
