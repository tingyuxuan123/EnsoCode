import type { MentionCandidate } from '@shared/types/mentions';
import { Bot, ChevronRight, History, Users } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { FileTypeIcon } from '@/components/sidepanel/fileIcons';
import { Badge } from '@/components/ui/badge';
import {
  flattenMentionRoot,
  type MentionFolderId,
  type MentionSearchGroups,
} from '@/hooks/useMentionSearch';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { distinguishingPathLabels } from './mentionPathLabel';
import {
  type ChatMentionMeta,
  formatChatMentionMeta,
  mentionFileParentPath,
} from './mentionPickerDisplay';

type FolderId = MentionFolderId;

interface MentionPickerProps {
  groups: MentionSearchGroups;
  query: string;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  openFolderId: FolderId | null;
  folderIndex: number;
  onOpenFolderIdChange: (id: FolderId | null) => void;
  onFolderIndexChange: (index: number) => void;
  onSelect: (candidate: MentionCandidate) => void;
  chatMeta?: ReadonlyMap<string, ChatMentionMeta>;
  id?: string;
  /** 整张卡片相对输入框容器的 left */
  left?: number;
  /** 二级列宽；聊天栏窄时收窄，避免整张卡片挤出聊天栏 */
  flyoutWidth?: number;
  /** 输入框上方真实可用的高度；不给就用样式里的默认上限。 */
  maxHeight?: number;
}

const OPTION_ROW_CLASS =
  'flex w-full rounded-[7px] px-2.5 py-1.5 text-left transition-colors duration-75';

