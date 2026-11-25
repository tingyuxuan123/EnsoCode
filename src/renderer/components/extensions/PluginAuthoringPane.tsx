import type { PluginAuthoringValidationResult } from '@shared/extensionPlugins/types';
import { ArrowUpRight, Check, Clipboard, FileCode2, FlaskConical, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { requestFocusComposer } from '@/components/chat/composerMentionBridge';
import { Button } from '@/components/ui/button';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { openSidePanelFile, type PluginAuthoringPanelParams } from '@/lib/sidePanelDock';
import { NativePluginFlows } from '@/plugins/NativePluginFlows';
import { useNativePluginManager } from '@/plugins/useNativePluginManager';
import { fillPluginAuthoringDraft, readEmptyAuthoringDraft } from './pluginAuthoringDraft';

export function PluginAuthoringPane({
  sessionId,
  id,
  directory,
  prompt,
  filled,
}: PluginAuthoringPanelParams) {
  const { t } = useI18n();
  const native = useNativePluginManager();
  const [check, setCheck] = useState<PluginAuthoringValidationResult>();
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);
  const [insertedPrompt, setInsertedPrompt] = useState(filled ? prompt : '');
  const [draftError, setDraftError] = useState(false);
  const inComposer = filled || insertedPrompt === prompt;
  const installed = native.plugins.find((plugin) => plugin.id === id);
  const api = window.electronAPI?.extensionPlugins;

  const validate = async () => {
    if (inFlight.current || native.busy || !api) return;
    inFlight.current = true;
    setChecking(true);
    setCheck(undefined);
    try {
      setCheck(await api.validateAuthoringDraft(sessionId, id));
    } catch (reason) {
      setCheck({ ok: false, error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };

  const insert = () => {
    const inserted = fillPluginAuthoringDraft(
      sessionId,
      readEmptyAuthoringDraft(sessionId),
      prompt
    );
    setDraftError(!inserted);
    if (inserted) {
      setInsertedPrompt(prompt);
      requestFocusComposer();
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      addToast({ type: 'success', title: t('Copied') });
    } catch {
      addToast({ type: 'error', title: t('Copy failed') });
    }
  };

  return (
    <section data-slot="plugin-authoring-pane" className="h-full overflow-y-auto px-5 py-5 text-sm">
      <div className="mx-auto max-w-lg space-y-5">
        <header className="space-y-1">
          <FileCode2 className="mb-2 size-5 text-brand" aria-hidden />
          <h2 className="font-semibold text-base">{t('Plugin authoring')}</h2>
          <p className="text-muted-foreground text-xs">
            {t('A local draft. Nothing is installed until you review and confirm permissions.')}
          </p>
        </header>
        <div className="space-y-1.5">
          <p className="font-medium">{t('1. Edit your plugin')}</p>
          <code className="block break-all text-muted-foreground text-xs">{directory}/</code>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            onClick={() => openSidePanelFile(sessionId, `${directory}/enso-plugin.json`)}
          >
            {t('Open plugin manifest')} <ArrowUpRight />
          </Button>
          <p className="text-muted-foreground text-xs">
            {t(
              inComposer
                ? 'The request was placed in your chat draft. Send it when ready, or edit the files yourself.'
                : 'Your existing chat draft was left untouched. Use an empty composer or copy the request.'
            )}
          </p>
          {!inComposer && (
            <div className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" onClick={insert}>
                {t('Fill chat draft')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void copy()}>
                <Clipboard />
                {t('Copy request')}
              </Button>
            </div>
          )}
          {draftError && !inComposer && (
            <p role="alert" className="text-destructive text-xs">
              {t('The composer is not empty or is unavailable.')}
            </p>
          )}
        </div>
        <div className="space-y-2 border-line border-t pt-4">
          <p className="font-medium">{t('2. Validate the files')}</p>
          <p className="text-muted-foreground text-xs">
            {t('Checks the manifest and referenced files without running plugin code.')}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={checking || !!native.busy}
            onClick={() => void validate()}
          >
            <ShieldCheck />
            {t(checking ? 'Validating plugin…' : 'Run static validation')}
          </Button>
          {check?.ok && (
            <div role="status" className="break-words text-xs">
              <p className="flex items-center gap-1 text-success">
                <Check className="size-3.5 shrink-0" />
                {t('Static validation passed')}
              </p>
              <p className="mt-1 text-muted-foreground">
                {check.name} · {check.version}
              </p>
              {check.warnings.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {[...new Set(check.warnings)].map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {check && !check.ok && (
            <p role="alert" className="break-words text-destructive text-xs">
              {check.error}
            </p>
          )}
        </div>
        <div className="space-y-2 border-line border-t pt-4">
          <p className="font-medium">{t('3. Try it locally')}</p>
          <p className="text-muted-foreground text-xs">
            {t('Review the current files and their permissions before installing a local copy.')}
          </p>
          <Button
            size="sm"
            disabled={!check?.ok || checking || !native.canManage || !!native.busy}
            onClick={() => void native.stageAuthoringDraft(sessionId, id)}
          >
            <FlaskConical />
            {t('Review permissions and try')}
          </Button>
          {installed && (
            <p role="status" className="break-words text-muted-foreground text-xs">
              {t('Installed version: {{version}}', { version: installed.version })}
            </p>
          )}
          {native.error && !native.preview && (
            <p role="alert" className="break-words text-destructive text-xs">
              {native.error}
            </p>
          )}
        </div>
      </div>
      <NativePluginFlows manager={native} />
    </section>
  );
}
