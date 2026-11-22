import { VAULT_PRESETS, type VaultPreset } from '@shared/memory/constants';
import type {
  ChatModelDto,
  CompilableSessionDto,
  EmbeddingDownloadProgressDto,
  MemoryJobsSnapshot,
  MemoryLintReport,
  MemoryStats,
  VaultSpaceDto,
} from '@shared/memory/dto';
import { MEMORY_MODEL_IDLE_MINUTES } from '@shared/memory/modelIdle';
import * as React from 'react';
import { MODEL_PICKER_FORM_TRIGGER_CLASS, ModelPicker } from '@/components/chat/ModelPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useUsableProviders } from '@/stores/modelDirectory/useProviders';
import { useSettingsStore } from '@/stores/settings';
import { type JobKind, toJobRows } from './memoryJobRows';

const JOBS_POLL_MS = 4000;
const VISIBLE_JOBS = 6;

const JOB_KIND_LABELS: Record<JobKind, string> = {
  compile: 'job:compile',
};

const EMPTY_JOBS: MemoryJobsSnapshot = { compile: [] };

export function needsBulkPrompt(scope: readonly { compiled: boolean }[]): boolean {
  return scope.some((session) => session.compiled);
}

interface BulkPrompt {
  token: string;
  label: string;
  scope: CompilableSessionDto[];
  pending: CompilableSessionDto[];
}

export function localChatBlocksDistill(
  model: Pick<ChatModelDto, 'downloadable' | 'state'> | null
): 'missing' | 'downloading' | null {
  if (!model?.downloadable) return null;
  if (model.state === 'missing' || model.state === 'downloading') return model.state;
  return null;
}

export interface BatchProgress {
  done: number;
  total: number;
  startedAt: number;
}

export function estimateRemainingMs(progress: BatchProgress, now: number): number | null {
  if (progress.done === 0 || progress.done >= progress.total) return null;
  const perItem = (now - progress.startedAt) / progress.done;
  return Math.round(perItem * (progress.total - progress.done));
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
}

export interface SessionGroup {
  key: string;
  name: string;
  sessions: CompilableSessionDto[];
}

export function groupSessionsByProject(sessions: CompilableSessionDto[]): SessionGroup[] {
  const byProject = new Map<string, SessionGroup>();
  for (const session of sessions) {
    const key = session.projectId ?? '';
    const existing = byProject.get(key);
    if (existing) {
      existing.sessions.push(session);
      continue;
    }
    byProject.set(key, {
      key,
      name: session.projectName ?? 'No project',
      sessions: [session],
    });
  }
  const groups = [...byProject.values()];
  return [...groups.filter((g) => g.key), ...groups.filter((g) => !g.key)];
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exp).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

function SwitchRow({
  title,
  description,
  checked,
  onChange,
  rowId,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  rowId?: string;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-[16px] py-[10px]"
      data-settings-row={rowId}
    >
      <div className="min-w-0">
        <p className="text-[calc(13rem/14)]">{title}</p>
        <p className="text-[calc(12rem/14)] text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
    </div>
  );
}

const PRESET_LABELS: Record<VaultPreset, string> = {
  engineering: 'Engineering',
  personal: 'Personal',
  minimal: 'Minimal',
};

const LINT_LABELS: Record<MemoryLintReport['issues'][number]['kind'], string> = {
  broken_link: 'Broken link',
  orphan: 'Orphan note',
  stale: 'Stale note',
  unverified_draft: 'Old draft',
  missing_description: 'No summary',
  oversized: 'Oversized',
  revision_marker: 'Revision markers',
  duplicate_title: 'Duplicate title',
  status_oversized: 'Status too long',
  status_stale: 'Status stale',
  status_duplicate: 'Two status pages',
};

