import { useDroppable } from '@dnd-kit/core';
import { unbindImages } from '@shared/browser/designMode';
import {
  PASTED_TEXT_FILE_NAME,
  type PastedTextFileResult,
  pastedTextFileContent,
} from '@shared/pastedText';
import { filterSlashSubcommands, slashSubcommandQuery } from '@shared/slashSubcommands';
import type { AttachedImage, SlashCommand } from '@shared/types/agent';
import type {
  AgentTypeMentionCandidate,
  ChatMentionCandidate,
  MentionCandidate,
  UiElementMentionCandidate,
} from '@shared/types/mentions';
import type { StartVoiceSession } from '@shared/types/speech';
import { ArrowUp, CircleStop, ImagePlus, Plus, SlashSquare, Square, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { addToast } from '@/components/ui/toast';
import {
  flattenMentionRoot,
  type MentionFolderId,
  useMentionSearch,
} from '@/hooks/useMentionSearch';
import { useI18n } from '@/i18n';
import { effectiveKeybindings, eventToBinding, formatBinding } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import {
  pluginCommandFor,
  pluginCommands,
  runPluginCommand,
  usePluginSlashCommands,
} from '@/plugins/commands';
import { resolvePluginKeybindings } from '@/plugins/keybindings';
import { PluginStatusItems } from '@/plugins/statusItems';
import { hasPendingDeviceAccess, usePendingDeviceAccess } from '@/stores/deviceAccess';
import { useSettingsStore } from '@/stores/settings';
import { registerDraftTarget } from '../../plugins/draftBridge';
import { PluginComposerSlots } from '../../plugins/slots';
import {
  type PluginCandidate,
  pickPluginCandidate,
  usePluginTriggerCandidates,
} from '../../plugins/triggers';
import { composerDrafts as drafts } from './composerDraft';
import {
  registerComposerFocus,
  registerComposerInsert,
  registerComposerInsertBlocker,
  registerComposerInsertImage,
  registerComposerInsertText,
  registerComposerInsertUiElement,
  registerComposerInsertUiElements,
} from './composerMentionBridge';
import { COMPOSER_DROP_ID } from './dragDrop';
import { HoldToTalk, HoldToTalkToggle } from './HoldToTalk';
import { applyInjectedDraft } from './injectedDraft';
import { MentionChip } from './MentionChip';
import { MentionEditor, type MentionEditorHandle, type MentionEditorState } from './MentionEditor';
import { MentionPicker } from './MentionPicker';
import { requestOpenChatModelPicker } from './ModelPicker';
import type { ComposerPayload, MentionSegment } from './mentionComposer';
import {
  createEditorPayload,
  mentionPopupLayout,
  mentionPopupMaxHeight,
  resolvePopupKeyAction,
} from './mentionComposer';
import { SlashChip } from './SlashChip';
import { filterComposerCommands } from './skillCompletion';
import { appendSlash, foldLeadingSkills, removeSlash, slashChain } from './slashChain';
import { VoiceInputButton } from './VoiceInputButton';

// 弹窗挂在输入框上方、向上长：mb-1.5 的 6px 间隙 + 窗口顶部留一点呼吸空间。
const MENTION_POPUP_MARGIN = 14;
/** 与 CSS max-h-72 对齐的默认上限；屏幕再高也不做无限长的菜单。 */
const MENTION_POPUP_CAP = 288;
/** 一级与二级之间的间距（ml-1）。 */
const MENTION_FLYOUT_GAP = 4;
/** 二级列的目标宽度（w-72）；聊天栏窄时按需要收窄，但不低于最小可读宽度。 */
const MENTION_FLYOUT_WIDTH = 288;
const MENTION_FLYOUT_MIN_WIDTH = 180;

interface ComposerProps {
  /** Phone keeps the shared draft/command pipeline, with a separate round send action. */
  appearance?: 'default' | 'phone';
  cwd?: string;
  commands: SlashCommand[];
  running: boolean;
  busy: boolean;
  focusKey?: string;
  /** Local session only. Remote and bot draft keys are not device-access identities. */
  deviceAccessSessionId?: string;
  presetId?: string;
  /** 挂载/切会话时是否自动聚焦。移动端置 false，否则一进会话就弹出键盘挡住内容 */
  autoFocus?: boolean;
  /**
   * Enter 是否发送（默认 true，桌面习惯）。移动端置 false：软键盘的「换行」
   * 也是 Enter keydown，默认行为会把换行变成误发送；此时只能点发送按钮。
   */
  enterToSend?: boolean;
  /** 底部工具行左侧插槽（模型选择器等） */
  toolbar?: React.ReactNode;
  locked?: boolean;
  /** Host-owned, single prompt reference; sent only after the normal composer gate. */
  attachment?: { label: string; text: string; onRemove(): void; onConsumed(): void };
  injectedDraft?: string;
  injectedImages?: AttachedImage[];
  injectedDraftAppend?: boolean;
  onDraftConsumed?: () => void;
  initialRecipient?: AgentTypeMentionCandidate;
  onInitialRecipientConsumed?: () => void;
  /** @ 弹窗的过去会话候选（宿主从 sessions store 算好传入，保持本组件与 store 解耦） */
  chatCandidates?: ChatMentionCandidate[];
  /** 浏览不自动 spawn：用户开始打字/聚焦输入框时再拉 worker */
  onActivate?: () => void;
  onSend: (payload: ComposerPayload) => boolean | undefined | Promise<boolean | undefined>;
  onAbort: () => void;
  /** 排队消息数；运行中且输入为空时，发送快捷键改为 steer 队首一条 */
  queuedCount?: number;
  onSteerQueued?: () => void;
  /**
   * 侧栏旁路等第二输入框：不抢主 Composer 的 insert/focus 桥，也不吃侧栏拖放。
   * 主会话必须保持默认 false。
   */
  isolated?: boolean;
  /** 覆盖默认「Type @ …」占位；slash / locked / agent 文案仍优先 */
  placeholder?: string;
  /** Plan 模式：边框提示当前只读规划 */
  planMode?: boolean;
  /** 语音输入：给出即显示麦克风，边录边推 16kHz PCM；桌面走 IPC，手机走配对信道 */
  voice?: StartVoiceSession;
  /** 录音前向系统申请麦克风（macOS 需主进程发起） */
  requestMicAccess?: () => Promise<boolean>;
  /** hold = 手机微信式：麦克风切出输入框下方的「按住 说话」 */
  voiceMode?: 'click' | 'hold';
  /** 超长纯文本粘贴落盘为 txt；不传（如 ssh 项目）则保持插入正文 */
  savePastedText?: (text: string) => Promise<PastedTextFileResult>;
}

export function Composer({
  appearance = 'default',
  cwd,
  commands,
  running,
  busy,
  focusKey,
  deviceAccessSessionId,
  presetId,
  autoFocus = true,
  enterToSend = true,
  toolbar,
  locked: approvalLocked = false,
  attachment,
  injectedDraft,
  injectedImages,
  injectedDraftAppend,
  onDraftConsumed,
  initialRecipient,
  onInitialRecipientConsumed,
  chatCandidates,
  onActivate,
  onSend,
  onAbort,
  queuedCount = 0,
  onSteerQueued,
  isolated = false,
  placeholder: placeholderText,
  planMode = false,
  voice,
  requestMicAccess,
  voiceMode = 'click',
  savePastedText,
}: ComposerProps) {
  const { t } = useI18n();
  const pendingAccess = usePendingDeviceAccess(deviceAccessSessionId);
  const locked = approvalLocked || pendingAccess;
  // Each unlocked interval belongs to one draft. Retained callbacks (file reads,
  // transcription, plugin picks) must not write after a lock or session switch.
  const scope = useMemo(
    () => ({ focusKey, deviceAccessSessionId, pendingAccess }),
    [focusKey, deviceAccessSessionId, pendingAccess]
  );
  const activeScope = useRef<typeof scope | null>(scope);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      activeScope.current = null;
    };
  }, [scope]);
  const editBlocked = useCallback(
    () =>
      approvalLocked ||
      activeScope.current !== scope ||
      scope.pendingAccess ||
      Boolean(scope.deviceAccessSessionId && hasPendingDeviceAccess(scope.deviceAccessSessionId)),
    [approvalLocked, scope]
  );
  useLayoutEffect(() => {
    if (!isolated) return registerComposerInsertBlocker(editBlocked);
  }, [isolated, editBlocked]);
  const [holdToTalk, setHoldToTalk] = useState(false);
  // 断线重连时语音会短暂不可用：不清掉按住说话，恢复后原样回来
  const holdVoice = voiceMode === 'hold' ? voice : undefined;
  const keybindings = useSettingsStore((s) => s.keybindings);
  const sendBinding = effectiveKeybindings(keybindings)['send-message'];
  const voiceHoldBinding = effectiveKeybindings(keybindings)['voice-hold'];
  const mentionPickerId = useId();
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [slash, setSlash] = useState<string | null>(null);
  const draftStateRef = useRef({ images, slash });
  draftStateRef.current = { images, slash };
  const [recipient, setRecipient] = useState<AgentTypeMentionCandidate>();
  const prevFocusKeyRef = useRef<string | undefined>(undefined);
  const restoringDraft = useRef(false);
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);

  // 侧栏拖入(dnd-kit):会话/项目行落到输入区插 mention chip。
  // 与 OS 文件拖入(HTML5 dnd)互不干扰:两套事件体系独立。
  const { setNodeRef: setDropRef, isOver: dndOver } = useDroppable({
    id: isolated ? `isolated-composer:${focusKey ?? 'side'}` : COMPOSER_DROP_ID,
    disabled: isolated,
  });
  const [preview, setPreview] = useState<UiElementMentionCandidate | null>(null);
  const [imagePreview, setImagePreview] = useState<AttachedImage | null>(null);
  const boundIds = useRef(new Set<string>());
  useEffect(() => {
    if (isolated) return;
    const unsubInsert = registerComposerInsert((candidate) =>
      editorRef.current?.insertMention(candidate)
    );
    const unsubText = registerComposerInsertText((text) => editorRef.current?.insertText(text));
    const unsubFocus = registerComposerFocus(() => editorRef.current?.focus());
    const unsubUi = registerComposerInsertUiElement((candidate, image) => {
      if (image) setImages((current) => [...current, { ...image, id: candidate.imageId }]);
      editorRef.current?.insertMention(candidate);
      editorRef.current?.focus();
    });
    const unsubBatch = registerComposerInsertUiElements((items, owner) => {
      const editor = editorRef.current;
      if (!editor || pluginStateRef.current.focusKey !== owner || sendingRef.current) return false;
      const segments = editor.getSegments();
      if (segments.length) segments.push({ type: 'text', text: '\n\n' });
      for (const { candidate, note } of items) {
        const { kind: _kind, ...fields } = candidate;
        segments.push({ type: 'ui-element', ...fields });
        segments.push({ type: 'text', text: note?.trim() ? `\n${note.trim()}\n` : '\n' });
      }
      const attachments = items.flatMap(({ candidate, image }) =>
        image ? [{ ...image, id: candidate.imageId }] : []
      );
      editor.setSegments(segments);
      if (attachments.length) setImages((current) => [...current, ...attachments]);
      return true;
    });
    const unsubImage = registerComposerInsertImage((image) => {
      setImages((current) => [...current, { data: image.data, mimeType: image.mimeType }]);
      editorRef.current?.focus();
    });
    return () => {
      unsubInsert();
      unsubText();
      unsubFocus();
      unsubUi();
      unsubBatch();
      unsubImage();
    };
  }, [isolated]);
  const editorRef = useRef<MentionEditorHandle>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const pluginStateRef = useRef({ busy, locked, images, slash, recipient, focusKey, attachment });
  pluginStateRef.current = { busy, locked, images, slash, recipient, focusKey, attachment };
  const pluginEditRevision = useRef(0);
  useEffect(() => {
    if (isolated || !focusKey) return;
    return registerDraftTarget({
      key: focusKey,
      segments: () => editorRef.current?.getSegments() ?? [],
      insertText: (text) => editorRef.current?.insertText(text, true),
      setText: (text) => editorRef.current?.setSegments(text ? [{ type: 'text', text }] : [], true),
      revision: () => pluginEditRevision.current,
      busy: () =>
        composingRef.current ||
        pluginStateRef.current.busy ||
        pluginStateRef.current.locked ||
        hasPendingDeviceAccess(deviceAccessSessionId) ||
        !editorRef.current,
      hasReferences: () =>
        pluginStateRef.current.images.length > 0 ||
        Boolean(
          pluginStateRef.current.slash ||
            pluginStateRef.current.recipient ||
            pluginStateRef.current.attachment
        ),
    });
  }, [isolated, focusKey, deviceAccessSessionId]);
  const [popupLayout, setPopupLayout] = useState<{ left: number; flyoutWidth: number }>({
    left: 0,
    flyoutWidth: MENTION_FLYOUT_WIDTH,
  });
  const [mentionMaxHeight, setMentionMaxHeight] = useState<number | undefined>(undefined);
  // 编辑器的纯文本投影与卡片存在性（DOM 是事实源，这里只存渲染需要的派生态）
  const [editorPlain, setEditorPlain] = useState('');
  const [editorHasMentions, setEditorHasMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const mentionGroups = useMentionSearch(cwd, mentionQuery, chatCandidates);
  const mentionItems = useMemo(
    () => flattenMentionRoot(mentionGroups, mentionQuery ?? ''),
    [mentionGroups, mentionQuery]
  );
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [skillQuery, setSkillQuery] = useState<string | null>(null);
  const [pluginQuery, setPluginQuery] = useState<string | null>(null);
  const pluginItems = usePluginTriggerCandidates(isolated ? null : pluginQuery, focusKey ?? null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openFolderId, setOpenFolderId] = useState<MentionFolderId | null>(null);
  const [folderIndex, setFolderIndex] = useState(0);
  const slashListRef = useRef<HTMLDivElement>(null);

  /** 编辑器每次输入/光标变化回流：同步 query 与派生态，重置弹窗选中 */
  const handleEditorState = useCallback(
    (state: MentionEditorState) => {
      pluginEditRevision.current++;
      const first = state.segments[0];
      const folded =
        !restoringDraft.current && !composingRef.current && first?.type === 'text'
          ? foldLeadingSkills(first.text, pluginStateRef.current.slash)
          : null;
      if (folded && first?.type === 'text') {
        const selection = window.getSelection();
        const offset =
          selection?.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorOffset : undefined;
        pluginStateRef.current.slash = folded.slash;
        setSlash(folded.slash);
        editorRef.current?.setSegments([
          { type: 'text', text: folded.rest },
          ...state.segments.slice(1),
        ]);
        const node = composerRef.current?.querySelector('[contenteditable]')?.firstChild;
        if (selection && offset !== undefined && node?.nodeType === Node.TEXT_NODE) {
          const range = document.createRange();
          range.setStart(
            node,
            Math.min(
              folded.rest.length,
              Math.max(0, offset - (first.text.length - folded.rest.length))
            )
          );
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        return;
      }
      if (!restoringDraft.current && focusKey && prevFocusKeyRef.current === focusKey) {
        const current = pluginStateRef.current;
        drafts.set(focusKey, {
          segments: state.segments,
          images: current.images,
          slash: current.slash,
          recipient: current.recipient,
        });
      }
      if (state.plainText.trim() || state.hasMentions) onActivate?.();
      setEditorPlain(state.plainText);
      setEditorHasMentions(state.hasMentions);
      const nextBound = new Set(
        state.segments
          .filter((segment) => segment.type === 'ui-element' && segment.imageId)
          .map((segment) => (segment.type === 'ui-element' ? segment.imageId : ''))
      );
      const dropped = [...boundIds.current].filter((id) => !nextBound.has(id));
      boundIds.current = nextBound;
      if (dropped.length > 0) {
        setImages((current) => unbindImages(current, dropped));
        setPreview((current) => (current && dropped.includes(current.imageId) ? null : current));
      }
      setMentionQuery((previous) => {
        if (previous !== state.mentionQuery) {
          setActiveIndex(0);
          setOpenFolderId(null);
          setFolderIndex(0);
        }
        return state.mentionQuery;
      });
      setSlashQuery(state.slashQuery);
      setSkillQuery(state.skillQuery);
      setPluginQuery(state.pluginQuery);
    },
    [onActivate, focusKey]
  );

  // Metadata changes also write through; text is saved synchronously by handleEditorState.
  useLayoutEffect(() => {
    if (!focusKey || prevFocusKeyRef.current !== focusKey) return;
    drafts.set(focusKey, {
      segments: editorRef.current?.getSegments() ?? [],
      images,
      slash,
      recipient,
    });
  }, [images, slash, recipient, focusKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focusKey is a switch signal; values are captured at switch time.
  useLayoutEffect(() => {
    const previous = prevFocusKeyRef.current;
    if (previous !== focusKey) {
      const draft = focusKey ? drafts.get(focusKey) : undefined;
      restoringDraft.current = true;
      prevFocusKeyRef.current = focusKey;
      editorRef.current?.setSegments(draft?.segments ?? []);
      restoringDraft.current = false;
      boundIds.current = new Set(
        (draft?.segments ?? [])
          .filter((segment) => segment.type === 'ui-element' && segment.imageId)
          .map((segment) => (segment.type === 'ui-element' ? segment.imageId : ''))
      );
      setImages(draft?.images ?? []);
      setSlash(draft?.slash ?? null);
      setRecipient(draft?.recipient);
      setMentionQuery(null);
      setSlashQuery(null);
      setSkillQuery(null);
      setActiveIndex(0);
      setOpenFolderId(null);
      setFolderIndex(0);
    }
    if (autoFocus) editorRef.current?.focus();
  }, [focusKey]);

  useEffect(() => {
    if (!initialRecipient || editBlocked()) return;
    setRecipient(initialRecipient);
    onInitialRecipientConsumed?.();
  }, [initialRecipient, onInitialRecipientConsumed, editBlocked]);

  useEffect(() => {
    if (editBlocked() || (!injectedDraft && !injectedImages?.length)) return;
    const { images: currentImages, slash: currentSlash } = draftStateRef.current;
    const draft = applyInjectedDraft(
      {
        segments: editorRef.current?.getSegments() ?? [],
        images: currentImages,
        slash: currentSlash,
      },
      { text: injectedDraft, images: injectedImages },
      injectedDraftAppend
    );
    setSlash(draft.slash);
    setImages(draft.images);
    editorRef.current?.setSegments(draft.segments);
    onDraftConsumed?.();
    window.setTimeout(() => editorRef.current?.focus(), 0);
  }, [injectedDraft, injectedImages, injectedDraftAppend, editBlocked, onDraftConsumed]);

  const subQuery = slashSubcommandQuery(slash, editorPlain.replaceAll('\uFFFC', ''));
  const pluginSlash = usePluginSlashCommands();
  const slashResults = filterComposerCommands(
    isolated ? commands : [...commands, ...pluginSlash],
    slashQuery,
    skillQuery
  );
  useEffect(() => {
    if (isolated) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || editBlocked() || busy)
        return;
      const overrides = useSettingsStore.getState().keybindings;
      const binding = eventToBinding(event);
      const command = binding
        ? resolvePluginKeybindings(
            pluginCommands(),
            overrides,
            effectiveKeybindings(overrides)
          ).byBinding.get(binding)
        : undefined;
      if (!command) return;
      event.preventDefault();
      void runPluginCommand(command, focusKey ?? null).then((error) => {
        if (error) addToast({ title: error });
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isolated, busy, editBlocked, focusKey]);
  const subResults =
    slashQuery === null && skillQuery === null && subQuery !== null
      ? filterSlashSubcommands(slash, subQuery)
      : [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset highlight when the filter token changes
  useEffect(() => {
    setActiveIndex(0);
  }, [slashQuery, skillQuery, subQuery, pluginQuery]);

  useEffect(() => {
    const item = slashListRef.current?.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const pickMention = useCallback((candidate: MentionCandidate) => {
    if (candidate.kind === 'agent-type') {
      editorRef.current?.consumeToken('@');
      setRecipient(candidate);
      setMentionQuery(null);
      return;
    }
    // 文件/会话都是内联原子卡片：替换当前 @token，位置/顺序语义天然保留
    editorRef.current?.insertMention(candidate);
    setMentionQuery(null);
  }, []);

  const pickPlugin = useCallback(
    (candidate: PluginCandidate) => {
      const revision = pluginEditRevision.current;
      const sessionId = focusKey;
      setPluginQuery(null);
      void pickPluginCandidate(candidate, sessionId ?? null).then((text) => {
        const state = pluginStateRef.current;
        const editor = editorRef.current;
        if (
          text === null ||
          !editor ||
          revision !== pluginEditRevision.current ||
          sessionId !== state.focusKey ||
          state.busy ||
          state.locked ||
          composingRef.current ||
          state.images.length ||
          state.slash ||
          state.recipient ||
          editor.getSegments().some((segment) => segment.type !== 'text')
        )
          return;
        editor.consumeToken('#');
        editor.insertText(text, true);
        setPluginQuery(null);
        setSlashQuery(null);
      });
    },
    [focusKey]
  );

  const popupKind =
    mentionQuery !== null && mentionItems.length > 0
      ? 'mention'
      : pluginQuery !== null && pluginItems.length > 0
        ? 'plugin'
        : slashResults.length > 0
          ? 'slash'
          : subResults.length > 0
            ? 'slash-sub'
            : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 光标移动、picker 挂载、flyout 打开都要重测宽高
  useLayoutEffect(() => {
    if (popupKind !== 'mention') {
      setMentionMaxHeight(undefined);
      return;
    }
    const container = composerRef.current;
    if (!container) return;
    const sync = () => {
      const containerRect = container.getBoundingClientRect();
      // 弹窗向上长；窗口矮或条目多时只给输入框上方真实可用的高度，否则会顶出窗口被截断
      setMentionMaxHeight(
        mentionPopupMaxHeight({
          composerTop: containerRect.top,
          margin: MENTION_POPUP_MARGIN,
          cap: MENTION_POPUP_CAP,
        })
      );
      // 卡片可以铺满聊天栏（含内边距），但不能压到侧栏：按聊天栏而非输入框量宽度。
      const column = container.parentElement ?? container;
      const columnRect = column.getBoundingClientRect();
      const picker = container.querySelector('[data-slot="mention-picker"]');
      const listbox = picker?.querySelector('[role="listbox"]');
      const anchor = editorRef.current?.getMentionAnchorRect();
      const listWidth = listbox instanceof HTMLElement ? listbox.offsetWidth : 320;
      // 二级只在打开文件夹时出现；聊天栏窄时收窄二级列，让整张卡片仍留在聊天栏内。
      const folderOpen = Boolean(picker?.querySelector('[data-slot="mention-flyout"]'));
      const flyoutWidth = folderOpen
        ? Math.min(
            MENTION_FLYOUT_WIDTH,
            Math.max(
              MENTION_FLYOUT_MIN_WIDTH,
              // 卡片左右各 1px 描边，留出来才不会顶出聊天栏
              Math.floor(columnRect.width - listWidth - MENTION_FLYOUT_GAP - 2)
            )
          )
        : MENTION_FLYOUT_WIDTH;
      const cardWidth = listWidth + (folderOpen ? MENTION_FLYOUT_GAP + flyoutWidth : 0);
      const next = mentionPopupLayout({
        anchorLeft: anchor ? anchor.left - columnRect.left : 0,
        containerWidth: columnRect.width,
        cardWidth,
      });
      // 布局按聊天栏坐标算；picker 的定位父级是输入框容器，换算回它的坐标，且不越过聊天栏左缘。
      const offset = containerRect.left - columnRect.left;
      const left = Math.max(next.left - offset, -offset);
      setPopupLayout((previous) =>
        previous.left === left && previous.flyoutWidth === flyoutWidth
          ? previous
          : { left, flyoutWidth }
      );
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [mentionQuery, editorPlain, openFolderId, popupKind]);
  const popupLength =
    popupKind === 'mention'
      ? mentionItems.length
      : popupKind === 'plugin'
        ? pluginItems.length
        : popupKind === 'slash-sub'
          ? subResults.length
          : slashResults.length;

  const applySlashSubcommand = useCallback(
    async (name: string, sendNow: boolean) => {
      if (editBlocked() || sendingRef.current) return;
      const segments: MentionSegment[] = [{ type: 'text', text: name }];
      editorRef.current?.setSegments(segments);
      if (!sendNow) return;
      const payload = createEditorPayload({
        segments,
        slash,
        images,
        recipient,
      });
      sendingRef.current = true;
      setSending(true);
      let accepted = false;
      try {
        accepted = (await onSend(payload)) !== false;
      } catch {
        /* Keep the draft for retry. */
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
      if (!accepted) return;
      if (focusKey) drafts.delete(focusKey);
      if (prevFocusKeyRef.current !== focusKey) return;
      editorRef.current?.clear();
      setImages([]);
      setSlash(null);
      setRecipient(undefined);
      setMentionQuery(null);
      setSlashQuery(null);
      setSkillQuery(null);
    },
    [editBlocked, images, onSend, recipient, slash, focusKey]
  );

  const pickActive = useCallback(
    (submitSubcommand = false) => {
      if (editBlocked()) return;
      if (popupKind === 'mention') {
        if (openFolderId) {
          const candidate = mentionGroups[openFolderId][folderIndex];
          if (candidate) pickMention(candidate);
          return;
        }
        const item = mentionItems[activeIndex];
        if (item?.type === 'item') pickMention(item.candidate);
      } else if (popupKind === 'plugin') {
        const item = pluginItems[activeIndex];
        if (item) pickPlugin(item);
      } else if (popupKind === 'slash') {
        const item = slashResults[activeIndex];
        if (!item) return;
        const command = !isolated && pluginCommandFor(item.name);
        if (command) {
          editorRef.current?.consumeToken('/');
          setSlashQuery(null);
          void runPluginCommand(command, focusKey ?? null).then((error) => {
            if (error) addToast({ title: error });
          });
          return;
        }
        editorRef.current?.consumeToken(skillQuery !== null ? '$' : '/');
        setSlashQuery(null);
        setSkillQuery(null);
        setSlash((current) => appendSlash(current, item.name));
      } else if (popupKind === 'slash-sub') {
        const item = subResults[activeIndex];
        if (!item) return;
        applySlashSubcommand(item.name, submitSubcommand);
      }
    },
    [
      activeIndex,
      folderIndex,
      openFolderId,
      mentionGroups,
      mentionItems,
      pickMention,
      pickPlugin,
      pluginItems,
      popupKind,
      slashResults,
      skillQuery,
      subResults,
      applySlashSubcommand,
      editBlocked,
      focusKey,
      isolated,
    ]
  );

  const content = editorPlain.replaceAll('\uFFFC', '').trim();
  const hasContent = Boolean(content || slash || images.length > 0 || editorHasMentions);
  const agentRecipient = recipient !== undefined;
  const effectiveBusy = busy && !agentRecipient;
  // 仅快捷键触发，无绑定时不提示
  const steerAvailable =
    running && queuedCount > 0 && onSteerQueued !== undefined && enterToSend && !!sendBinding;
  const steerableNow = () => steerAvailable && !hasContent && !agentRecipient && !editBlocked();

  const handleSend = async () => {
    if (!hasContent || editBlocked() || sendingRef.current) return;
    const payload = createEditorPayload({
      segments: editorRef.current?.getSegments() ?? [],
      slash,
      images,
      recipient,
    });
    // A draft for this session must not leak into an explicit @agent dispatch or local command.
    const attached =
      !recipient && !/^\/(?:compact|goal|plan)(?:\s|$)/.test(payload.text.trimStart())
        ? attachment
        : undefined;
    const outgoing = attached
      ? { ...payload, text: [payload.text, attached.text].filter(Boolean).join('\n\n') }
      : payload;
    sendingRef.current = true;
    setSending(true);
    let accepted = false;
    try {
      accepted = (await onSend(outgoing)) !== false;
    } catch {
      /* Keep the draft for retry. */
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
    if (!accepted) return;
    if (focusKey) drafts.delete(focusKey);
    attached?.onConsumed();
    if (prevFocusKeyRef.current !== focusKey) return;
    editorRef.current?.clear();
    setImages([]);
    setSlash(null);
    setRecipient(undefined);
    setMentionQuery(null);
    setSlashQuery(null);
    setSkillQuery(null);
  };

  const ingestFiles = useCallback(
    (files: File[]) => {
      if (editBlocked()) return;
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = () => {
            if (editBlocked()) return;
            const dataUrl = reader.result as string;
            const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
            setImages((current) => [...current, { data: base64, mimeType: file.type }]);
          };
          reader.readAsDataURL(file);
          continue;
        }
        const filePath = window.electronAPI.files.pathForFile(file);
        if (!filePath) continue;
        // 拖入的文件在光标处插原子卡片，位置/顺序语义保留
        editorRef.current?.insertFileChip(filePath);
      }
    },
    [editBlocked]
  );

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const isComposing = event.nativeEvent.isComposing || composingRef.current;
    if (editBlocked()) {
      event.preventDefault();
      return;
    }
    if (popupKind) {
      const activeItem = popupKind === 'mention' ? mentionItems[activeIndex] : undefined;
      const action = resolvePopupKeyAction({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing,
        activeIndex,
        itemCount: popupLength,
        folderOpen: popupKind === 'mention' && openFolderId !== null,
        activeIsFolder: popupKind === 'mention' && activeItem?.type === 'folder',
        folderIndex,
        folderItemCount: openFolderId ? mentionGroups[openFolderId].length : 0,
      });
      if (action.type === 'move') {
        event.preventDefault();
        setActiveIndex(action.index);
        setOpenFolderId(null);
        return;
      }
      if (action.type === 'move-folder') {
        event.preventDefault();
        setFolderIndex(action.index);
        return;
      }
      if (action.type === 'open-folder') {
        event.preventDefault();
        if (activeItem?.type === 'folder') setOpenFolderId(activeItem.id);
        setFolderIndex(0);
        return;
      }
      if (action.type === 'close-folder') {
        event.preventDefault();
        setOpenFolderId(null);
        return;
      }
      if (action.type === 'pick') {
        event.preventDefault();
        pickActive(popupKind === 'slash-sub' && event.key === 'Enter');
        return;
      }
      if (action.type === 'close') {
        event.preventDefault();
        setMentionQuery(null);
        setSlashQuery(null);
        setSkillQuery(null);
        setPluginQuery(null);
        setOpenFolderId(null);
        return;
      }
    }
    if (isComposing) return;
    const pressed = eventToBinding(event);
    if (
      !isolated &&
      pressed &&
      pressed === effectiveKeybindings(useSettingsStore.getState().keybindings)['switch-model']
    ) {
      event.preventDefault();
      requestOpenChatModelPicker();
      return;
    }
    if (event.key === 'Backspace' && slash && content.length === 0 && !editorHasMentions) {
      event.preventDefault();
      setSlash(removeSlash(slash, slashChain(slash).length - 1));
      return;
    }
    // 文件/会话卡片是 cE=false 原子块，Backspace 浏览器原生整块删除；
    // 只剩 recipient（编辑器外的顶部 chip）需要在编辑器全空时兼顾
    if (event.key === 'Backspace' && recipient && editorRef.current?.isEmpty() && !slash) {
      event.preventDefault();
      setRecipient(undefined);
      return;
    }
    if (enterToSend && !popupKind) {
      const pressedSend = eventToBinding(event, { allowBare: true });
      if (pressedSend === sendBinding) {
        event.preventDefault();
        if (steerableNow()) onSteerQueued?.();
        else handleSend();
      }
    }
  };

  return (
    <div ref={composerRef} data-enso="composer" className="relative">
      {popupKind === 'mention' && (
        <MentionPicker
          id={mentionPickerId}
          groups={mentionGroups}
          query={mentionQuery ?? ''}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
          openFolderId={openFolderId}
          folderIndex={folderIndex}
          onOpenFolderIdChange={setOpenFolderId}
          onFolderIndexChange={setFolderIndex}
          onSelect={pickMention}
          left={popupLayout.left}
          flyoutWidth={popupLayout.flyoutWidth}
          maxHeight={mentionMaxHeight}
        />
      )}
      {popupKind === 'plugin' && (
        <div
          ref={slashListRef}
          role="listbox"
          aria-label={t('Plugin suggestions')}
          className="absolute bottom-full left-0 z-10 mb-1.5 max-h-64 w-full overflow-y-auto rounded-[6px] border bg-popover p-1 shadow-md"
        >
          {pluginItems.map((candidate, index) => (
            <button
              key={candidate.key}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pickPlugin(candidate)}
              onMouseMove={() => setActiveIndex(index)}
              className={cn(
                'flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[calc(12rem/14)]',
                index === activeIndex && 'bg-foreground/10'
              )}
            >
              <span className="font-medium">#{candidate.item.label}</span>
              <span className="min-w-0 truncate text-muted-foreground">
                {candidate.item.detail}
              </span>
            </button>
          ))}
        </div>
      )}
      {(popupKind === 'slash' || popupKind === 'slash-sub') && (
        <div
          ref={slashListRef}
          role="listbox"
          aria-label={t('Command suggestions')}
          className="absolute bottom-full left-0 z-10 mb-1.5 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
        >
          {(popupKind === 'slash' ? slashResults : subResults).map((item, index) => (
            <button
              key={item.name}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => {
                setActiveIndex(index);
                if (popupKind === 'slash') {
                  editorRef.current?.consumeToken(skillQuery !== null ? '$' : '/');
                  setSlashQuery(null);
                  setSkillQuery(null);
                  setSlash((current) => appendSlash(current, item.name));
                } else {
                  applySlashSubcommand(item.name, false);
                }
              }}
              onMouseMove={() => setActiveIndex(index)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[calc(11rem/14)]',
                // 同 MentionPicker：浅色主题下 bg-muted 在纯白 popover 上不可见
                index === activeIndex && 'bg-foreground/10'
              )}
            >
              <SlashSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 font-mono font-medium">
                {skillQuery !== null ? `$${item.name.slice('/skill:'.length)}` : item.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {t(item.description)}
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        ref={setDropRef}
        data-slot="composer"
        data-composer-appearance={appearance}
        className={cn(
          'rounded-xl border border-border bg-card shadow-xs transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] hover:border-foreground/15 focus-within:border-brand/60 focus-within:shadow-sm',
          locked && 'border-line opacity-80',
          (dragging || dndOver) && 'border-brand/50 bg-brand/5',
          (agentRecipient || planMode) && 'border-brand/35 shadow-brand/5'
        )}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer.files);
          if (files.length === 0) return;
          event.preventDefault();
          setDragging(false);
          ingestFiles(files);
        }}
      >
        {attachment && (
          <div className="flex px-3 pt-2">
            <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-xs">
              <span className="truncate">{attachment.label}</span>
              <button
                type="button"
                aria-label={t('Remove')}
                onClick={attachment.onRemove}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          </div>
        )}
        {images.filter((image) => !image.id).length > 0 && (
          <div data-composer-images="" className="flex flex-wrap gap-2 px-3 pt-3">
            {images
              .filter((image) => !image.id)
              .map((image, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: attachments have no stable id.
                <div key={index} className="group relative">
                  <button
                    type="button"
                    onClick={() => setImagePreview(image)}
                    className="block rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    aria-label={t('Preview')}
                  >
                    <img
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt=""
                      className="h-16 w-16 rounded-md border object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setImages((current) => current.filter((_, item) => item !== index))
                    }
                    className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5 text-muted-foreground shadow-sm transition-opacity hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
          </div>
        )}
        <div
          data-composer-editor=""
          className={cn(
            'flex min-h-[calc(64rem/14)] items-start gap-1.5 px-[14px] pb-[4px]',
            images.length > 0 ? 'pt-1.5' : 'pt-[12px]'
          )}
        >
          {recipient && (
            <MentionChip recipient={recipient} onRemove={() => setRecipient(undefined)} />
          )}
          {slashChain(slash).map((name, index) => (
            <SlashChip
              // biome-ignore lint/suspicious/noArrayIndexKey: Identical command tokens can repeat in legacy drafts; their ordered occurrence is their identity.
              key={`${index}-${name}`}
              name={name}
              className="mt-0.5 shrink-0"
              trailing={
                <button
                  type="button"
                  onClick={() =>
                    setSlash((current) => (current ? removeSlash(current, index) : null))
                  }
                  className="rounded-sm opacity-70 hover:opacity-100"
                  aria-label={t('Remove')}
                >
                  <X className="h-3 w-3" />
                </button>
              }
            />
          ))}
          <MentionEditor
            ref={editorRef}
            className="text-[length:var(--composer-font-size,1rem)] leading-[calc(24rem/14)]"
            placeholder={
              slash
                ? ''
                : locked
                  ? t('Resolve the pending approval to continue')
                  : agentRecipient
                    ? t('Message the selected Agent…')
                    : steerAvailable
                      ? t('Press {{key}} to steer the next queued message into this round…', {
                          key: formatBinding(sendBinding),
                        })
                      : placeholderText
                        ? placeholderText
                        : running
                          ? t('Message will queue until this round finishes…')
                          : t('Type @ to choose a file or Agent')
            }
            disabled={locked || sending}
            onStateChange={handleEditorState}
            onChipActivate={(segment) => {
              if (segment.type === 'ui-element') {
                setPreview({
                  kind: 'ui-element',
                  id: segment.id,
                  label: segment.label,
                  path: segment.path,
                  text: segment.text,
                  imageId: segment.imageId,
                });
              }
            }}
            onKeyDown={handleKeyDown}
            onPasteText={(text) => {
              if (!savePastedText || !pastedTextFileContent(text)) return false;
              void savePastedText(text)
                .catch((): PastedTextFileResult => ({ ok: false, error: 'unavailable' }))
                .then((result) => {
                  const editor = editorRef.current;
                  if (!result.ok) editor?.insertText(text);
                  else
                    editor?.insertFileChip(
                      result.path,
                      `${PASTED_TEXT_FILE_NAME} · ${t('{{count}} chars', { count: result.chars.toLocaleString() })}`
                    );
                });
              return true;
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length === 0) return;
              event.preventDefault();
              ingestFiles(files);
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            ariaProps={{
              role: 'combobox',
              'aria-autocomplete': 'list',
              'aria-expanded': popupKind !== null,
              'aria-controls': popupKind === 'mention' ? mentionPickerId : undefined,
              'aria-activedescendant':
                popupKind === 'mention'
                  ? openFolderId
                    ? `${mentionPickerId}-sub-${folderIndex}`
                    : `${mentionPickerId}-option-${activeIndex}`
                  : undefined,
            }}
          />
        </div>
        {agentRecipient && <p className="sr-only">{t('Send only to the selected Agent')}</p>}
        <div
          data-composer-toolbar=""
          className="flex items-end justify-between gap-[4px] border-t border-border/60 px-[8px] pt-[5px] pb-[8px]"
        >
          <div
            data-composer-tools=""
            className="flex min-w-0 flex-1 flex-wrap items-center gap-[4px]"
          >
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                ingestFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
            <button
              type="button"
              data-composer-attach=""
              disabled={locked}
              onClick={() => imageInputRef.current?.click()}
              aria-label={t('Attach image')}
              title={t('Attach image')}
              className="flex size-[calc(28rem/14)] shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              {appearance === 'phone' ? (
                <Plus className="size-[22px]" />
              ) : (
                <ImagePlus className="size-[calc(14rem/14)]" />
              )}
            </button>
            <span data-composer-voice="" className="contents">
              {holdVoice ? (
                <HoldToTalkToggle
                  active={holdToTalk}
                  disabled={locked}
                  onChange={(active) => {
                    setHoldToTalk(active);
                    // 按住说话时收起软键盘；切回键盘直接聚焦
                    if (active) (document.activeElement as HTMLElement | null)?.blur();
                    else editorRef.current?.focus();
                  }}
                />
              ) : voice ? (
                <VoiceInputButton
                  startSession={voice}
                  requestMicAccess={requestMicAccess}
                  disabled={locked}
                  holdBinding={voiceHoldBinding || undefined}
                  holdScope={composerRef}
                  onText={(text) => {
                    editorRef.current?.insertText(text);
                    editorRef.current?.focus();
                  }}
                />
              ) : null}
            </span>
            {toolbar}
            {!isolated && <PluginStatusItems sessionId={focusKey ?? null} />}
            {!isolated && (
              <PluginComposerSlots
                side="left"
                sessionId={focusKey ?? null}
                presetId={presetId}
                draft={editorPlain.replaceAll('\uFFFC', '')}
                busy={busy || locked}
              />
            )}
          </div>
          {!isolated && (
            <PluginComposerSlots
              side="right"
              sessionId={focusKey ?? null}
              presetId={presetId}
              draft={editorPlain.replaceAll('\uFFFC', '')}
              busy={busy || locked}
            />
          )}
          {/* 生成中且输入为空才显示停止；有草稿则保持发送，方便手机点按钮入队 */}
          {effectiveBusy && !hasContent ? (
            <Button
              variant="outline"
              data-composer-action-button="stop"
              size="icon"
              className="size-[calc(32rem/14)] shrink-0 rounded-[6px] border-foreground bg-foreground text-inverse-foreground hover:bg-foreground/85"
              onClick={onAbort}
              aria-label={t('Stop')}
            >
              {appearance === 'phone' ? (
                <Square className="size-[22px]" />
              ) : (
                <CircleStop className="size-[calc(16rem/14)]" />
              )}
            </Button>
          ) : (
            <Button
              size="icon"
              data-composer-action-button="send"
              className="size-[calc(32rem/14)] shrink-0 rounded-[6px] border-brand bg-brand text-brand-foreground shadow-none hover:bg-brand/90 disabled:opacity-35"
              onClick={handleSend}
              disabled={!hasContent || locked || sending}
              aria-label={agentRecipient ? t('Send only to the selected Agent') : t('Send')}
              title={
                agentRecipient
                  ? t('Send only to the selected Agent')
                  : enterToSend
                    ? sendBinding
                      ? `${t('Send')} ${formatBinding(sendBinding)}`
                      : t('Send')
                    : t('Send')
              }
            >
              <ArrowUp className="size-[calc(16rem/14)]" />
            </Button>
          )}
        </div>
      </div>
      {holdVoice && holdToTalk ? (
        <HoldToTalk
          startSession={holdVoice}
          disabled={locked}
          onText={(text) => {
            editorRef.current?.insertText(text);
            // 插入会聚焦编辑器，按住说话模式下不弹键盘
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        />
      ) : null}
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{preview?.label ?? t('Selected UI element')}</DialogTitle>
          </DialogHeader>
          <DialogPanel className="space-y-2 text-[calc(11rem/14)]">
            {preview && (
              <>
                <p className="text-muted-foreground break-all">{preview.path}</p>
                {preview.text && <p>{preview.text}</p>}
                {(() => {
                  const image = images.find((item) => item.id === preview.imageId);
                  return image ? (
                    <img
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt=""
                      className="max-h-72 w-full rounded-md border object-contain"
                    />
                  ) : null;
                })()}
              </>
            )}
          </DialogPanel>
        </DialogContent>
      </Dialog>
      <Dialog open={imagePreview !== null} onOpenChange={(open) => !open && setImagePreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('Preview')}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            {imagePreview && (
              <img
                src={`data:${imagePreview.mimeType};base64,${imagePreview.data}`}
                alt=""
                className="max-h-[80vh] w-full rounded-md object-contain"
              />
            )}
          </DialogPanel>
        </DialogContent>
      </Dialog>
    </div>
  );
}
