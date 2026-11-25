import { filterSlashSubcommands } from '@shared/slashSubcommands';
import { ChevronRight, CornerDownLeft, Terminal, X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { Kbd } from '@/components/ui/kbd';
import { type TFunction, useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { ComposerCommandIcon } from './ComposerCommandIcon';
import {
  COMMAND_PROMPTS,
  type ComposerCommand,
  commandGroup,
  isVettaCommand,
  SESSION_COMMAND_DETAILS,
} from './composerCommands';

export function commandLabel(command: ComposerCommand, t: TFunction): string {
  if (isVettaCommand(command)) return t('Vetta Design');
  if (command.prompt) return t(COMMAND_PROMPTS[command.prompt].label);
  const session = SESSION_COMMAND_DETAILS[command.name];
  return session ? t(session.label) : command.name.replace(/^\/skill:/, '');
}

const GROUPS = ['System built-ins', 'Session commands', 'Project skills'] as const;

export function ComposerCommandTray({
  id,
  items,
  activeIndex,
  maxHeight,
  skillOnly,
  parentCommand,
  onPreview,
  onConfirm,
  onClose,
}: {
  id: string;
  items: readonly ComposerCommand[];
  activeIndex: number;
  maxHeight?: number;
  skillOnly: boolean;
  parentCommand?: string | null;
  onPreview(index: number): void;
  onConfirm(index: number): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // Read the rendered container-query state rather than duplicating its breakpoint in JS.
  const previewHidden = () =>
    previewRef.current && getComputedStyle(previewRef.current).display === 'none';
  const optionId = `${id}-${activeIndex}`;
  useLayoutEffect(() => {
    const list = listRef.current;
    const selected = document.getElementById(optionId);
    if (!list || !selected) return;
    const viewport = list.getBoundingClientRect();
    const row = selected.getBoundingClientRect();
    if (row.top < viewport.top) list.scrollTop -= viewport.top - row.top;
    if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom;
  }, [optionId]);
  const active = items[activeIndex];
  const label = parentCommand
    ? t('Command options')
    : t(skillOnly ? 'Skills' : 'Commands and skills');
  const groups = (parentCommand ? [label] : GROUPS.map((group) => t(group))).map(
    (name, groupIndex) => ({
      name,
      options: items.flatMap((item, index) =>
        parentCommand || commandGroup(item) === groupIndex ? [{ item, index }] : []
      ),
    })
  );
  const prompt = active?.prompt ? COMMAND_PROMPTS[active.prompt] : undefined;
  const session = active && SESSION_COMMAND_DETAILS[active.name];
  const detailTitle = active && commandLabel(active, t);
  const detailDescription =
    active &&
    t(
      isVettaCommand(active)
        ? 'Design editable interfaces, slides, and interactive prototypes on the Vetta canvas.'
        : (prompt?.description ?? session?.description ?? active.description)
    );
  const usage =
    active &&
    (prompt?.usage ??
      session?.usage ??
      (parentCommand ? `${parentCommand} ${active.name}` : active.name));
  const options = session?.options?.map((name) => ({
    name,
    description:
      filterSlashSubcommands(active?.name ?? null, name)[0]?.description ?? 'Exit plan mode',
  }));

  return (
    <section
      aria-label={label}
      data-slot="composer-command-tray"
      style={maxHeight ? { maxHeight: `min(${maxHeight}px, 488px, 58vh)` } : undefined}
      className="@container absolute inset-x-0 bottom-[calc(100%-1px)] z-10 flex max-h-[min(488px,58vh)] min-w-0 flex-col overflow-hidden rounded-t-xl border border-b-0 border-border bg-card text-card-foreground shadow-float"
    >
      <header className="flex h-[calc(46rem/14)] shrink-0 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2 font-semibold">
          <Terminal
            aria-hidden="true"
            className="size-[calc(15rem/14)] shrink-0 text-muted-foreground"
          />
          <span className="truncate">{label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{t('{{count}} results', { count: items.length })}</span>
          <button
            type="button"
            aria-label={t('Close')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClose}
            className="grid size-7 place-items-center rounded-md hover:bg-accent hover:text-foreground"
          >
            <X aria-hidden="true" className="size-[calc(15rem/14)]" />
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] border-y border-border/75 @min-[440px]:grid-cols-[minmax(0,46fr)_minmax(0,54fr)]">
        <div
          ref={listRef}
          id={id}
          role="listbox"
          aria-label={label}
          className="scroll-pill min-h-0 overflow-y-auto overscroll-contain px-2 py-2"
        >
          {groups
            .filter((group) => group.options.length > 0)
            .map((group) => (
              <div
                key={group.name}
                role="group"
                aria-label={group.name}
                className="mb-1.5 last:mb-0"
              >
                <p
                  aria-hidden="true"
                  className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  {group.name}
                </p>
                {group.options.map(({ item, index }) => {
                  const selected = index === activeIndex;
                  const builtIn = commandGroup(item) === 0;
                  const name = commandLabel(item, t);
                  return (
                    <button
                      key={`${item.prompt ?? 'command'}:${item.name}`}
                      id={`${id}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (previewHidden()) onConfirm(index);
                        else onPreview(index);
                      }}
                      onDoubleClick={() => {
                        if (!previewHidden()) onConfirm(index);
                      }}
                      className={cn(
                        'flex min-h-[calc(32rem/14)] w-full items-center gap-2 rounded-[7px] px-2.5 text-left',
                        selected ? 'bg-brand/12 text-foreground' : 'hover:bg-accent'
                      )}
                    >
                      <span className="grid w-[calc(20rem/14)] shrink-0 place-items-center">
                        <ComposerCommandIcon command={item} />
                      </span>
                      {builtIn ? (
                        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                      ) : (
                        <code className="min-w-0 flex-1 truncate text-[calc(12rem/14)] font-medium">
                          {skillOnly ? `$${name}` : item.name}
                        </code>
                      )}
                      {builtIn && (
                        <span className="hidden shrink-0 text-xs text-muted-foreground @min-[600px]:block">
                          {t(item.prompt ? 'Capability' : 'Skill')}
                        </span>
                      )}
                      {!builtIn && SESSION_COMMAND_DETAILS[item.name] && (
                        <span className="hidden max-w-[50%] truncate text-xs text-muted-foreground @min-[600px]:block">
                          {name}
                        </span>
                      )}
                      <ChevronRight
                        aria-hidden="true"
                        className={cn(
                          'hidden size-3.5 shrink-0 text-muted-foreground @min-[440px]:block',
                          !selected && 'invisible'
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            ))}
          {!items.length && (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">{t('No matching commands')}</p>
          )}
        </div>

        <div
          ref={previewRef}
          data-command-preview=""
          className="scroll-pill hidden min-h-0 min-w-0 flex-col gap-2 overflow-y-auto border-l border-border/75 bg-muted/25 p-4 @min-[440px]:flex"
        >
          {active ? (
            <>
              <h3 className="min-w-0 text-[calc(20rem/14)] leading-tight font-semibold wrap-anywhere">
                {detailTitle}
              </h3>
              <p
                className="line-clamp-3 text-sm leading-relaxed text-muted-foreground"
                title={detailDescription}
              >
                {detailDescription}
              </p>
              <div className="flex items-baseline gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-xs">
                <span className="shrink-0 text-muted-foreground">{t('Command usage')}</span>
                {prompt ? (
                  <span>{t(prompt.usage)}</span>
                ) : (
                  <code className="wrap-anywhere">{usage}</code>
                )}
              </div>
              {options && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2.5 text-xs">
                  {options.map(({ name, description }) => (
                    <div key={name} className="contents">
                      <dt>
                        <code>{name}</code>
                      </dt>
                      <dd className="text-muted-foreground">{t(description)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="mt-auto flex justify-end pt-1">
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onConfirm(activeIndex)}
                  className="inline-flex min-h-[calc(30rem/14)] items-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs font-medium text-inverse-foreground hover:bg-foreground/85"
                >
                  {t(prompt ? 'Insert prompt' : 'Insert command')}
                  <CornerDownLeft aria-hidden="true" className="size-3.5" />
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('Type in the message field to filter commands.')}
            </p>
          )}
        </div>
      </div>

      <footer className="hidden h-[calc(36rem/14)] shrink-0 items-center gap-3 border-b border-border/75 px-4 text-xs text-muted-foreground @min-[440px]:flex">
        <span className="inline-flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          {t('Navigate')}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>↵</Kbd>
          {t(parentCommand ? 'Send' : 'Insert command')}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Esc</Kbd>
          {t('Close')}
        </span>
      </footer>
    </section>
  );
}