export function MentionPicker({
  groups,
  query,
  activeIndex,
  onActiveIndexChange,
  openFolderId,
  folderIndex,
  onOpenFolderIdChange,
  onFolderIndexChange,
  onSelect,
  chatMeta,
  maxHeight,
  id = 'composer-mention-picker',
  left = 0,
  flyoutWidth,
}: MentionPickerProps) {
  const { t, locale } = useI18n();
  const items = useMemo(() => flattenMentionRoot(groups, query), [groups, query]);
  const filePathLabels = useMemo(
    () => distinguishingPathLabels(groups.files.map((file) => file.relativePath)),
    [groups.files]
  );
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());
  const subRefs = useRef(new Map<number, HTMLButtonElement>());
  const nested = items[0]?.type === 'folder';

  useEffect(() => {
    optionRefs.current.get(activeIndex)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    if (!openFolderId) return;
    subRefs.current.get(folderIndex)?.scrollIntoView({ block: 'nearest' });
  }, [openFolderId, folderIndex]);

  if (items.length === 0) return null;
  const folderLabels: Record<FolderId, string> = {
    agents: t('Agents'),
    members: t('Members'),
    chats: t('Chats'),
  };
  const folderIcons: Record<FolderId, typeof Bot> = { agents: Bot, members: Users, chats: History };
  const folderItems = openFolderId ? groups[openFolderId] : [];
  const heightStyle = maxHeight === undefined ? undefined : { maxHeight };
  let flatIndex = 0;

  const renderGroup = (group: FolderId | 'files', pad: boolean) => {
    const candidates = groups[group];
    if (candidates.length === 0) return null;
    const label = group === 'files' ? t('Files') : folderLabels[group as FolderId];
    return (
      <div
        role="group"
        aria-label={label}
        className={cn(pad && 'mt-1.5 border-t border-border/50 pt-1.5')}
      >
        <p className="px-2.5 pt-1 pb-1 font-medium text-[calc(11rem/14)] text-muted-foreground/80">
          {label}
        </p>
        {candidates.map((candidate) => {
          const index = flatIndex++;
          return (
            <MentionOption
              key={`${group}:${candidate.id}`}
              ref={(node) => {
                if (node) optionRefs.current.set(index, node);
                else optionRefs.current.delete(index);
              }}
              id={`${id}-option-${index}`}
              candidate={candidate}
              active={index === activeIndex}
              pathLabel={
                candidate.kind === 'file' ? filePathLabels.get(candidate.relativePath) : undefined
              }
              chatMeta={candidate.kind === 'chat' ? chatMeta?.get(candidate.id) : undefined}
              locale={locale ?? 'en'}
              onHover={() => {
                onActiveIndexChange(index);
                if (nested) onOpenFolderIdChange(null);
              }}
              onSelect={() => onSelect(candidate)}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div
      data-slot="mention-picker"
      style={{ left, ...heightStyle }}
      className="absolute bottom-full z-10 mb-2 flex max-w-[calc(100vw-16px)] overflow-hidden rounded-[10px] border border-border/80 bg-popover text-popover-foreground shadow-float"
    >
      <div
        id={id}
        role="listbox"
        aria-label={t('Mention suggestions')}
        style={heightStyle}
        className={cn(
          'scroll-pill max-h-72 max-w-full shrink-0 overflow-y-auto p-1.5',
          nested ? 'w-64' : 'w-[344px]'
        )}
      >
        {nested ? (
          <>
            {items
              .filter((item): item is { type: 'folder'; id: FolderId } => item.type === 'folder')
              .map((folder) => {
                const index = flatIndex++;
                const Icon = folderIcons[folder.id];
                const active = activeIndex === index;
                const count = groups[folder.id].length;
                return (
                  <button
                    key={`folder:${folder.id}`}
                    ref={(node) => {
                      if (node) optionRefs.current.set(index, node);
                      else optionRefs.current.delete(index);
                    }}
                    id={`${id}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onActiveIndexChange(index);
                      onOpenFolderIdChange(folder.id);
                      onFolderIndexChange(0);
                    }}
                    onMouseMove={() => {
                      onActiveIndexChange(index);
                      if (openFolderId !== folder.id) {
                        onOpenFolderIdChange(folder.id);
                        onFolderIndexChange(0);
                      }
                    }}
                    className={cn(
                      OPTION_ROW_CLASS,
                      'items-center gap-2.5',
                      active && 'bg-foreground/[0.075]'
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        active ? 'text-foreground' : 'text-muted-foreground'
                      )}
                      strokeWidth={1.75}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-[calc(13rem/14)]">
                      {folderLabels[folder.id]}
                    </span>
                    <span className="shrink-0 text-[calc(11rem/14)] text-muted-foreground/75 tabular-nums">
                      {count}
                    </span>
                    <ChevronRight
                      className={cn(
                        'size-3.5 shrink-0',
                        active ? 'text-foreground/80' : 'text-muted-foreground/60'
                      )}
                      strokeWidth={1.75}
                    />
                  </button>
                );
              })}
            {renderGroup('files', true)}
          </>
        ) : (
          <>
            {renderGroup('agents', false)}
            {renderGroup('members', groups.agents.length > 0)}
            {renderGroup('chats', groups.agents.length + groups.members.length > 0)}
            {renderGroup(
              'files',
              groups.agents.length + groups.members.length + groups.chats.length > 0
            )}
          </>
        )}
      </div>
      {openFolderId && folderItems.length > 0 && (
        <div
          data-slot="mention-flyout"
          style={{
            ...(flyoutWidth === undefined ? {} : { width: flyoutWidth }),
            ...heightStyle,
          }}
          className="flex max-h-72 w-[316px] shrink-0 flex-col border-l border-border/60 bg-muted/25"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border/45 px-3 py-2 font-medium text-[calc(11rem/14)] text-muted-foreground">
            <span className="truncate">{folderLabels[openFolderId]}</span>
            <span className="shrink-0 text-muted-foreground/75 tabular-nums">
              {folderItems.length}
            </span>
          </div>
          <div
            role="listbox"
            aria-label={folderLabels[openFolderId]}
            className="scroll-pill min-h-0 flex-1 overflow-y-auto p-1.5"
          >
            {folderItems.map((candidate, index) => (
              <MentionOption
                key={`sub:${candidate.id}`}
                ref={(node) => {
                  if (node) subRefs.current.set(index, node);
                  else subRefs.current.delete(index);
                }}
                id={`${id}-sub-${index}`}
                candidate={candidate}
                active={index === folderIndex}
                inFlyout
                chatMeta={candidate.kind === 'chat' ? chatMeta?.get(candidate.id) : undefined}
                locale={locale ?? 'en'}
                onHover={() => onFolderIndexChange(index)}
                onSelect={() => onSelect(candidate)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MentionOption({
  ref,
  id,
  candidate,
  active,
  inFlyout = false,
  pathLabel,
  chatMeta,
  locale,
  onHover,
  onSelect,
}: {
  id: string;
  ref: React.Ref<HTMLButtonElement>;
  candidate: MentionCandidate;
  active: boolean;
  inFlyout?: boolean;
  pathLabel?: string;
  chatMeta?: ChatMentionMeta;
  locale: string;
  onHover: () => void;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const directory = isDirectoryMention(candidate);

  const fileParentPath =
    candidate.kind === 'file'
      ? mentionFileParentPath(candidate.label, pathLabel, candidate.relativePath)
      : undefined;
  const chatMetaLabel =
    candidate.kind === 'chat'
      ? formatChatMentionMeta({ candidate, meta: chatMeta, locale })
      : undefined;
  const subtitle =
    candidate.kind === 'agent-type'
      ? candidate.source === 'bot'
        ? candidate.description
        : t(candidate.description)
      : candidate.kind === 'file'
        ? fileParentPath
        : candidate.kind === 'ui-element'
          ? candidate.path
          : undefined;

  const twoLine = Boolean(subtitle);
  const iconTone = active ? 'text-foreground' : 'text-muted-foreground';

  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      title={candidate.kind === 'file' ? candidate.relativePath : undefined}
      onClick={onSelect}
      // onMouseMove 而非 onMouseEnter：键盘导航的 scrollIntoView 会让项目从静止的
      // 物理光标下滑过，Chrome 重算 hover 触发 mouseenter 会把高亮拽回光标处；
      // mousemove 只在物理移动时触发，不和键盘打架。
      onMouseMove={onHover}
      className={cn(
        OPTION_ROW_CLASS,
        twoLine ? 'items-start gap-2.5' : 'items-center gap-2.5',
        // 浅色主题下 popover(纯白)与 muted 亮度差仅 0.035，高亮几乎不可见；
        // 用前景色衍生的透明度保证两种主题都有对比度。
        active && 'bg-foreground/[0.075]'
      )}
    >
      {candidate.kind === 'file' ? (
        <FileTypeIcon
          name={candidate.relativePath}
          isDir={directory}
          className={cn('size-4 shrink-0', twoLine && 'mt-0.5')}
        />
      ) : candidate.kind === 'chat' ? (
        <History className={cn('size-4 shrink-0', iconTone)} strokeWidth={1.75} />
      ) : candidate.kind === 'agent-type' && candidate.source === 'bot' ? (
        <Users
          className={cn('size-4 shrink-0', iconTone, twoLine && 'mt-0.5')}
          strokeWidth={1.75}
        />
      ) : (
        <Bot className={cn('size-4 shrink-0', iconTone, twoLine && 'mt-0.5')} strokeWidth={1.75} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate font-medium text-[calc(13rem/14)]">
            {candidate.label}
          </span>
          {candidate.kind === 'agent-type' && !(inFlyout && candidate.source === 'bot') && (
            <Badge variant="secondary" size="sm">
              {t(
                candidate.source === 'system'
                  ? 'System'
                  : candidate.source === 'builtin'
                    ? 'Built-in'
                    : candidate.source === 'bot'
                      ? 'Member'
                      : 'Custom'
              )}
            </Badge>
          )}
          {candidate.kind === 'agent-type' && candidate.locked && (
            <Badge variant="warning" size="sm">
              {t('Locked')}
            </Badge>
          )}
        </span>
        {subtitle && (
          <span
            data-mention-sub=""
            className="mt-0.5 block truncate text-[calc(11rem/14)] text-muted-foreground/80"
          >
            {subtitle}
          </span>
        )}
      </span>
      {chatMetaLabel && (
        <span
          data-mention-meta=""
          className="shrink-0 text-[calc(11rem/14)] text-muted-foreground/80 tabular-nums"
        >
          {chatMetaLabel}
        </span>
      )}
    </button>
  );
}

function isDirectoryMention(candidate: MentionCandidate): boolean {
  return candidate.kind === 'file' && /[\\/]$/.test(candidate.relativePath);
}
