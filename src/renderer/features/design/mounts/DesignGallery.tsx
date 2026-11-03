import { useState } from 'react';
import { addToast } from '@/components/ui/toast';
import { useDesignRegistry } from '../host/registry';
import { useTranslation } from '../host/translation';
import type { PluginOfficialProjectEntry } from '../vetta/sdk/official';
import type { PluginWorkspaceViewContribution, PluginWorkspaceViewHeader } from '../vetta/sdk/ui';
import { getPluginCtx } from '../vetta/src/plugin-context';
import { GALLERY_VIEW_ID } from '../vetta/src/tab-ids';
import { DesignRoot } from './DesignRoot';

/** Subscribe outside App: upstream publishes fresh ReactNodes after each view render. */
export function DesignGalleryHeader({ side }: { side: 'left' | 'right' }) {
  const header = useDesignRegistry((state) => state.ui[`header:${GALLERY_VIEW_ID}`]) as
    | PluginWorkspaceViewHeader
    | null
    | undefined;
  const { t } = useTranslation();
  return (
    <DesignRoot>
      {header?.[side] ??
        (side === 'left' && !header?.hideTitle ? (
          <span className="text-sm font-medium">{header?.title ?? t('gallery.nav.label')}</span>
        ) : null)}
    </DesignRoot>
  );
}

/** Consume the registered upstream view, not a second gallery implementation or route store. */
export function DesignGallery() {
  const contribution = useDesignRegistry((state) =>
    state.contributions.find(
      (item) =>
        item.kind === 'workspace-view' &&
        (item.value as PluginWorkspaceViewContribution).id === GALLERY_VIEW_ID
    )
  );
  const { locale, t } = useTranslation();
  const [revision, setRevision] = useState(0);
  const [hidden, setHidden] = useState<PluginOfficialProjectEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const zh = locale.startsWith('zh');
  const View = (contribution?.value as PluginWorkspaceViewContribution | undefined)?.component;

  const loadHidden = async () => {
    setBusy('list');
    try {
      setHidden((await getPluginCtx().official.projects.list()).archivedProjects);
    } catch (error) {
      addToast({ title: t('gallery.load.failed'), description: String(error), type: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const restore = async (path: string) => {
    setBusy(path);
    try {
      await getPluginCtx().official.projects.unarchive(path);
      setHidden((entries) => entries.filter((entry) => entry.path !== path));
      setRevision((value) => value + 1);
    } catch (error) {
      addToast({ title: t('gallery.archive.failed'), description: String(error), type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DesignRoot>
      <section
        data-slot="design-gallery"
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      >
        <div className="flex min-h-0 flex-1">
          {View ? (
            <View key={revision} viewId={GALLERY_VIEW_ID} pluginId="vetta-ui-design" />
          ) : null}
        </div>
        <details
          className="shrink-0 border-t border-border px-5 py-2 text-xs text-muted-foreground"
          onToggle={(event) => {
            if (event.currentTarget.open) void loadHidden();
          }}
        >
          <summary className="cursor-pointer">{zh ? '已隐藏项目' : 'Hidden projects'}</summary>
          <div className="mt-2 max-h-32 overflow-y-auto">
            {hidden.map((entry) => (
              <div key={entry.path} className="flex items-center gap-3 py-1">
                <span className="min-w-0 flex-1 truncate" title={entry.path}>
                  {entry.name ?? entry.path.split('/').pop()}
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  className="shrink-0 rounded px-2 py-1 text-primary hover:bg-accent disabled:opacity-40"
                  onClick={() => void restore(entry.path)}
                >
                  {zh ? '恢复到画廊' : 'Restore to gallery'}
                </button>
              </div>
            ))}
            {hidden.length === 0 && (
              <p>{busy ? t('gallery.loading') : zh ? '没有已隐藏项目' : 'No hidden projects'}</p>
            )}
          </div>
        </details>
      </section>
    </DesignRoot>
  );
}
