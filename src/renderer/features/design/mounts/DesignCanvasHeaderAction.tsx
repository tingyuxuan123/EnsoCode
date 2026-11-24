import { PanelsTopLeft } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import { viewedDesignSessionId } from '../host/activity-route';
import { getDesignListing, subscribeDesignListing } from '../vetta/src/vetd/design-listing';

const CLASS_NAME =
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

export function DesignCanvasHeaderAction() {
  const { t } = useI18n();
  const enabled = useSettingsStore((state) => state.designEnabled);
  const sessionId = useSessionsStore((state) =>
    viewedDesignSessionId(state.conversations, state.activeId)
  );
  const listing = useSyncExternalStore(subscribeDesignListing, getDesignListing);
  if (!enabled || !listing || listing.sessionId !== sessionId) return null;

  const { cwd } = listing;
  const prefix = `${cwd.replace(/\/$/, '')}/`;
  const designs = listing.paths.flatMap((path) =>
    path.startsWith(prefix) ? [path.slice(prefix.length)] : []
  );
  if (designs.length === 0) return null;

  const open = (rel: string) => {
    void import('../host/preview-files')
      .then(({ openDesignDirectory }) => openDesignDirectory(listing.sessionId, rel, cwd))
      .catch(() => addToast({ type: 'error', title: t('Could not open the design canvas') }));
  };
  const content = (
    <>
      <PanelsTopLeft className="size-4" aria-hidden />
      <span>{t('Open canvas')}</span>
    </>
  );
  const only = designs.length === 1 ? designs[0] : undefined;
  if (only) {
    return (
      <button type="button" className={CLASS_NAME} title={only} onClick={() => open(only)}>
        {content}
      </button>
    );
  }
  return (
    <Menu key={`${listing.sessionId}:${cwd}`}>
      <MenuTrigger className={CLASS_NAME}>{content}</MenuTrigger>
      <MenuPopup align="end" className="max-w-80">
        {designs.map((rel) => (
          <MenuItem key={rel} title={rel} onClick={() => open(rel)}>
            <span className="truncate">{rel.replace(/\.vetd$/i, '')}</span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
