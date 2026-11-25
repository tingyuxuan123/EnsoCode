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
}: {
  onClose: () => void;
  onOpenConversation: () => void;
}) {
  const { t, locale } = useI18n();
  const sessionId = useSessionsStore((state) => state.activeId);
  // The dialog belongs to the session which opened it; an in-flight result must not follow a switch.
  const origin = useRef(sessionId);
  const target = authoringTarget(sessionId);
  const api = window.electronAPI?.extensionPlugins;
  const supported = typeof api?.createAuthoringDraft === 'function';
  const [request, setRequest] = useState('');
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
      const result = await api.createAuthoringDraft(id);
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
