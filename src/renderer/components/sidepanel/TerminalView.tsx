import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { insertComposerText, requestFocusComposer } from '@/components/chat/composerMentionBridge';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useI18n } from '@/i18n';
import { getXtermTheme, withTransparentBackground } from '@/lib/ghosttyTheme';
import {
  attachTerminal,
  clearTerminalSearch,
  detachTerminal,
  findInTerminal,
  updateTerminalAppearance,
} from '@/lib/terminalRegistry';
import { matchTerminalBackground, readAppPanelColor } from '@/lib/terminalSurface';
import { useSettingsStore } from '@/stores/settings';
import { TerminalSearchBar } from './TerminalSearchBar';

interface TerminalViewProps {
  termId: string;
  conversationId?: string;
  projectId?: string;
  onTitle?: (title: string) => void;
}

/**
 * 终端底色跟应用面板对齐（见 matchTerminalBackground），16 色与前景仍取终端配色。
 * 背景图模式下 xterm 自身不刷底色，由 wrapper 用同一底色 + 通用面板 alpha 刷一层。
 */
function resolveTerminalTheme(name: string, backgroundImageEnabled: boolean, panelColor?: string) {
  const theme = getXtermTheme(name);
  if (!theme) return theme;
  const background = matchTerminalBackground(theme.background, panelColor);
  const next = { ...theme, background };
  return backgroundImageEnabled ? withTransparentBackground(next) : next;
}

/** 把 registry 里的 xterm host 挂进视图;切走只 detach,实例与 pty 都保留 */
export function TerminalView({ termId, conversationId, projectId, onTitle }: TerminalViewProps) {
  const { t } = useI18n();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<ReturnType<typeof attachTerminal>['term'] | null>(null);
  const selectionRef = useRef('');
  const [hasSelection, setHasSelection] = useState(false);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const terminalTheme = useSettingsStore((s) => s.terminalTheme);
  /** 应用主题模式：dark/light/system 切换后 --panel 会变，需要重算终端底色 */
  const appTheme = useSettingsStore((s) => s.theme);
  const fontFamily = useSettingsStore((s) => s.terminalFontFamily);
  const fontSize = useSettingsStore((s) => s.terminalFontSize);
  const bgImageEnabled = useSettingsStore((s) => s.backgroundImageEnabled);
  /** 应用面板底色：终端铺底时用它，16 色仍取终端配色 */
  // biome-ignore lint/correctness/useExhaustiveDependencies: 应用主题/终端配色变化后 --panel 才会变，必须借此重读
  const panelColor = useMemo(() => readAppPanelColor(), [appTheme, terminalTheme]);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    let cancelled = false;
    let raf = 0;
    let observer: ResizeObserver | undefined;

    const tryAttach = () => {
      if (cancelled) return;
      if (!wrapper.isConnected || wrapper.clientWidth === 0 || wrapper.clientHeight === 0) {
        raf = requestAnimationFrame(tryAttach);
        return;
      }
      const settings = useSettingsStore.getState();
      const instance = attachTerminal(termId, wrapper, {
        theme: resolveTerminalTheme(
          settings.terminalTheme,
          settings.backgroundImageEnabled,
          readAppPanelColor()
        ),
        fontFamily: settings.terminalFontFamily,
        fontSize: settings.terminalFontSize,
      });
      if (!instance.opened) {
        raf = requestAnimationFrame(tryAttach);
        return;
      }
      instance.onTitle = (title) => onTitleRef.current?.(title);
      const doFit = () => {
        if (!wrapper.isConnected || wrapper.clientWidth === 0) return;
        instance.fit.fit();
        void window.electronAPI.terminal.resize(termId, instance.term.cols, instance.term.rows);
      };
      doFit();
      void window.electronAPI.terminal.create({
        termId,
        conversationId: conversationIdRef.current,
        projectId: projectIdRef.current,
        cols: instance.term.cols,
        rows: instance.term.rows,
      });
      instance.term.focus();
      termRef.current = instance.term;
      observer = new ResizeObserver(doFit);
      observer.observe(wrapper);
    };
    // 首次测量前加载图标，避免 xterm 缓存缺字时的错误宽度。
    //
    // Load icons before the first measurement so xterm does not cache missing-glyph widths.
    void document.fonts.load('14px "Enso Nerd Symbols"', '\uE0B0').then(tryAttach, (error) => {
      console.warn('Failed to load terminal icon font', error);
      tryAttach();
    });

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
      }
    };
    wrapper.addEventListener('keydown', onKey, true);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      wrapper.removeEventListener('keydown', onKey, true);
      termRef.current = null;
      detachTerminal(termId);
    };
  }, [termId]);

  useEffect(() => {
    updateTerminalAppearance(
      resolveTerminalTheme(terminalTheme, bgImageEnabled, panelColor),
      fontFamily,
      fontSize
    );
  }, [terminalTheme, fontFamily, fontSize, bgImageEnabled, panelColor]);

  const findNext = useCallback(
    (query: string, options?: Parameters<typeof findInTerminal>[3]) =>
      findInTerminal(termId, query, 'next', options),
    [termId]
  );
  const findPrev = useCallback(
    (query: string, options?: Parameters<typeof findInTerminal>[3]) =>
      findInTerminal(termId, query, 'prev', options),
    [termId]
  );
  const clearSearch = useCallback(() => clearTerminalSearch(termId), [termId]);

  const snapshotSelection = () => {
    const text = termRef.current?.getSelection().trim() ?? '';
    selectionRef.current = text;
    setHasSelection(text.length > 0);
  };

  const sendSelection = () => {
    const text = selectionRef.current || termRef.current?.getSelection().trim() || '';
    if (!text) return;
    insertComposerText(text);
    requestFocusComposer();
    termRef.current?.clearSelection();
    setHasSelection(false);
  };

  const copySelection = () => {
    const text = selectionRef.current || termRef.current?.getSelection().trim() || '';
    if (text) void navigator.clipboard.writeText(text);
  };

  const theme = getXtermTheme(terminalTheme);
  const surfaceBg = theme ? matchTerminalBackground(theme.background, panelColor) : undefined;
  const pane = (
    <div
      ref={wrapperRef}
      data-slot="terminal-pane"
      className="relative h-full w-full overflow-hidden p-2"
      style={{
        backgroundColor: surfaceBg,
        ['--terminal-bg' as string]: surfaceBg,
      }}
      onContextMenu={snapshotSelection}
    >
      <TerminalSearchBar
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onFindNext={findNext}
        onFindPrevious={findPrev}
        onClear={clearSearch}
        theme={theme}
      />
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger render={pane as ReactElement<Record<string, unknown>>} />
      <ContextMenuPopup className="min-w-40">
        <ContextMenuItem disabled={!hasSelection} onClick={copySelection}>
          {t('Copy')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasSelection} onClick={sendSelection}>
          {t('Send to conversation')}
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}
