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
      className="@container absolute inset-x-0 bottom-[calc(100%-1px)] z-10 flex h-[calc(320rem/14)] max-h-[min(488px,58vh)] min-w-0 flex-col overflow-hidden rounded-t-xl border border-b-0 border-brand/60 bg-card text-card-foreground shadow-float"
    >
      {/* 头部：不画分隔线，靠留白分层 */}
      <header className="flex h-[calc(42rem/14)] shrink-0 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Terminal
            aria-hidden="true"
            className="size-[calc(14rem/14)] shrink-0 text-muted-foreground"
          />
          <span className="truncate text-[calc(12.5rem/14)] font-semibold">{label}</span>
          <span className="shrink-0 rounded-[4px] bg-secondary px-1.5 py-px text-[calc(10.5rem/14)] text-muted-foreground tabular-nums">
            {items.length}
          </span>
        </div>
        <button
          type="button"
          aria-label={t('Close')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClose}
          className="grid size-6 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X aria-hidden="true" className="size-[calc(13rem/14)]" />
        </button>
      </header>

      {/* 左栏可滚动，右栏固定：高度锁在 320，列表自己滚 */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] @min-[440px]:grid-cols-[minmax(0,44fr)_minmax(0,56fr)]">
        <div
          ref={listRef}
          id={id}
          role="listbox"
          aria-label={label}
          className="scroll-pill min-h-0 overflow-y-auto overscroll-contain px-2 pt-1 pb-2"
        >
          {groups
            .filter((group) => group.options.length > 0)
            .map((group) => (
              <div key={group.name} role="group" aria-label={group.name} className="mb-2 last:mb-0">
                <p
                  aria-hidden="true"
                  className="px-2 pb-0.5 text-[calc(10.5rem/14)] font-medium tracking-wide text-muted-foreground/60 uppercase"
                >
                  {group.name}
                </p>
                {group.options.map(({ item, index }) => {
                  const selected = index === activeIndex;
                  const builtIn = commandGroup(item) === 0;
                  const name = commandLabel(item, t);
                  const tag = builtIn
                    ? t(item.prompt ? 'Capability' : 'Skill')
                    : SESSION_COMMAND_DETAILS[item.name]
                      ? name
                      : undefined;
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
                        // 选中不整条染色：左侧一根 2px 强调条 + 极淡底，扫读时更容易定位
                        'relative flex h-[calc(30rem/14)] w-full items-center gap-2 rounded-[6px] px-2 text-left',
                        selected ? 'bg-selection text-selection-foreground' : 'hover:bg-accent'
                      )}
                    >
                      {selected && (
                        <span
                          aria-hidden="true"
                          className="absolute top-1/2 left-0 h-[calc(14rem/14)] w-[2px] -translate-y-1/2 rounded-full bg-brand"
                        />
                      )}
                      <span className="grid w-[calc(20rem/14)] shrink-0 place-items-center">
                        <ComposerCommandIcon command={item} />
                      </span>
                      {builtIn ? (
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-[calc(13rem/14)]',
                            selected ? 'font-medium' : 'text-foreground/75'
                          )}
                        >
                          {name}
                        </span>
                      ) : (
                        <code
                          className={cn(
                            'min-w-0 flex-1 truncate font-sans text-[calc(13rem/14)]',
                            selected ? 'font-medium' : 'text-foreground/75'
                          )}
                        >
                          {skillOnly ? `$${name}` : item.name}
                        </code>
                      )}
                      {tag && (
                        <span className="hidden shrink-0 rounded-[3px] bg-secondary px-1.5 py-px text-[calc(10rem/14)] text-muted-foreground @min-[600px]:block">
                          {tag}
                        </span>
                      )}
                      <ChevronRight
                        aria-hidden="true"
                        className={cn(
                          'hidden size-3 shrink-0 text-brand @min-[440px]:block',
                          !selected && 'invisible'
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            ))}
          {!items.length && (
            <p className="px-2 py-2 text-sm text-muted-foreground">{t('No matching commands')}</p>
          )}
        </div>

        {/* 右栏：当前项的说明书，不跟随左栏滚动 */}
        <div
          ref={previewRef}
          data-command-preview=""
          className="scroll-pill hidden min-h-0 min-w-0 flex-col gap-3 overflow-y-auto bg-muted/25 p-4 @min-[440px]:flex"
        >
          {active ? (
            <>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 grid size-[calc(26rem/14)] shrink-0 place-items-center rounded-[7px] bg-brand/12">
                  <ComposerCommandIcon command={active} />
                </span>
                <div className="min-w-0">
                  <h3 className="min-w-0 text-[calc(15rem/14)] leading-tight font-semibold wrap-anywhere">
                    {detailTitle}
                  </h3>
                  <p
                    className="mt-1 line-clamp-3 text-[calc(12rem/14)] leading-relaxed text-muted-foreground"
                    title={detailDescription}
                  >
                    {detailDescription}
                  </p>
                </div>
              </div>

              {/* 用法：底色块而不是边框盒，少一个方框 */}
              <div className="rounded-[8px] bg-card/70 px-2.5 py-2">
                <div className="mb-1 text-[calc(10.5rem/14)] text-muted-foreground/60">
                  {t('Command usage')}
                </div>
                {prompt ? (
                  <span className="text-[calc(11.5rem/14)]">{t(prompt.usage)}</span>
                ) : (
                  <code className="font-mono text-[calc(11.5rem/14)] wrap-anywhere">{usage}</code>
                )}
              </div>
              {options && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[calc(11.5rem/14)]">
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
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span className="min-w-0 truncate text-[calc(10.5rem/14)] text-muted-foreground/60">
                  {parentCommand
                    ? t('Command options')
                    : commandGroup(active) === 0
                      ? t(active.prompt ? 'Capability' : 'Skill')
                      : commandGroup(active) === 2
                        ? t('Skill')
                        : t('Session commands')}
                </span>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onConfirm(activeIndex)}
                  className="inline-flex h-[calc(28rem/14)] items-center gap-1.5 rounded-[6px] bg-brand px-2.5 text-[calc(12rem/14)] font-medium text-brand-foreground hover:bg-brand/90"
                >
                  {t(prompt ? 'Insert prompt' : 'Insert command')}
                  <CornerDownLeft aria-hidden="true" className="size-3" />
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

      {/* 底部快捷键：只留最必要的三个 */}
      <footer className="hidden h-[calc(32rem/14)] shrink-0 items-center gap-3 border-t border-border/50 px-4 text-[calc(11rem/14)] text-muted-foreground @min-[440px]:flex">
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
        <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground/50">
          {t('Type in the message field to filter commands.')}
        </span>
      </footer>
    </section>
  );
}
