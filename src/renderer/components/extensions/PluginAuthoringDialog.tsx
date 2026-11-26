import {
  AUTHORING_TEMPLATES,
  type AuthoringTemplate,
  recommendAuthoringTemplate,
} from '@shared/extensionPlugins/authoringContract';
import type {
  PluginAuthoringContextResult,
  PluginAuthoringDraft,
} from '@shared/extensionPlugins/types';
import { ArrowRight, FileCode2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { requestFocusComposer } from '@/components/chat/composerMentionBridge';
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
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/i18n';
import { addSidePanelPluginAuthoring } from '@/lib/sidePanelDock';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import { useSidePanelStore } from '@/stores/sidePanel';
import {
  buildPluginAuthoringPrompt,
  fillPluginAuthoringDraft,
  readEmptyAuthoringDraft,
} from './pluginAuthoringDraft';

const REQUEST_MAX = 4000;

function authoringTarget(sessionId: string | null) {
  const sessions = useSessionsStore.getState();
  if (!sessionId || sessions.activeId !== sessionId) return null;
  const conversation = sessions.conversations[sessionId];
  if (
    !conversation ||
    conversation.parentId ||
    conversation.btwParentId ||
    conversation.superAssistant ||
    conversation.activeTabId ||
    conversation.worktreeMissing
  )
    return null;
  const project = useSettingsStore
    .getState()
    .projects.find((item) => item.id === conversation.projectId);
  if (!project?.path || (project.kind && project.kind !== 'local')) return null;
  return {
    projectName: project.name || project.path.split(/[/\\]/).filter(Boolean).at(-1) || project.path,
    cwd: conversation.worktree?.path ?? project.path,
    projectId: project.id,
  };
}

export function PluginAuthoringDialog({
  onClose,
  onOpenConversation,
  installedId,
}: {
  onClose: () => void;
  onOpenConversation: () => void;
  installedId?: string;
}) {
  const { t, locale } = useI18n();
  const sessionId = useSessionsStore((state) => state.activeId);
  // The dialog belongs to the session which opened it; an in-flight result must not follow a switch.
  const origin = useRef(sessionId);
  const target = authoringTarget(sessionId);
  const api = window.electronAPI?.extensionPlugins;
  const supported =
    typeof api?.createAuthoringDraft === 'function' &&
    typeof api.authoringContext === 'function' &&
    typeof api.inspectAuthoringDraft === 'function';
  const [request, setRequest] = useState('');
  const [template, setTemplate] = useState<AuthoringTemplate | 'auto'>('auto');
  const [context, setContext] = useState<PluginAuthoringContextResult>();
  const chosen = template === 'auto' ? recommendAuthoringTemplate(request) : template;
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    if (sessionId && api?.authoringContext)
      void api
        .authoringContext(sessionId)
        .then((result) => {
          if (!disposed) setContext(result);
        })
        .catch((reason) => {
          if (!disposed) setError(String(reason));
        });
    return () => {
      disposed = true;
    };
  }, [sessionId, api]);
  const showDraft = (draft: PluginAuthoringDraft, description: string) => {
    const id = origin.current,
      current = authoringTarget(id);
    if (!id || !current || !mounted.current) return;
    const revision = readEmptyAuthoringDraft(id),
      text = buildPluginAuthoringPrompt(draft, description, locale),
      filled = fillPluginAuthoringDraft(id, revision, text);
    useSidePanelStore.getState().setFullscreen(false);
    addSidePanelPluginAuthoring({
      sessionId: id,
      projectId: current.projectId,
      cwd: current.cwd,
      ...draft,
      prompt: text,
      filled,
      title: t('Plugin authoring'),
    });
    onOpenConversation();
    if (filled)
      requestAnimationFrame(() => {
        if (authoringTarget(id)) requestFocusComposer();
      });
  };
  const reopen = async (pluginId: string, installed = false) => {
    const id = origin.current;
    if (!id || !authoringTarget(id) || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api.openAuthoringDraft(id, pluginId, installed);
      if (!mounted.current || !authoringTarget(id)) return;
      if (!result.ok) throw Error(result.error);
      showDraft(result.draft, result.draft.request ?? t('Continue editing this plugin'));
    } catch (reason) {
      if (mounted.current) setError(String(reason));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const start = async () => {
    const id = origin.current;
    const current = authoringTarget(id);
    const description = request.trim();
    if (
      !id ||
      !current ||
      !description ||
      description.length > REQUEST_MAX ||
      !supported ||
      inFlight.current
    )
      return;
    const revision = readEmptyAuthoringDraft(id);
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api.createAuthoringDraft(id, { template: chosen, request: description });
      const latest = authoringTarget(id);
      if (
        !mounted.current ||
        !latest ||
        latest.projectId !== current.projectId ||
        latest.cwd !== current.cwd
      )
        return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const text = buildPluginAuthoringPrompt(result.draft, description, locale);
      const filled = fillPluginAuthoringDraft(id, revision, text);
      useSidePanelStore.getState().setFullscreen(false);
      addSidePanelPluginAuthoring({
        sessionId: id,
        projectId: current.projectId,
        cwd: current.cwd,
        ...result.draft,
        prompt: text,
        filled,
        title: t('Plugin authoring'),
      });
      onOpenConversation();
      if (filled)
        requestAnimationFrame(() => {
          if (authoringTarget(id)) requestFocusComposer();
        });
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current) onClose();
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('Build your own plugin')}</DialogTitle>
            <DialogDescription>
              {t(
                'Describe what you want to make. CodeKiln creates a starter in this project and prepares a chat draft without sending it.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            {context?.ok && (
              <p className="text-muted-foreground text-xs">
                {t('Authoring host')}: {context.capabilities.hostVersion} ·{' '}
                {t('Native theme and isolated trial data')}
              </p>
            )}
            {context && !context.ok && (
              <p role="alert" className="text-destructive text-xs">
                {context.error}
              </p>
            )}
            {installedId && target && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void reopen(installedId, true)}
              >
                {t('Continue editing installed plugin')}
              </Button>
            )}
            {context?.ok && context.drafts.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm">
                  {t('Resume a plugin project')} ({context.drafts.length})
                </summary>
                <div className="mt-2 space-y-1">
                  {context.drafts.map((draft) => (
                    <Button
                      type="button"
                      key={draft.id}
                      variant="ghost"
                      className="h-auto w-full justify-start whitespace-normal text-left"
                      disabled={busy}
                      onClick={() => void reopen(draft.id)}
                    >
                      {draft.request?.slice(0, 70) || draft.id}
                      <span className="ml-2 text-muted-foreground text-xs">{draft.directory}</span>
                    </Button>
                  ))}
                </div>
              </details>
            )}
            {target && (
              <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-sm">
                <FileCode2 className="size-4 shrink-0" />
                <span className="truncate" title={target.cwd}>
                  {target.projectName}
                </span>
              </div>
            )}
            {!target || !supported ? (
              <p role="status" className="text-muted-foreground text-sm">
                {t(
                  !supported
                    ? 'Plugin authoring is unavailable in this version.'
                    : 'Open the main conversation of a local Code project, then return here to start.'
                )}
              </p>
            ) : (
              <div className="space-y-3">
                <label className="block space-y-2 text-sm">
                  <span>{t('What should your plugin do?')}</span>
                  <Textarea
                    maxLength={REQUEST_MAX}
                    disabled={busy}
                    value={request}
                    onChange={(event) => setRequest(event.target.value)}
                    placeholder={t('For example, add a sidebar for project notes.')}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>{t('Plugin entry')}</span>
                  <select
                    aria-label={t('Plugin entry')}
                    className="w-full rounded border border-border bg-background p-2"
                    value={template}
                    disabled={busy}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (
                        value === 'auto' ||
                        value === 'workspace' ||
                        value === 'sidebar' ||
                        value === 'command' ||
                        value === 'tool'
                      )
                        setTemplate(value);
                    }}
                  >
                    <option value="auto">{t('Recommend from the request')}</option>
                    {AUTHORING_TEMPLATES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {t(
                          {
                            workspace: 'Left workspace',
                            sidebar: 'Right helper panel',
                            command: 'Command only',
                            tool: 'Model tool only',
                          }[item.id]
                        )}
                      </option>
                    ))}
                  </select>
                  <p className="text-muted-foreground text-xs">
                    {t('Recommended entry')}:{' '}
                    {t(
                      {
                        workspace: 'Left workspace',
                        sidebar: 'Right helper panel',
                        command: 'Command only',
                        tool: 'Model tool only',
                      }[chosen]
                    )}{' '}
                    · {t('Uses native colors and typography by default.')}
                  </p>
                </label>
              </div>
            )}
            {error && (
              <p role="alert" className="break-words text-destructive text-sm">
                {error}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={!target || !supported || !request.trim() || busy}>
              {t(busy ? 'Creating plugin starter…' : 'Create plugin starter')} <ArrowRight />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
