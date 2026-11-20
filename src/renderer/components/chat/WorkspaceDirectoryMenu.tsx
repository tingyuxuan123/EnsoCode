import type { OpenInApp } from '@shared/types';
import { ChevronUp, Code2, Copy, Folder, FolderOpen, SquareTerminal } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import { openDirectoryFromMenu, openDirectoryLabel } from '@/components/chat/openDirectoryAction';
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { useI18n } from '@/i18n';

/** 输入框左下角的工作区目录菜单：承接访达/编辑器/终端打开与路径复制，向上展开。 */
export function WorkspaceDirectoryMenu({
  project,
  conversationId,
  path,
  label,
  openDisabled,
}: {
  project: { id: string; name: string; kind?: string };
  conversationId: string;
  path: string;
  label: string;
  openDisabled?: boolean;
}) {
  const { t } = useI18n();
  const [apps, setApps] = useState<OpenInApp[]>([]);
  const local = project.kind !== 'ssh';
  const scratch = project.kind === 'scratch';
  const platform = typeof window !== 'undefined' ? (window.electronAPI?.env?.platform ?? '') : '';

  const refreshApps = useCallback(() => {
    if (!local || typeof window === 'undefined') return;
    const loader = window.electronAPI?.projects?.openInApps;
    if (!loader) return;
    loader()
      .then(setApps)
      .catch(() => undefined);
  }, [local]);

  const open = (appId?: string) =>
    void openDirectoryFromMenu(
      { projectId: project.id, conversationId, ...(appId ? { appId } : {}) },
      t
    );

  const editors = apps.filter((app) => app.kind === 'editor');
  const terminals = apps.filter((app) => app.kind === 'terminal');

  return (
    <Menu onOpenChange={(next) => next && refreshApps()}>
      <MenuTrigger
        data-slot="workspace-directory-trigger"
        className="group flex h-[calc(24rem/14)] shrink-0 items-center gap-[calc(6rem/14)] rounded-full px-[calc(8rem/14)] text-[calc(12rem/14)] text-muted-foreground tabular-nums outline-none transition-colors duration-(--duration-quick) ease-(--ease-out) hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent data-popup-open:text-foreground"
        title={path || (scratch ? label : '')}
        aria-label={label}
        onPointerEnter={refreshApps}
      >
        <Folder className="size-[calc(13rem/14)] shrink-0 opacity-75" />
        <span className="max-w-[calc(160rem/14)] truncate">{label}</span>
        <ChevronUp className="size-[calc(11rem/14)] shrink-0 opacity-45 transition-[opacity,transform] duration-(--duration-quick) ease-(--ease-out) group-hover:opacity-80 group-data-popup-open:rotate-180 group-data-popup-open:opacity-90" />
      </MenuTrigger>
      <MenuPopup side="top" align="start" sideOffset={6} className="min-w-48">
        {local && (
          <>
            <MenuItem disabled={openDisabled} onClick={() => open()}>
              <FolderOpen />
              {t(openDirectoryLabel(platform))}
            </MenuItem>
            <AppGroup
              label={t('Editors')}
              apps={editors}
              fallback={<Code2 />}
              disabled={openDisabled}
              onOpen={open}
            />
            <AppGroup
              label={t('Terminals')}
              apps={terminals}
              fallback={<SquareTerminal />}
              disabled={openDisabled}
              onOpen={open}
            />
            <MenuSeparator />
          </>
        )}
        <MenuItem disabled={!path} onClick={() => void navigator.clipboard?.writeText(path)}>
          <Copy />
          {t('Copy Path')}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function AppGroup({
  label,
  apps,
  fallback,
  disabled,
  onOpen,
}: {
  label: string;
  apps: OpenInApp[];
  fallback: ReactNode;
  disabled?: boolean;
  onOpen: (appId: string) => void;
}) {
  if (apps.length === 0) return null;
  return (
    <>
      <MenuSeparator />
      <MenuGroup>
        <MenuGroupLabel>{label}</MenuGroupLabel>
        {apps.map((app) => (
          <MenuItem key={app.id} disabled={disabled} onClick={() => onOpen(app.id)}>
            {app.icon ? (
              <img src={app.icon} alt="" className="-mx-0.5 size-4 shrink-0" />
            ) : (
              fallback
            )}
            {app.name}
          </MenuItem>
        ))}
      </MenuGroup>
    </>
  );
}