export function MemorySettings({ onLibraryChanged }: { onLibraryChanged?: () => void } = {}) {
  const { t } = useI18n();
  const disabledBuiltinTools = useSettingsStore((state) => state.disabledBuiltinTools);
  const modelIdleMinutes = useSettingsStore((state) => state.memoryModelIdleMinutes);
  const setModelIdleMinutes = useSettingsStore((state) => state.setMemoryModelIdleMinutes);
  const distillEnabled = useSettingsStore((state) => state.memoryDistillEnabled);
  const setDistillEnabled = useSettingsStore((state) => state.setMemoryDistillEnabled);
  const distillModel = useSettingsStore((state) => state.memoryDistillModel);
  const setDistillModel = useSettingsStore((state) => state.setMemoryDistillModel);
  const chatModel = useSettingsStore((state) => state.memoryChatModel) || 'remote';
  const setChatModel = useSettingsStore((state) => state.setMemoryChatModel);
  const memoryLanguage = useSettingsStore((state) => state.memoryLanguage);
  const setMemoryLanguage = useSettingsStore((state) => state.setMemoryLanguage);

  const modelCandidates = useUsableProviders();
  const distillProvider = distillModel
    ? modelCandidates.find((entry) => entry.id === distillModel.providerId)
    : undefined;
  const distillModelEntry = distillProvider?.models.find(
    (entry) => entry.id === distillModel?.modelId
  );

  const memoryEnabled = !disabledBuiltinTools.includes('memory');
  const [stats, setStats] = React.useState<MemoryStats | null>(null);
  const [jobs, setJobs] = React.useState<MemoryJobsSnapshot>(EMPTY_JOBS);
  const [chatModels, setChatModels] = React.useState<ChatModelDto[]>([]);
  const [chatProgress, setChatProgress] = React.useState<EmbeddingDownloadProgressDto | null>(null);
  const [sessions, setSessions] = React.useState<CompilableSessionDto[]>([]);
  const [compiling, setCompiling] = React.useState<string | null>(null);
  const [sessionsOf, setSessionsOf] = React.useState<SessionGroup | null>(null);
  const [batch, setBatch] = React.useState<BatchProgress | null>(null);
  const [bulkPrompt, setBulkPrompt] = React.useState<BulkPrompt | null>(null);
  const [allJobs, setAllJobs] = React.useState(false);
  const [rebuilding, setRebuilding] = React.useState(false);
  const [lintReport, setLintReport] = React.useState<MemoryLintReport | null>(null);
  const [linting, setLinting] = React.useState(false);
  const [schemaEditor, setSchemaEditor] = React.useState<{
    space: VaultSpaceDto;
    content: string;
    saving: boolean;
  } | null>(null);

  const loadRef = React.useRef<(() => void) | null>(null);

  const refreshSessions = React.useCallback(() => {
    void window.electronAPI.memory.distillableSessions().then(setSessions);
  }, []);

  React.useEffect(() => {
    if (memoryEnabled) refreshSessions();
  }, [memoryEnabled, refreshSessions]);

  const refreshChatModels = React.useCallback(() => {
    void window.electronAPI.memory
      .chatModels()
      .then((models) => setChatModels(models.filter((model) => !model.purpose)));
  }, []);

  React.useEffect(() => {
    refreshChatModels();
    return window.electronAPI.memory.onChatModelProgress((next) => {
      setChatProgress(next.done ? null : next);
      if (next.done) refreshChatModels();
    });
  }, [refreshChatModels]);

  React.useEffect(() => {
    if (!memoryEnabled) {
      setStats(null);
      setJobs(EMPTY_JOBS);
      return;
    }
    let cancelled = false;
    const load = () => {
      void window.electronAPI.memory.stats().then((next) => {
        if (!cancelled) setStats(next);
      });
      void window.electronAPI.memory.jobs().then((next) => {
        if (!cancelled) setJobs(next);
      });
    };
    loadRef.current = load;
    load();
    const offChanged = window.electronAPI.memory.onChanged(load);
    const timer = window.setInterval(load, JOBS_POLL_MS);
    return () => {
      cancelled = true;
      loadRef.current = null;
      offChanged();
      window.clearInterval(timer);
    };
  }, [memoryEnabled]);

  const groups = groupSessionsByProject(sessions);
  const pendingSessions = sessions.filter((session) => !session.compiled);

  const requestBulkCompile = (scope: CompilableSessionDto[], token: string, label: string) => {
    const pending = scope.filter((session) => !session.compiled);
    if (!needsBulkPrompt(scope)) {
      void runCompile(scope, token);
      return;
    }
    setBulkPrompt({ token, label, scope, pending });
  };

  const runCompile = async (targets: CompilableSessionDto[], token: string, force = false) => {
    const selected = chatModels.find((model) => model.id === chatModel) ?? null;
    if (localChatBlocksDistill(selected)) return;
    setCompiling(token);
    const startedAt = Date.now();
    setBatch({ done: 0, total: targets.length, startedAt });
    try {
      for (let i = 0; i < targets.length; i++) {
        await window.electronAPI.memory.distillSession(targets[i].sessionId, force);
        setBatch({ done: i + 1, total: targets.length, startedAt });
      }
    } finally {
      setCompiling(null);
      setBatch(null);
      refreshSessions();
      onLibraryChanged?.();
    }
  };

  const handleBindVault = async (spaceId: string) => {
    const res = await window.electronAPI.memory.bindVault(spaceId);
    if (res.cancelled) return;
    if (res.ok) {
      addToast({ type: 'success', title: t('Obsidian Vault bound') });
      loadRef.current?.();
      onLibraryChanged?.();
    } else {
      addToast({ type: 'error', title: t('Bind failed'), description: res.error });
    }
  };

  const handleUnbindVault = async (spaceId: string) => {
    const res = await window.electronAPI.memory.unbindVault(spaceId);
    if (res.ok) {
      addToast({ type: 'success', title: t('Obsidian Vault unbound') });
      loadRef.current?.();
      onLibraryChanged?.();
    } else {
      addToast({ type: 'error', title: t('Unbind failed'), description: res.error });
    }
  };

  const openSchema = async (space: VaultSpaceDto) => {
    const content = await window.electronAPI.memory.getSchema(space.spaceId);
    setSchemaEditor({ space, content, saving: false });
  };

  const saveSchema = async () => {
    if (!schemaEditor) return;
    setSchemaEditor({ ...schemaEditor, saving: true });
    const res = await window.electronAPI.memory.saveSchema(
      schemaEditor.space.spaceId,
      schemaEditor.content
    );
    if (res.ok) {
      setSchemaEditor(null);
      addToast({ type: 'success', title: t('Schema saved') });
    } else {
      setSchemaEditor({ ...schemaEditor, saving: false });
      addToast({ type: 'error', title: t('Save failed'), description: res.error });
    }
  };

  const applyPreset = async (spaceId: string, preset: VaultPreset) => {
    const res = await window.electronAPI.memory.applyPreset(spaceId, preset);
    if (res.ok && res.schema !== undefined) {
      setSchemaEditor((curr) =>
        curr && curr.space.spaceId === spaceId
          ? { ...curr, space: { ...curr.space, preset }, content: res.schema ?? curr.content }
          : curr
      );
      loadRef.current?.();
    }
  };

  const runLint = async () => {
    setLinting(true);
    try {
      const report = await window.electronAPI.memory.lint(null);
      setLintReport(report);
    } finally {
      setLinting(false);
    }
  };

  const selectedChatModel = chatModels.find((model) => model.id === chatModel) ?? null;
  const chatBlocked = localChatBlocksDistill(selectedChatModel);
  const chatModelItems = chatModels.map((model) => ({
    value: model.id,
    label: model.id === 'remote' ? t('Remote (API model)') : model.label,
  }));
  const modelIdleItems = MEMORY_MODEL_IDLE_MINUTES.map((minutes) => ({
    value: String(minutes),
    label: minutes === 0 ? t('Never') : t('{{count}} min', { count: minutes }),
  }));
  const languageItems = [
    { value: 'zh', label: t('Simplified Chinese') },
    { value: 'en', label: t('English') },
    { value: 'auto', label: t('Follow conversation') },
  ];
  const jobRows = React.useMemo(() => toJobRows(jobs), [jobs]);
  const spaces = stats?.spaces ?? [];

  return (
    <div className="space-y-[24px]" data-slot="settings-page" data-settings-row="memory.root">
      <section className="space-y-2">
        <h2 className="text-[calc(18rem/14)] font-semibold leading-[calc(26rem/14)]">
          {t('Memory')}
        </h2>
        <p className="text-[calc(13rem/14)] text-muted-foreground">
          {t(
            'Obsidian-compatible Markdown Wiki vaults (OKF v0.2 + [[wikilink]]) with a rebuildable local FTS5 search index.'
          )}
        </p>
        <p className="text-muted-foreground text-[calc(12rem/14)]">
          {t('Turn memory off in Built-in tools.')}
        </p>
      </section>

      <section className="space-y-2" data-settings-row="memory.stats">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[calc(14rem/14)] font-medium">{t('Wiki overview')}</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={!memoryEnabled || rebuilding}
            onClick={() => {
              setRebuilding(true);
              void window.electronAPI.memory
                .rebuildIndex()
                .then((res) => {
                  if (res.ok) addToast({ type: 'success', title: t('Search index rebuilt') });
                  else
                    addToast({ type: 'error', title: t('Rebuild failed'), description: res.error });
                  loadRef.current?.();
                  onLibraryChanged?.();
                })
                .finally(() => setRebuilding(false));
            }}
          >
            {rebuilding ? t('Rebuilding…') : t('Rebuild index')}
          </Button>
        </div>
        {stats === null || stats.totalNotes === 0 ? (
          <p className="text-[calc(12rem/14)] text-muted-foreground">{t('No wiki notes yet.')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('Notes')} value={String(stats.totalNotes)} />
            <Stat label={t('Wikilinks')} value={String(stats.totalLinks)} />
            <Stat label={t('Verified')} value={String(stats.verifiedCount)} />
            <Stat label={t('Draft')} value={String(stats.draftCount)} />
            <Stat label={t('Broken links')} value={String(stats.brokenLinks)} />
            <Stat label={t('Stale notes')} value={String(stats.staleCount)} />
            <Stat label={t('Archived')} value={String(stats.archivedCount)} />
            <Stat label={t('Index size')} value={formatBytes(stats.indexBytes)} />
          </div>
        )}
      </section>

      <section className="space-y-2" data-settings-row="memory.vaults">
        <div>
          <h3 className="text-[calc(14rem/14)] font-medium">{t('Spaces & Obsidian Vaults')}</h3>
          <p className="text-[calc(12rem/14)] text-muted-foreground">
            {t(
              'Each space stores plain Markdown files. Bind any space to an existing Obsidian Vault folder, or open it directly in Obsidian.'
            )}
          </p>
        </div>
        {spaces.length === 0 ? (
          <p className="text-[calc(12rem/14)] text-muted-foreground">
            {t('Spaces appear once memory is active.')}
          </p>
        ) : (
          <ul className="divide-y rounded-[6px] border">
            {spaces.map((space) => (
              <li key={space.spaceId} className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-[calc(13rem/14)]">{space.label}</span>
                      <Badge variant={space.isExternal ? 'default' : 'secondary'}>
                        {space.isExternal ? t('Obsidian Vault') : t('Managed')}
                      </Badge>
                      <Badge variant="outline">{t(PRESET_LABELS[space.preset])}</Badge>
                      <span className="text-muted-foreground text-[calc(12rem/14)]">
                        {t('{{count}} notes', { count: String(space.noteCount) })}
                        {space.draftCount > 0 ? ` · ${space.draftCount} ${t('Draft')}` : ''}
                        {space.brokenLinks > 0
                          ? ` · ${space.brokenLinks} ${t('Broken links')}`
                          : ''}
                      </span>
                    </div>
                    <p className="truncate font-mono text-muted-foreground text-[calc(11rem/14)]">
                      {space.rootPath}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        void window.electronAPI.memory.openVault({
                          spaceId: space.spaceId,
                          app: 'obsidian',
                        })
                      }
                    >
                      {t('Open in Obsidian')}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        void window.electronAPI.memory.openVault({
                          spaceId: space.spaceId,
                          app: 'folder',
                        })
                      }
                    >
                      {t('Open folder')}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => void openSchema(space)}>
                      {t('Edit schema.md')}
                    </Button>
                    {space.isExternal ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void handleUnbindVault(space.spaceId)}
                      >
                        {t('Unbind')}
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void handleBindVault(space.spaceId)}
                      >
                        {t('Bind Obsidian Vault')}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2" data-settings-row="memory.lint">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[calc(14rem/14)] font-medium">{t('Vault health')}</h3>
            <p className="text-[calc(12rem/14)] text-muted-foreground">
              {t(
                'Deterministic lint checks for broken [[wikilinks]], orphan notes, stale deadlines, old drafts, missing summaries, oversized pages, append-style revision markers, duplicate titles, and the one-screen status page budget.'
              )}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!memoryEnabled || linting}
            onClick={() => void runLint()}
          >
            {linting ? t('Checking…') : t('Run health check')}
          </Button>
        </div>
        {lintReport &&
          (lintReport.issues.length === 0 ? (
            <p className="rounded-[6px] border px-3 py-2 text-muted-foreground text-[calc(12rem/14)]">
              {t('Checked {{count}} notes — no issues found.', {
                count: String(lintReport.checkedNotes),
              })}
            </p>
          ) : (
            <ul className="max-h-64 divide-y overflow-auto rounded-[6px] border">
              {lintReport.issues.map((issue) => (
                <li
                  key={`${issue.noteId}:${issue.kind}:${issue.detail}`}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={issue.kind === 'broken_link' ? 'destructive' : 'outline'}>
                        {t(LINT_LABELS[issue.kind])}
                      </Badge>
                      <span className="truncate font-medium text-[calc(12rem/14)]">
                        {issue.title}
                      </span>
                      <span className="font-mono text-muted-foreground text-[calc(11rem/14)]">
                        [[{issue.slug}]]
                      </span>
                    </div>
                    <p className="text-muted-foreground text-[calc(11rem/14)]">
                      {issue.spaceLabel} · {issue.detail}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      void window.electronAPI.memory.openVault({
                        noteId: issue.noteId,
                        app: 'obsidian',
                      })
                    }
                  >
                    {t('Open in Obsidian')}
                  </Button>
                </li>
              ))}
            </ul>
          ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-[calc(14rem/14)] font-medium">{t('Wiki compiler')}</h3>
        <SwitchRow
          rowId="memory.distill"
          title={t('Compile sessions automatically')}
          description={t(
            'After each reply, this session checks the project wiki before the turn ends: it writes durable conclusions or reports that nothing changed. Follow-ups are reviewed with the latest answer.'
          )}
          checked={distillEnabled}
          onChange={setDistillEnabled}
          disabled={!memoryEnabled}
        />
        {distillEnabled && chatBlocked && (
          <p className="text-[calc(12rem/14)] text-destructive">
            {t(
              'Automatic compilation is on, but the local model is not ready. Sessions will queue until you download it.'
            )}
          </p>
        )}

        <div
          className="flex items-center justify-between gap-[16px] py-[10px]"
          data-settings-row="memory.language"
        >
          <div className="min-w-0">
            <p className="text-[calc(13rem/14)]">{t('Memory language')}</p>
            <p className="text-[calc(12rem/14)] text-muted-foreground">
              {t(
                'Language used when creating or compiling wiki notes (code identifiers stay verbatim).'
              )}
            </p>
          </div>
          <Select
            value={memoryLanguage}
            items={languageItems}
            onValueChange={(value) => setMemoryLanguage(String(value))}
            disabled={!memoryEnabled}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {languageItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-[16px] py-[10px]">
          <div className="min-w-0">
            <p className="text-[calc(13rem/14)]">{t('Compiler backend')}</p>
            <p className="text-[calc(12rem/14)] text-muted-foreground">
              {t(
                'Use a remote API model or download an offline local model for session compilation.'
              )}
            </p>
          </div>
          <Select
            value={chatModel}
            items={chatModelItems}
            onValueChange={(value) => setChatModel(String(value))}
            disabled={!memoryEnabled}
          >
            <SelectTrigger className="w-56 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {chatModelItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>

        {selectedChatModel?.downloadable && (
          <div
            className={cn(
              'flex items-center justify-between gap-[16px] py-[10px]',
              chatBlocked === 'missing' && 'border-destructive/50'
            )}
          >
            <div className="min-w-0">
              <p className="text-[calc(13rem/14)]">
                {selectedChatModel.state === 'ready'
                  ? t('Model downloaded')
                  : selectedChatModel.state === 'downloading'
                    ? t('Downloading…')
                    : t('Model not downloaded')}
              </p>
              <p className="text-[calc(12rem/14)] text-muted-foreground">
                {chatProgress && chatProgress.modelId === selectedChatModel.id
                  ? `${chatProgress.file} · ${formatBytes(chatProgress.received)}${
                      chatProgress.total ? ` / ${formatBytes(chatProgress.total)}` : ''
                    }`
                  : selectedChatModel.state === 'ready'
                    ? formatBytes(selectedChatModel.downloadedBytes)
                    : formatBytes(selectedChatModel.approxBytes)}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {selectedChatModel.state === 'downloading' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void window.electronAPI.memory
                      .cancelChatModelDownload(selectedChatModel.id)
                      .then(refreshChatModels);
                  }}
                >
                  {t('Cancel')}
                </Button>
              ) : selectedChatModel.state === 'ready' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void window.electronAPI.memory
                      .deleteChatModel(selectedChatModel.id)
                      .then(refreshChatModels);
                  }}
                >
                  {t('Remove')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!memoryEnabled}
                  onClick={() => {
                    void window.electronAPI.memory
                      .downloadChatModel(selectedChatModel.id)
                      .then(refreshChatModels);
                  }}
                >
                  {t('Download')}
                </Button>
              )}
            </div>
          </div>
        )}

        {chatModel === 'remote' && (
          <>
            <div className="flex items-center justify-between gap-[16px] py-[10px]">
              <div className="min-w-0">
                <p className="text-[calc(13rem/14)]">{t('Compiler model')}</p>
                <p className="text-[calc(12rem/14)] text-muted-foreground">
                  {t('Reads finished sessions and compiles durable wiki notes.')}
                </p>
              </div>
              {modelCandidates.length > 0 && (
                <div className="w-56 shrink-0">
                  <ModelPicker
                    providers={modelCandidates}
                    providerId={distillProvider?.id ?? ''}
                    modelId={distillModelEntry?.id ?? ''}
                    reasoningEnabled={false}
                    thinkingLevel="medium"
                    showReasoningControls={false}
                    emptyLabel={t('Follows the title-summary model')}
                    side="bottom"
                    triggerClassName={MODEL_PICKER_FORM_TRIGGER_CLASS}
                    onSelect={(providerId, modelId) => setDistillModel({ providerId, modelId })}
                    onReasoningChange={() => {}}
                    onThinkingChange={() => {}}
                  />
                </div>
              )}
            </div>
            {distillModel && (
              <Button variant="ghost" size="sm" onClick={() => setDistillModel(null)}>
                {t('Follows the title-summary model')}
              </Button>
            )}
          </>
        )}

        <div
          className="flex items-center justify-between gap-[16px] py-[10px]"
          data-settings-row="memory.modelIdleMinutes"
        >
          <div className="min-w-0">
            <p className="text-[calc(13rem/14)]">{t('Unload automatically when idle')}</p>
            <p className="text-[calc(12rem/14)] text-muted-foreground">
              {t(
                'Release local model memory after this idle period. Models load automatically the next time they are needed.'
              )}
            </p>
          </div>
          <Select
            value={String(modelIdleMinutes)}
            items={modelIdleItems}
            onValueChange={(value) => {
              if (value !== null) setModelIdleMinutes(Number(value));
            }}
            disabled={!memoryEnabled}
          >
            <SelectTrigger
              className="w-56 shrink-0"
              aria-label={t('Unload automatically when idle')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {modelIdleItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </section>

      <section className="space-y-2" data-settings-row="memory.distillSessions">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[calc(14rem/14)] font-medium">{t('Compile past sessions')}</h3>
          {pendingSessions.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={!memoryEnabled || compiling !== null || chatBlocked !== null}
              onClick={() => requestBulkCompile(sessions, 'all', t('All sessions'))}
            >
              {compiling === 'all'
                ? t('Compiling…')
                : t('Compile all ({{count}})', { count: String(pendingSessions.length) })}
            </Button>
          )}
        </div>
        <p className="text-[calc(12rem/14)] text-muted-foreground">
          {t(
            'The automatic switch only covers sessions that end from now on. Compile earlier sessions here to populate the wiki.'
          )}
        </p>
        {batch && (
          <p className="text-[calc(12rem/14)] text-muted-foreground">
            {t('{{done}}/{{total}} done', {
              done: String(batch.done),
              total: String(batch.total),
            })}
            {(() => {
              const remaining = estimateRemainingMs(batch, Date.now());
              return remaining === null
                ? ''
                : ` · ${t('about {{time}} left', { time: formatDuration(remaining) })}`;
            })()}
          </p>
        )}
        {groups.length === 0 ? (
          <p className="text-muted-foreground text-[calc(13rem/14)]">
            {t('No recorded sessions found.')}
          </p>
        ) : (
          <ul className="divide-y rounded-[6px] border">
            {groups.map((group) => {
              const groupPending = group.sessions.filter((s) => !s.compiled);
              return (
                <li key={group.key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[calc(13rem/14)]">{group.name}</p>
                    <p className="text-muted-foreground text-[calc(12rem/14)]">
                      {t('{{total}} sessions · {{pending}} not compiled', {
                        total: String(group.sessions.length),
                        pending: String(groupPending.length),
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setSessionsOf(group)}>
                      {t('View sessions')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        !memoryEnabled ||
                        compiling !== null ||
                        group.sessions.length === 0 ||
                        chatBlocked !== null
                      }
                      onClick={() => requestBulkCompile(group.sessions, group.key, group.name)}
                    >
                      {compiling === group.key ? t('Compiling…') : t('Compile project')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2" data-settings-row="memory.jobs">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[calc(14rem/14)] font-medium">{t('Background tasks')}</h3>
          <div className="flex items-center gap-1">
            {jobRows.some((row) => row.state !== 'running') && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void window.electronAPI.memory.clearJobs();
                }}
              >
                {t('Clear finished tasks')}
              </Button>
            )}
            {jobRows.length > VISIBLE_JOBS && (
              <Button size="sm" variant="ghost" onClick={() => setAllJobs(!allJobs)}>
                {allJobs
                  ? t('Show less')
                  : t('Show all {{count}}', { count: String(jobRows.length) })}
              </Button>
            )}
          </div>
        </div>
        {jobRows.length === 0 ? (
          <p className="text-muted-foreground text-[calc(13rem/14)]">{t('Nothing running.')}</p>
        ) : (
          <ul className="divide-y rounded-[6px] border">
            {(allJobs ? jobRows : jobRows.slice(0, VISIBLE_JOBS)).map((row) => (
              <li key={row.key} className="space-y-1 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant={row.state === 'failed' ? 'destructive' : 'secondary'}>
                    {t(JOB_KIND_LABELS[row.kind])}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[calc(13rem/14)]">
                    {row.target}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-[calc(12rem/14)]',
                      row.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                    )}
                  >
                    {row.state === 'running' ? `⋯ ${row.detail}` : row.detail}
                  </span>
                </div>
                {row.notes.map((note) => (
                  <p key={note} className="pl-1 text-muted-foreground text-[calc(12rem/14)]">
                    · {note}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={sessionsOf !== null} onOpenChange={(open) => !open && setSessionsOf(null)}>
        <DialogContent>
          {sessionsOf && (
            <>
              <DialogHeader>
                <DialogTitle>{sessionsOf.name}</DialogTitle>
                <DialogDescription>
                  {t('{{total}} sessions · {{pending}} not compiled', {
                    total: String(sessionsOf.sessions.length),
                    pending: String(sessionsOf.sessions.filter((s) => !s.compiled).length),
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogPanel>
                <ul className="divide-y rounded-[6px] border">
                  {sessionsOf.sessions.map((session) => (
                    <li
                      key={session.sessionId}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[calc(13rem/14)]">{session.title}</p>
                        <p className="text-muted-foreground text-[calc(12rem/14)]">
                          {session.updatedAt ? session.updatedAt.slice(0, 10) : ''}
                          {session.compiled ? ` · ${t('Already compiled')}` : ''}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!memoryEnabled || compiling !== null || chatBlocked !== null}
                        onClick={() =>
                          void runCompile([session], session.sessionId, session.compiled)
                        }
                      >
                        {compiling === session.sessionId
                          ? t('Compiling…')
                          : session.compiled
                            ? t('Compile again')
                            : t('Compile')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </DialogPanel>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" size="sm" />}>
                  {t('Close')}
                </DialogClose>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={bulkPrompt !== null} onOpenChange={(open) => !open && setBulkPrompt(null)}>
        <DialogContent>
          {bulkPrompt && (
            <>
              <DialogHeader>
                <DialogTitle>{t('Some sessions were already compiled')}</DialogTitle>
                <DialogDescription>{bulkPrompt.label}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" size="sm" />}>
                  {t('Cancel')}
                </DialogClose>
                {bulkPrompt.pending.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const next = bulkPrompt;
                      setBulkPrompt(null);
                      void runCompile(next.pending, next.token, false);
                    }}
                  >
                    {t('Only new ({{count}})', { count: String(bulkPrompt.pending.length) })}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => {
                    const next = bulkPrompt;
                    setBulkPrompt(null);
                    void runCompile(next.scope, next.token, true);
                  }}
                >
                  {t('Re-compile all ({{count}})', { count: String(bulkPrompt.scope.length) })}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={schemaEditor !== null} onOpenChange={(open) => !open && setSchemaEditor(null)}>
        <DialogContent className="sm:max-w-2xl">
          {schemaEditor && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {schemaEditor.space.label} · {t('schema.md')}
                </DialogTitle>
                <DialogDescription>
                  {t('Apply a preset template or edit the vault rules directly.')}
                </DialogDescription>
              </DialogHeader>
              <DialogPanel className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground text-[calc(12rem/14)]">
                    {t('Preset')}:
                  </span>
                  {VAULT_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      size="xs"
                      variant={schemaEditor.space.preset === preset ? 'default' : 'outline'}
                      onClick={() => void applyPreset(schemaEditor.space.spaceId, preset)}
                    >
                      {t(PRESET_LABELS[preset])}
                    </Button>
                  ))}
                </div>
                <Textarea
                  rows={14}
                  className="font-mono text-[calc(12rem/14)]"
                  value={schemaEditor.content}
                  onChange={(e) => setSchemaEditor({ ...schemaEditor, content: e.target.value })}
                />
              </DialogPanel>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" size="sm" />}>
                  {t('Cancel')}
                </DialogClose>
                <Button size="sm" disabled={schemaEditor.saving} onClick={() => void saveSchema()}>
                  {t('Save')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border px-3 py-2">
      <p className="text-muted-foreground text-[calc(12rem/14)]">{label}</p>
      <p className="text-[calc(13rem/14)]">{value}</p>
    </div>
  );
}
