import { IMAGE_PROMPT_MAX } from '@shared/imageGeneration';
import {
  DEFAULT_IMAGE_STUDIO_OPTIONS,
  type ImageStudioOptions,
  studioTurnImages,
} from '@shared/imageStudio';
import {
  ArrowDownWideNarrow,
  ArrowUp,
  ChevronDown,
  CirclePlus,
  Image,
  Layers,
  Loader2,
  Palette,
  Paperclip,
  Search,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { GeneratedImageSkeleton } from '@/components/chat/GeneratedImageSkeleton';
import { ResizeHandle } from '@/components/chat/ResizeHandle';
import { useImageProviderSettings } from '@/components/settings/useImageProviderSettings';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { effectiveKeybindings, eventToBinding, formatBinding } from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { resolveSidePanelWidth } from '@/stores/sidePanel/width';
import { StudioImage, StudioThumbnail, useStudioImage } from './StudioImage';
import { StudioSettings } from './StudioSettings';
import { useImageStudioStore } from './store';

const iconButton =
  'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';
const chip =
  'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground';
const tab = 'relative flex h-full items-center gap-1.5 px-3 text-[calc(13rem/14)]';
const activeTab =
  'after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:rounded-full after:bg-brand';

export function ImageStudio({
  collapsed,
  sidebarWidth,
  onResize,
  onHistoryResize,
  onHistoryResizingChange,
  workspaceRef,
}: {
  collapsed: boolean;
  sidebarWidth: number;
  onResize(deltaX: number): void;
  onHistoryResize(deltaX: number): void;
  onHistoryResizingChange(resizing: boolean): void;
  workspaceRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  const summaries = useImageStudioStore((s) => s.summaries);
  const activeId = useImageStudioStore((s) => s.activeId);
  const session = useImageStudioStore((s) => (s.activeId ? s.sessions[s.activeId] : undefined));
  const loading = useImageStudioStore((s) => s.loading);
  const error = useImageStudioStore((s) => s.error);
  const historyOpen = useImageStudioStore((s) => s.historyOpen);
  const preferredHistoryWidth = useImageStudioStore((s) => s.historyWidth);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const historyWidth = resolveSidePanelWidth(preferredHistoryWidth, workspaceWidth);
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const measure = () => setWorkspaceWidth(workspace.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [workspaceRef]);
  const pending = useImageStudioStore((s) => !!s.pending[s.activeId ?? '']);
  const draft = useImageStudioStore((s) => s.drafts[s.activeId ?? ''] ?? '');
  const source = useImageStudioStore((s) => s.sources[s.activeId ?? '']);
  const actions = useImageStudioStore.getState();
  const { view, error: providerError } = useImageProviderSettings();
  const [options, setOptions] = useState<ImageStudioOptions>(DEFAULT_IMAGE_STUDIO_OPTIONS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [filter, setFilter] = useState<'all' | 'generate' | 'edit'>('all');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(40);
  const [preview, setPreview] = useState<{
    sessionId: string;
    imageId: string;
    prompt: string;
  } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const models = view?.config.models ?? [];
  const model = models.includes(options.model) ? options.model : (models[0] ?? '');
  const effectiveOptions = useMemo(() => ({ ...options, model }), [options, model]);
  const running = pending || !!session?.turns.some((turn) => turn.status === 'running');
  const ready = !!view?.hasApiKey && !!model;
  const keybindings = useSettingsStore((s) => s.keybindings);
  const bindings = effectiveKeybindings(keybindings);
  const newBinding = bindings['new-conversation'];
  const historyBinding = bindings['toggle-side-panel'];
  const focusBinding = bindings['focus-composer'];
  const scrollKey = `${activeId}:${session?.turns.length}:${session?.updatedAt}:${session?.imageCount}`;
  useEffect(() => {
    void useImageStudioStore.getState().refresh();
    return window.electronAPI.imageStudio.onChanged(
      () => void useImageStudioStore.getState().refresh()
    );
  }, []);
  useEffect(() => {
    if (scrollKey) bottom.current?.scrollIntoView({ block: 'end' });
  }, [scrollKey]);
  useEffect(() => {
    if (activeId || filter) setHistoryLimit(40);
  }, [activeId, filter]);
  const createSession = async () => {
    const id = await actions.newSession();
    if (id) input.current?.focus();
    return id;
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const binding = eventToBinding(event);
      if (binding === newBinding) {
        event.preventDefault();
        void useImageStudioStore.getState().newSession();
      } else if (binding === historyBinding) {
        event.preventDefault();
        useImageStudioStore.getState().toggleHistory();
      } else if (binding === focusBinding) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [newBinding, historyBinding, focusBinding]);
  const send = async () => {
    if (!draft.trim() || running || submitting || !ready) return;
    setSubmitting(true);
    try {
      let id = activeId;
      if (!id) {
        id = await actions.newSession();
        if (!id) return;
        actions.setDraft(id, draft);
        actions.setDraft('', '');
      }
      void actions.generate(id, effectiveOptions);
    } finally {
      setSubmitting(false);
    }
  };
  const attach = async () => {
    if (!view?.config.imageToImage || running || submitting) return;
    setSubmitting(true);
    try {
      const id = activeId ?? (await actions.newSession());
      if (id) {
        if (!activeId) {
          actions.setDraft(id, draft);
          actions.setDraft('', '');
        }
        await actions.importReference(id);
      }
    } finally {
      setSubmitting(false);
    }
  };
  const edit = (id: string) => {
    actions.setSource(activeId ?? '', id);
    input.current?.focus();
  };
  const turns = session?.turns ?? [];
  const images = turns
    .flatMap((turn) => studioTurnImages(turn).map((image) => ({ turn, image })))
    .filter(
      ({ turn }) =>
        filter === 'all' || (filter === 'edit' ? turn.sourceImageId : !turn.sourceImageId)
    )
    .toReversed();
  const configure = () =>
    void window.electronAPI.window.openSettings({
      category: 'tools',
      rowId: 'tools.imageGeneration',
    });
  const visible = summaries.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase())
  );
  if (oldestFirst) visible.reverse();
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1"
      data-slot="image-studio"
      aria-label={t('Image studio')}
    >
      {!collapsed && (
        <aside
          className="flex min-h-0 shrink-0 flex-col border-r border-line bg-shell"
          style={{ width: sidebarWidth }}
          data-slot="image-studio-sidebar"
        >
          <div className="flex h-[44px] shrink-0 items-center px-3">
            <span className="text-[calc(13rem/14)] font-medium">{t('Conversations')}</span>
            <button
              type="button"
              className={cn(iconButton, 'ml-auto')}
              aria-label={t('Search conversations')}
              onClick={() => setSearch(!search)}
            >
              <Search className="size-4" />
            </button>
          </div>
          {search && (
            <div className="px-3 pb-2">
              <Input
                autoFocus
                aria-label={t('Search conversations')}
                placeholder={t('Search conversations')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          )}
          <button
            type="button"
            className="mx-3 flex min-h-9 shrink-0 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-accent"
            onClick={() => void createSession()}
          >
            <CirclePlus className="size-[17px] text-primary" />
            {t('New conversation')}
            <kbd className="ml-auto rounded border border-border px-1 text-[calc(11rem/14)] text-muted-foreground">
              {formatBinding(bindings['new-conversation'])}
            </kbd>
          </button>
          <div className="mt-4 flex items-center px-4 pb-1 text-xs text-muted-foreground">
            <span>{t('Recent')}</span>
            <button
              type="button"
              aria-label={t('Reverse time order')}
              className={cn(iconButton, 'ml-auto size-6')}
              onClick={() => setOldestFirst(!oldestFirst)}
              aria-pressed={oldestFirst}
            >
              <ArrowDownWideNarrow className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {visible.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'group flex min-h-8 items-center rounded-md',
                  activeId === item.id
                    ? 'bg-selection text-selection-foreground'
                    : 'hover:bg-accent/60'
                )}
              >
                <button
                  type="button"
                  onClick={() => void actions.select(item.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[calc(13rem/14)]"
                  aria-current={activeId === item.id ? 'page' : undefined}
                >
                  <Image className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {item.title ? item.title : t('New conversation')}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[calc(11rem/14)] text-muted-foreground">
                    <Layers className="size-3" />
                    {item.imageCount}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t('Delete conversation')}
                  className={cn(
                    iconButton,
                    'mr-1 size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                  )}
                  onClick={() => setDeleteId(item.id)}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
            {!visible.length && (
              <p className="mx-2 mt-5 rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                {t(
                  query ? 'No matching conversations' : 'Your image conversations will appear here.'
                )}
              </p>
            )}
          </div>
        </aside>
      )}
      {!collapsed && <ResizeHandle onResize={onResize} />}
      <div
        ref={workspaceRef}
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden border-l border-t border-line bg-background"
        data-slot="workbench-main"
      >
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!turns.length ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="size-6" />
              </span>
              <h1 className="mt-6 text-[calc(34rem/14)] font-medium tracking-tight">
                {t('What would you like to draw today?')}
              </h1>
              <p className="mt-2 text-[calc(13rem/14)] text-muted-foreground">
                {t(
                  'Choose how many images to generate in drawing settings. Creations are saved by conversation.'
                )}
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                {[
                  'A watercolor cat in the afternoon',
                  'A cyberpunk night market',
                  'A minimal product poster on a cream background',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-[calc(13rem/14)] hover:bg-accent"
                    onClick={() => {
                      actions.setDraft(activeId ?? '', t(suggestion));
                      input.current?.focus();
                    }}
                  >
                    <Palette className="size-4 shrink-0 text-muted-foreground" />
                    {t(suggestion)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-6" data-slot="studio-timeline">
              <div className="mx-auto flex max-w-[820px] flex-col gap-3 py-4">
                {turns.map((turn) => (
                  <div key={turn.id} className="contents">
                    <div className="flex justify-end">
                      <div className="max-w-[min(520px,85%)] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-secondary px-4 py-2.5 text-[calc(13rem/14)] leading-relaxed text-secondary-foreground">
                        {turn.sourceImageId && (
                          <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Image className="size-3" />
                            {t('Image to image')}
                          </span>
                        )}
                        {turn.prompt}
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Sparkles className="mt-2.5 size-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start gap-3">
                          {studioTurnImages(turn).map((image) => (
                            <StudioImage
                              key={image.id}
                              sessionId={activeId!}
                              image={image}
                              editingDisabled={!view?.config.imageToImage || running}
                              onEdit={() => edit(image.id)}
                            />
                          ))}
                          {turn.status === 'running' &&
                            studioTurnImages(turn).length < turn.options.count && (
                              <GeneratedImageSkeleton editing={!!turn.sourceImageId} />
                            )}
                        </div>
                        {turn.options.count > 1 && (
                          <p className="mt-2 text-xs text-muted-foreground" role="status">
                            {t('Images generated')} {studioTurnImages(turn).length} /{' '}
                            {turn.options.count}
                          </p>
                        )}
                        {turn.status !== 'completed' && (
                          <div
                            className="py-2 text-[calc(13rem/14)] text-muted-foreground"
                            role="status"
                          >
                            {turn.status === 'running' ? (
                              <span className="flex flex-wrap items-center gap-2 text-xs">
                                {t(turn.sourceImageId ? 'Editing image…' : 'Generating image…')}
                                <span className="text-xs">{t('Up to 300 seconds per image')}</span>
                              </span>
                            ) : (
                              <p className={turn.status === 'failed' ? 'text-destructive' : ''}>
                                {turn.error ||
                                  t(
                                    turn.status === 'cancelled'
                                      ? 'Cancelled'
                                      : 'Image generation failed'
                                  )}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottom} />
              </div>
            </div>
          )}
          <div className="shrink-0 px-6 pb-6 pt-3">
            <div className="mx-auto max-w-[820px]">
              {(!ready || providerError) && (
                <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  <span>{providerError || t('Connect your image service to start drawing.')}</span>
                  <button
                    type="button"
                    onClick={configure}
                    className="shrink-0 text-primary hover:underline"
                  >
                    {t('Configure image service')}
                  </button>
                </div>
              )}
              {error && (
                <p role="alert" className="mb-2 break-words text-xs text-destructive">
                  {error}
                </p>
              )}
              <div
                data-slot="composer"
                className="rounded-2xl border border-border bg-card p-3.5 shadow-sm focus-within:border-ring"
              >
                {source && activeId && (
                  <div className="mb-2 flex items-center gap-2">
                    <div className="size-12 overflow-hidden rounded-md border border-border">
                      <StudioThumbnail
                        key={`${activeId}:${source}`}
                        sessionId={activeId}
                        imageId={source}
                        alt={t('Reference image')}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {t('Reference image · A new file will be created')}
                    </span>
                    <button
                      type="button"
                      className={iconButton}
                      aria-label={t('Remove reference image')}
                      onClick={() => actions.setSource(activeId)}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                )}
                <textarea
                  ref={input}
                  aria-label={t('Image prompt')}
                  placeholder={t('Describe your image, or add a reference image…')}
                  value={draft}
                  onChange={(event) => actions.setDraft(activeId ?? '', event.target.value)}
                  maxLength={IMAGE_PROMPT_MAX}
                  rows={2}
                  className="block max-h-40 min-h-14 w-full resize-none bg-transparent px-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="mt-3 flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    aria-label={t('Add reference image')}
                    title={t('Add reference image')}
                    className={cn(iconButton, 'size-7')}
                    disabled={!view?.config.imageToImage || running || submitting}
                    onClick={() => void attach()}
                  >
                    <Paperclip className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="flex h-7 items-center gap-1.5 rounded-md bg-secondary px-2.5 text-xs text-secondary-foreground"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Image className="size-3.5" />
                    {t('Draw')}
                  </button>
                  <button
                    type="button"
                    className={chip}
                    aria-label={t('Quantity')}
                    onClick={() => setSettingsOpen(true)}
                  >
                    {options.count === 1 ? t('1 image') : t('{{n}} images', { n: options.count })}
                  </button>
                  <div className="ml-auto flex min-w-0 items-center gap-1">
                    <button
                      type="button"
                      className={cn(chip, 'max-w-48 font-mono')}
                      onClick={() => setSettingsOpen(true)}
                      title={model}
                    >
                      <span className="truncate">{model || t('Model')}</span>
                      <ChevronDown className="size-3 shrink-0" />
                    </button>
                    <button type="button" className={chip} onClick={() => setSettingsOpen(true)}>
                      {options.resolution === 'auto' ? t('Auto') : options.resolution.toUpperCase()}
                      <ChevronDown className="size-3" />
                    </button>
                    <button
                      type="button"
                      className="ml-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:bg-primary/25 disabled:text-primary"
                      aria-label={t(running ? 'Stop generating' : 'Generate image')}
                      title={t(running ? 'Stop generating' : 'Generate image')}
                      disabled={!running && (!ready || !draft.trim() || submitting)}
                      onClick={() =>
                        running && activeId ? void actions.cancel(activeId) : void send()
                      }
                    >
                      {running ? (
                        <Square className="size-3.5 fill-current" />
                      ) : submitting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ArrowUp className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
        {historyOpen && (
          <ResizeHandle onResize={onHistoryResize} onResizingChange={onHistoryResizingChange} />
        )}
        {historyOpen && (
          <aside
            className="flex min-w-0 shrink-0 flex-col overflow-hidden border-l border-line"
            style={{ width: historyWidth }}
            data-slot="image-studio-history"
            aria-label={t('Image history')}
          >
            <div className="flex h-[44px] shrink-0 px-3">
              <span className={cn(tab, activeTab, 'font-medium')}>
                <Image className="size-3.5" />
                {t('Image history')}
                <button
                  type="button"
                  aria-label={t('Close image history')}
                  onClick={actions.toggleHistory}
                >
                  <X className="size-3" />
                </button>
              </span>
            </div>
            <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-y border-line px-3 py-1">
              {(['all', 'generate', 'edit'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs',
                    filter === value
                      ? 'bg-selection text-selection-foreground'
                      : 'text-muted-foreground hover:bg-accent'
                  )}
                  onClick={() => setFilter(value)}
                >
                  {t(
                    value === 'all' ? 'All' : value === 'generate' ? 'Text to image' : 'Edit image'
                  )}
                </button>
              ))}
              <span className="ml-auto text-[calc(11rem/14)] text-muted-foreground tabular-nums">
                {images.length} · {t('By time')}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!images.length ? (
                <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                  {t('Generated images will appear here.')}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {images.slice(0, historyLimit).map(({ turn, image }) => (
                      <div key={image.id}>
                        <div className="aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted">
                          <StudioHistoryImage
                            sessionId={activeId!}
                            imageId={image.id}
                            prompt={turn.prompt}
                            onOpen={() =>
                              setPreview({
                                sessionId: activeId!,
                                imageId: image.id,
                                prompt: turn.prompt,
                              })
                            }
                          />
                        </div>
                        <p className="mt-1.5 truncate font-mono text-[calc(11rem/14)] text-muted-foreground">
                          {turn.size || t('Service default')}
                        </p>
                      </div>
                    ))}
                  </div>
                  {images.length > historyLimit && (
                    <Button
                      variant="ghost"
                      className="mt-3 w-full"
                      onClick={() => setHistoryLimit(historyLimit + 40)}
                    >
                      {t('Load more')}
                    </Button>
                  )}
                </>
              )}
            </div>
            <p className="border-t border-line px-3 py-2 text-[calc(11rem/14)] leading-relaxed text-muted-foreground">
              {t('Saved in .xiaoman/images/ by conversation. Originals stay unchanged.')}
            </p>
          </aside>
        )}
      </div>
      <StudioSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        options={effectiveOptions}
        models={models}
        onSave={setOptions}
      />
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="max-w-[1000px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('Image preview')}</DialogTitle>
            <DialogDescription className="truncate">{preview?.prompt}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {preview && (
              <StudioOriginalPreview sessionId={preview.sessionId} imageId={preview.imageId} />
            )}
          </DialogPanel>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteId(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Delete conversation')}</DialogTitle>
            <DialogDescription>
              {t(
                'This permanently deletes this image conversation, its generated images and imported references from this device.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {t('This cannot be undone. Export images you want to keep first.')}
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteId(null)}>
              {t('Cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={
                deleting || (deleteId ? !!useImageStudioStore.getState().pending[deleteId] : false)
              }
              onClick={async () => {
                if (!deleteId) return;
                setDeleting(true);
                await actions.remove(deleteId);
                setDeleting(false);
                if (!useImageStudioStore.getState().summaries.some((item) => item.id === deleteId))
                  setDeleteId(null);
              }}
            >
              {deleting && <Loader2 className="size-3.5 animate-spin" />}
              {t('Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {loading && !summaries.length && (
        <span className="sr-only" role="status">
          {t('Loading')}
        </span>
      )}
    </section>
  );
}

function StudioHistoryImage({
  sessionId,
  imageId,
  prompt,
  onOpen,
}: {
  sessionId: string;
  imageId: string;
  prompt: string;
  onOpen(): void;
}) {
  // A lazy mount keeps large histories from reading every original at once.
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="size-full" title={prompt}>
      <button
        type="button"
        className="size-full cursor-zoom-in"
        aria-label={prompt}
        onClick={onOpen}
      >
        {visible && <StudioThumbnail sessionId={sessionId} imageId={imageId} alt={prompt} />}
      </button>
    </div>
  );
}

function StudioOriginalPreview({ sessionId, imageId }: { sessionId: string; imageId: string }) {
  const { t } = useI18n();
  const { src, error } = useStudioImage(sessionId, imageId);
  return src ? (
    <img
      src={src}
      alt={t('Image preview')}
      className="mx-auto max-h-[70vh] max-w-full object-contain"
    />
  ) : (
    <div role="status" className="flex min-h-40 items-center justify-center text-muted-foreground">
      {error ? t('Image file unavailable') : <Loader2 className="size-5 animate-spin" />}
    </div>
  );
}
