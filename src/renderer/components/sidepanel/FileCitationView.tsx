import { saveCitationGestureKey } from '@shared/fileCitationGesture';
import type { IDockviewPanelProps } from 'dockview-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/chat/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { type FileCitationPanelParams, registerFileCitationCloser } from '@/lib/sidePanelDock';

const forEditor = (body: string) => body.replace(/\r\n?/g, '\n');

/** This editor can save only the version returned for the clicked citation. Nothing is autosaved. */
export function FileCitationView({ api, params }: IDockviewPanelProps<FileCitationPanelParams>) {
  const { t } = useI18n();
  const editor = useRef<HTMLTextAreaElement>(null);
  const [doc, setDoc] = useState(() => ({
    base: params.content,
    draft: forEditor(params.content),
    revision: params.revision,
  }));
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const dirty = doc.draft !== forEditor(doc.base);
  const binding = doc.revision && {
    conversationId: params.conversationId,
    projectId: params.projectId,
    citationId: params.citationId,
    revision: doc.revision,
  };
  const saveGesture = binding
    ? {
        'data-file-citation-action': 'save',
        'data-file-citation-key': saveCitationGestureKey(binding),
      }
    : {};

  useEffect(() => {
    setDoc((current) =>
      current.draft === forEditor(current.base)
        ? {
            base: params.content,
            draft: forEditor(params.content),
            revision: params.revision,
          }
        : current
    );
  }, [params.content, params.revision]);

  useEffect(
    () =>
      registerFileCitationCloser(api, () => {
        if (saving) return;
        if (dirty) setConfirmClose(true);
        else api.close();
      }),
    [api, dirty, saving]
  );

  useLayoutEffect(() => {
    const line = params.line;
    if (!Number.isSafeInteger(line) || !line || line < 1) return;
    const jump = () => {
      const input = editor.current;
      if (!input?.clientHeight) return false;
      const lines = forEditor(params.content).split('\n');
      if (line > lines.length) return true;
      const start = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
      input.setSelectionRange(start, start);
      const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight);
      input.scrollTop = Math.max(0, lineHeight * (line - 1) - input.clientHeight / 2);
      return true;
    };
    if (jump()) return;
    const listener = api.onDidVisibilityChange(({ isVisible }) => {
      if (isVisible && jump()) listener.dispose();
    });
    return () => listener.dispose();
  }, [api, params]);

  const save = async () => {
    if (!binding || !dirty || saving) return;
    const draft = doc.draft;
    const body =
      doc.base.includes('\r\n') && !doc.base.replace(/\r\n/g, '').includes('\n')
        ? draft.replace(/\n/g, '\r\n')
        : draft;
    setSaving(true);
    try {
      const result = await window.electronAPI.workspaceFiles.saveCitation({
        ...binding,
        content: body,
      });
      if (!result.ok) {
        addToast({
          type: 'error',
          title: t('Could not save external file'),
          description:
            result.error === 'conflict'
              ? t('This file changed on disk. Your edits were not written.')
              : t('The linked file or folder is unavailable.'),
        });
        return;
      }
      setDoc((current) => ({ ...current, base: body, revision: result.revision }));
    } catch {
      addToast({ type: 'error', title: t('Could not save external file') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label={t(doc.revision ? 'External file' : 'Read-only file preview')}
      className="flex h-full min-w-0 flex-col"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 text-xs text-muted-foreground">
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5">
          {t(doc.revision ? 'External file' : 'Read-only')}
        </span>
        <span title={params.path} className="min-w-0 flex-1 truncate select-text">
          {params.path}
        </span>
        {params.line ? <span className="shrink-0 tabular-nums">:{params.line}</span> : null}
        {binding && (
          <Button
            {...saveGesture}
            size="sm"
            variant="outline"
            type="button"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {t('Save')}
          </Button>
        )}
      </header>
      <textarea
        {...saveGesture}
        ref={editor}
        aria-label={params.path}
        className="min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none"
        value={doc.draft}
        readOnly={!binding}
        spellCheck={false}
        wrap="off"
        onChange={(event) => {
          const draft = event.currentTarget.value;
          setDoc((current) => ({ ...current, draft }));
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            event.stopPropagation();
            void save();
          }
        }}
      />
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t('Unsaved changes')}
        description={t('This file has unsaved changes. Close anyway?')}
        confirmLabel={t('Close')}
        onConfirm={() => api.close()}
      />
    </section>
  );
}
