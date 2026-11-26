import type {
  PluginAuthoringInspection,
  PluginAuthoringInspectResult,
} from '@shared/extensionPlugins/types';
import {
  ArrowUpRight,
  FileCode2,
  FlaskConical,
  Package,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/chat/ConfirmDialog';
import { requestFocusComposer } from '@/components/chat/composerMentionBridge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/i18n';
import {
  openSidePanelFile,
  openSidePanelPluginView,
  type PluginAuthoringPanelParams,
} from '@/lib/sidePanelDock';
import { NativePluginFlows, PLUGIN_TRUST_WARNING } from '@/plugins/NativePluginFlows';
import { useNativePluginManager } from '@/plugins/useNativePluginManager';
import { usePluginViews } from '@/plugins/viewBridge';
import { openPluginWorkspace } from '@/plugins/workspaceViews';
import { useSessionsStore } from '@/stores/sessions';
import { useSidePanelStore } from '@/stores/sidePanel';
import { authoringCheckLabel } from './authoringStatus';
import {
  buildPluginAuthoringPrompt,
  fillPluginAuthoringDraft,
  readEmptyAuthoringDraft,
} from './pluginAuthoringDraft';

export function PluginAuthoringPane(props: PluginAuthoringPanelParams) {
  const { sessionId, id, directory, prompt } = props;
  const { t, locale } = useI18n(),
    native = useNativePluginManager(),
    views = usePluginViews();
  const api = window.electronAPI.extensionPlugins;
  const [inspection, setInspection] = useState<PluginAuthoringInspectResult>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState(''),
    [proofNote, setProofNote] = useState(''),
    [models, setModels] = useState('');
  const [confirm, setConfirm] = useState<'test' | 'finish' | 'rollback' | null>(null);
  const [logs, setLogs] = useState('');
  const mounted = useRef(true),
    epoch = useRef(0),
    inFlight = useRef(false),
    readSequence = useRef(0);
  const info: PluginAuthoringInspection | undefined = inspection?.ok ? inspection : undefined;
  const current = () => mounted.current && useSessionsStore.getState().activeId === sessionId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, []);
  const refresh = useCallback(async () => {
    const seq = ++readSequence.current,
      turn = epoch.current;
    const result = await api.inspectAuthoringDraft(sessionId, id);
    if (mounted.current && turn === epoch.current && seq === readSequence.current)
      setInspection(result);
  }, [api, sessionId, id]);
  useEffect(() => {
    epoch.current++;
    setInspection(undefined);
    setError('');
    setMessage('');
    setFeedback('');
    setLogs('');
    let gone = false;
    void api
      .openAuthoringDraft(sessionId, id)
      .then((result) => {
        if (!gone) {
          if (!result.ok) setError(result.error);
          else void refresh();
        }
      })
      .catch((reason) => {
        if (!gone) setError(String(reason));
      });
    return () => {
      gone = true;
      epoch.current++;
    };
  }, [api, sessionId, id, refresh]);
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current || native.busy || !current()) return;
    const generation = epoch.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
      if (current() && generation === epoch.current) await refresh();
    } catch (reason) {
      if (current() && generation === epoch.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      inFlight.current = false;
      if (mounted.current && generation === epoch.current) setBusy(false);
    }
  };
  const disabled = busy || !!native.busy;
  const insert = (request: string) => {
    if (!current()) return;
    const draft = info?.draft ?? props,
      text = buildPluginAuthoringPrompt(draft, request, locale);
    if (!fillPluginAuthoringDraft(sessionId, readEmptyAuthoringDraft(sessionId), text))
      setError(t('The composer is not empty or is unavailable.'));
    else {
      requestFocusComposer();
      setMessage(t('The request is ready in the composer. Nothing was sent.'));
    }
  };
  const openTrial = () =>
    void run(async () => {
      const result = await api.loadAuthoringTrial(sessionId, id);
      if (!result.ok || !result.id) throw Error(result.error ?? t('Trial is not installed'));
      const view = views.find((view) => view.pluginId === result.id);
      if (!view && result.views?.length)
        throw Error(t('Trial view is still loading. Refresh and open it again.'));
      if (view) {
        if (view.location === 'activitybar') openPluginWorkspace(view, sessionId);
        else
          openSidePanelPluginView({
            conversationId: sessionId,
            pluginId: view.pluginId,
            viewId: view.id,
            title: view.title,
          });
      } else if (result.commands?.[0]) {
        const call = await api.call({
          pluginId: result.id,
          method: 'command.run',
          payload: { id: result.commands[0].id },
          sessionId,
        });
        if (!call.ok) throw Error(call.error);
      } else
        setMessage(t('Headless trial ready. Use a new conversation to verify its model tools.'));
    });
  const mark = (layer: 'business' | 'models') =>
    void run(async () => {
      if (!info) return;
      const result = await api.authoringEvidence(sessionId, id, {
        layer,
        sourceHash: info.sourceHash,
        note: proofNote,
        ...(layer === 'models'
          ? {
              models: models
                .split(/[,，\n]/)
                .map((value) => value.trim())
                .filter(Boolean),
            }
          : {}),
      });
      if (!result.ok) throw Error(result.error);
      setMessage(t('User-reported evidence saved for these exact files.'));
    });
  return (
    <section
      data-slot="plugin-authoring-pane"
      className="h-full min-w-0 overflow-y-auto break-words px-4 py-5 text-sm [&_button]:h-auto [&_button]:min-h-7 [&_button]:max-w-full [&_button]:whitespace-normal"
    >
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold text-base">
              <FileCode2 className="size-4 text-brand" />
              {t('Plugin authoring')}
            </h2>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void run(refresh)}>
              <RefreshCw />
              {t('Refresh source checks')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => useSidePanelStore.getState().maximize(sessionId)}
            >
              {t('Expand authoring panel')}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {t(
              'Edit, test a separate copy, then explicitly install or export. Publishing is a separate action.'
            )}
          </p>
          <code className="block break-all text-xs">{directory}/</code>
          {info && (
            <p className="text-muted-foreground text-xs">
              {t('Authoring host')}: {info.capabilities.hostVersion} · {info.name} {info.version} ·{' '}
              {t('Source fingerprint')}: {info.sourceHash.slice(0, 12)}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openSidePanelFile(sessionId, `${directory}/enso-plugin.json`)}
            >
              {t('Open plugin manifest')}
              <ArrowUpRight />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openSidePanelFile(sessionId, `${directory}/HOST-CAPABILITIES.md`)}
            >
              {t('Host capability contract')}
            </Button>
          </div>
        </header>
        {(error || (inspection && !inspection.ok)) && (
          <p role="alert" className="whitespace-pre-wrap break-words text-destructive text-xs">
            {error || (inspection && !inspection.ok ? inspection.error : '')}
          </p>
        )}
        {message && (
          <p role="status" className="text-muted-foreground text-xs">
            {message}
          </p>
        )}
        <section className="space-y-2 border-t border-line pt-4">
          <h3 className="font-medium">{t('1. Describe and refine')}</h3>
          <Textarea
            aria-label={t('Changes or acceptance criteria')}
            value={feedback}
            maxLength={4000}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={t('What should change? Keep the same plugin ID and data.')}
            disabled={disabled}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                insert(
                  feedback.trim() ||
                    info?.draft.request ||
                    props.request ||
                    t('Continue editing this plugin')
                )
              }
            >
              {t('Prepare change request')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                if (!current()) return;
                if (fillPluginAuthoringDraft(sessionId, readEmptyAuthoringDraft(sessionId), prompt))
                  requestFocusComposer();
                else setError(t('The composer is not empty or is unavailable.'));
              }}
            >
              {t('Fill original request')}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {t(
              'Existing composer text is never overwritten. You decide when to send and pay for model calls.'
            )}
          </p>
        </section>
        <section className="space-y-2 border-t border-line pt-4">
          <h3 className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-4" />
            {t('2. Verify each layer')}
          </h3>
          {info && (
            <ul className="space-y-2">
              {(['static', 'tests', 'runtime', 'business', 'models'] as const).map((layer) => (
                <li key={layer} className="text-xs">
                  <div className="flex justify-between gap-2">
                    <span>
                      {t(
                        {
                          static: 'Static manifest and capabilities',
                          tests: 'Automated behavior tests',
                          runtime: 'Trial runtime',
                          business: 'Business workflow',
                          models: 'Two-vendor model tools',
                        }[layer]
                      )}
                    </span>
                    <span
                      className={
                        info.checks[layer].state === 'passed'
                          ? 'text-success'
                          : info.checks[layer].state === 'failed'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                      }
                    >
                      {t(authoringCheckLabel(info.checks[layer]))}
                    </span>
                  </div>
                  <details className="mt-1 text-muted-foreground">
                    <summary>{t('Evidence and scope')}</summary>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
                      {info.checks[layer].detail}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || !info}
            onClick={() => setConfirm('test')}
          >
            {t('Run plugin behavior tests…')}
          </Button>
          <p className="text-muted-foreground text-xs">
            {t(
              'Static checks do not execute code. Behavior tests execute trusted Node code with no inherited provider credentials; this is not an OS sandbox.'
            )}
          </p>
          {info?.warnings.map((warning) => (
            <p
              key={warning}
              className="rounded border border-line bg-muted/40 px-2 py-1 text-muted-foreground text-xs"
            >
              {warning}
            </p>
          ))}
        </section>
        <section className="space-y-2 border-t border-line pt-4">
          <h3 className="flex items-center gap-2 font-medium">
            <FlaskConical className="size-4" />
            {t('3. Try without production data')}
          </h3>
          <p className="text-muted-foreground text-xs">
            {t(
              'The trial has a separate plugin ID, configuration and data directory. Node code remains trusted code, not a sandbox.'
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || !info}
              onClick={() => void native.stageAuthoringTrial(sessionId, id)}
            >
              {t('Review permissions and load trial')}
            </Button>
            <Button size="sm" disabled={disabled} onClick={openTrial}>
              {t('Open installed trial')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || !info?.trial}
              onClick={() => setConfirm('finish')}
            >
              {t('End trial…')}
            </Button>
          </div>
          {info?.trial && (
            <p className="text-xs">
              {info.trial.id} · {info.trial.version} ·{' '}
              {t(info.trial.current ? 'Matches source' : 'Source changed — reload trial')}
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || !info?.draft.trialId}
            onClick={() =>
              void run(async () => {
                const result = await api.logs(info?.draft.trialId ?? '');
                if (!result.ok) throw Error(result.error);
                if (current()) setLogs(result.text);
              })
            }
          >
            {t('Read trial logs')}
          </Button>
          {logs && (
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">
              {logs}
            </pre>
          )}
          <Textarea
            value={proofNote}
            maxLength={2000}
            aria-label={t('Verification result')}
            placeholder={t('Record the actual steps and results you verified.')}
            onChange={(e) => setProofNote(e.target.value)}
          />
          <Textarea
            value={models}
            maxLength={1000}
            aria-label={t('Verified vendor/model pairs')}
            placeholder="openai/model-name, deepseek/model-name"
            onChange={(e) => setModels(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || !proofNote.trim() || !info}
              onClick={() => mark('business')}
            >
              {t('Record business verification')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || !proofNote.trim() || !models.trim() || !info}
              onClick={() => mark('models')}
            >
              {t('Record two-vendor verification')}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {t(
              'These are explicitly user-reported results, not automatic proof. Any source change expires them.'
            )}
          </p>
        </section>
        <section className="space-y-2 border-t border-line pt-4">
          <h3 className="flex items-center gap-2 font-medium">
            <Package className="size-4" />
            {t('4. Deliver explicitly')}
          </h3>
          <p className="text-muted-foreground text-xs">
            {t(
              'Install preserves the permanent ID and existing data. Updates require a higher plugin version; review permissions and migration risks. Export does not install or publish.'
            )}
          </p>
          {info?.installed && (
            <p className="text-xs">
              {t('Installed version: {{version}}', { version: info.installed.version })} ·{' '}
              {t('Source version')}: {info.version}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={disabled || !info}
              onClick={() => void native.stageAuthoringDraft(sessionId, id)}
            >
              {t('Review and install production version')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || !info}
              onClick={() =>
                void run(async () => {
                  const result = await api.exportAuthoringDraft(sessionId, id);
                  if (!result.ok) throw Error(result.error);
                  if (!result.cancelled) setMessage(`${result.name}\nSHA-256 ${result.sha256}`);
                })
              }
            >
              {t('Export installable ZIP')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || !info?.rollbackAvailable}
              onClick={() => setConfirm('rollback')}
            >
              {t('Review previous code…')}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {t(
              'Code rollback never restores migrated data. Back up important data before installing updates. Nothing here releases CodeKiln or publishes to a marketplace.'
            )}
          </p>
        </section>
      </div>
      <NativePluginFlows manager={native} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t(
          confirm === 'test'
            ? 'Execute plugin tests?'
            : confirm === 'finish'
              ? 'Delete trial data?'
              : 'Review previous plugin code?'
        )}
        description={t(
          confirm === 'test'
            ? PLUGIN_TRUST_WARNING
            : confirm === 'finish'
              ? 'Only this trial copy and its test data are removed. Production data and source stay intact.'
              : 'The prior code is staged for permission review. Current data is not reverted; incompatible migrations may require manual recovery.'
        )}
        confirmLabel={t('Continue')}
        onConfirm={() => {
          if (confirm === 'test')
            void run(async () => {
              const result = await api.testAuthoringDraft(sessionId, id, true);
              if (!result.ok) throw Error(result.error);
              setMessage(result.passed ? t('Behavior tests passed') : t('Behavior tests failed'));
            });
          if (confirm === 'finish')
            void run(async () => {
              const result = await api.finishAuthoringTrial(sessionId, id, true);
              if (!result.ok) throw Error(result.error);
            });
          if (confirm === 'rollback') void native.rollbackAuthoringDraft(sessionId, id);
        }}
      />
    </section>
  );
}
