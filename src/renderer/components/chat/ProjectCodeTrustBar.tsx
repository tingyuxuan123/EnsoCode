import { ShieldAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';

const EMPTY: string[] = [];

/** 项目带 pi 扩展/包等代码且未经确认时提示：worker 不加载它们，确认后记入项目信任列表 */
export function ProjectCodeTrustBar({
  projectId,
  conversationId,
}: {
  projectId: string;
  conversationId: string;
}) {
  const { t } = useI18n();
  const trusted = useSettingsStore(
    (state) =>
      state.projects.find((project) => project.id === projectId)?.trustedProjectCode ?? EMPTY
  );
  const setProjectTrustedCode = useSettingsStore((state) => state.setProjectTrustedCode);
  const [sources, setSources] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [justTrusted, setJustTrusted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDismissed(false);
    setJustTrusted(false);
    void window.electronAPI.projects
      .codeSources({ projectId, conversationId })
      .then((list) => {
        if (!cancelled) setSources(list);
      })
      .catch(() => {
        if (!cancelled) setSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, conversationId]);

  const untrusted = sources.filter((source) => !trusted.includes(source));
  if (dismissed || (untrusted.length === 0 && !justTrusted)) return null;

  if (untrusted.length === 0) {
    return (
      <div
        role="status"
        className="mb-[6px] flex items-center gap-[8px] rounded-[6px] border border-border/70 px-[12px] py-[6px] text-[calc(12rem/14)] text-muted-foreground"
      >
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          {t('Project extensions trusted. They load in new sessions and after this one restarts.')}
        </span>
        <button type="button" onClick={() => setDismissed(true)} title={t('Dismiss')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mb-[6px] flex items-start gap-[8px] rounded-[6px] border border-warning/40 bg-warning/5 px-[12px] py-[8px] text-[calc(12rem/14)] leading-[calc(20rem/14)]"
    >
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 space-y-1">
        <p>
          {t(
            'This project ships pi extension code that runs with your permissions. It was not loaded. Trust it only if you trust this repository.'
          )}
        </p>
        <p className="truncate font-mono text-muted-foreground" title={untrusted.join('\n')}>
          {untrusted.join(', ')}
        </p>
      </div>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          setProjectTrustedCode(projectId, sources);
          setJustTrusted(true);
        }}
      >
        {t('Trust and load')}
      </Button>
      <button type="button" onClick={() => setDismissed(true)} title={t('Dismiss')}>
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}
