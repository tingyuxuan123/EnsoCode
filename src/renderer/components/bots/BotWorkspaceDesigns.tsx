import type { BotChat } from '@shared/types/bot';
import type { DesignRootInfo } from '@shared/types/design';
import { ArrowLeft, LayoutTemplate, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type BotDesignTarget, revealBotDesign } from '@/features/design/host/bot-canvas';
import { resolveDesignRoot } from '@/features/design/host/paths';
import { useTranslation } from '@/features/design/host/translation';
import { BotDesignPanel } from '@/features/design/mounts/DesignPanel';
import { loadCover } from '@/features/design/vetta/src/canvas/raster-cache';
import { getPluginCtx } from '@/features/design/vetta/src/plugin-context';
import { pickDesignPaths } from '@/features/design/vetta/src/vetd/discover';
import { useSettingsStore } from '@/stores/settings';

interface DesignItem {
  path: string;
  rel: string;
  name: string;
  cover: string | null;
}
type Listing = { root: DesignRootInfo; items: DesignItem[] };

/** Chat/workspace changes discard both pending scans and a preview from the old workspace. */
export function BotWorkspaceDesigns({
  chat,
  target,
}: {
  chat: BotChat;
  target?: BotDesignTarget | null;
}) {
  const projectId = chat.workspace.kind === 'project' ? chat.workspace.projectId : null;
  const projectPath = useSettingsStore((s) => s.projects.find((p) => p.id === projectId)?.path);
  const key = JSON.stringify([chat.id, chat.workspace, projectPath]);
  const [scope, setScope] = useState<{ key: string; stale?: BotDesignTarget | null }>({ key });
  if (scope.key !== key) setScope({ key, stale: target });
  const current = scope.key === key && scope.stale !== target ? target : null;
  return <WorkspaceDesignList key={key} chatId={chat.id} target={current} />;
}

function WorkspaceDesignList({
  chatId,
  target,
}: {
  chatId: string;
  target?: BotDesignTarget | null;
}) {
  const { t } = useTranslation();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [opening, setOpening] = useState(false);
  const [hiddenTarget, setHiddenTarget] = useState<BotDesignTarget | null>(null);
  const generation = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly requests a fresh authoritative scan.
  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    setFailed(false);
    setListing(null);
    void (async () => {
      const result = await window.electronAPI.bots.designWorkspace({ chatId });
      if (!result.ok) throw new Error(result.error);
      const root = await resolveDesignRoot(result.root.ref);
      const found = pickDesignPaths(await getPluginCtx().fs.listFilesRecursive(root.path));
      const prefix = `${root.path.replace(/\/$/, '')}/`;
      const items = await Promise.all(
        found.bundles.map(async (path) => {
          const rel = path.slice(prefix.length);
          return {
            path,
            rel,
            name:
              rel
                .split('/')
                .at(-1)
                ?.replace(/\.vetd$/, '') ?? rel,
            cover: await loadCover(path).catch(() => null),
          };
        })
      );
      if (generation.current === request) setListing({ root, items });
    })()
      .catch(() => {
        if (generation.current === request) setFailed(true);
      })
      .finally(() => {
        if (generation.current === request) setLoading(false);
      });
    return () => {
      ++generation.current;
    };
  }, [chatId, revision]);

  const open = async (item: DesignItem) => {
    if (!listing || opening) return;
    const request = generation.current;
    setOpening(true);
    setFailed(false);
    try {
      // The list is only a snapshot. Re-check the chat's authoritative workspace before opening.
      const result = await window.electronAPI.bots.designWorkspace({ chatId });
      if (
        !result.ok ||
        JSON.stringify(result.root.ref) !== JSON.stringify(listing.root.ref) ||
        result.root.path !== listing.root.path
      )
        throw new Error('Workspace changed');
      const root = await resolveDesignRoot(result.root.ref);
      if (root.ref.kind !== 'project' || root.path !== listing.root.path)
        throw new Error('Workspace changed');
      if (generation.current !== request) return;
      revealBotDesign({ chatId, cwd: root.path, path: item.path, projectId: root.ref.projectId });
    } catch {
      if (generation.current === request) setFailed(true);
    } finally {
      if (generation.current === request) setOpening(false);
    }
  };
  const selected = target && target !== hiddenTarget ? target : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        {selected ? (
          <button
            type="button"
            onClick={() => setHiddenTarget(selected)}
            className="flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('workspace.back')}
          </button>
        ) : (
          <span className="text-muted-foreground text-xs">{t('workspace.title')}</span>
        )}
        <button
          type="button"
          aria-label={t('workspace.refresh')}
          title={t('workspace.refresh')}
          disabled={loading || opening}
          onClick={() => setRevision((n) => n + 1)}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      {selected ? (
        <div className="min-h-0 flex-1">
          <BotDesignPanel target={selected} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3" aria-busy={loading || opening}>
          {loading ? (
            <p role="status" className="py-8 text-center text-muted-foreground text-xs">
              {t('workspace.loading')}
            </p>
          ) : failed ? (
            <p
              role="alert"
              className="rounded-md border border-dashed px-3 py-8 text-center text-muted-foreground text-xs"
            >
              {t('workspace.failed')}
            </p>
          ) : listing?.items.length ? (
            <div className="grid gap-2">
              {listing.items.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  title={item.rel}
                  disabled={opening}
                  onClick={() => void open(item)}
                  className="flex min-w-0 items-center gap-3 rounded-md border p-2 text-left hover:bg-muted disabled:opacity-50"
                >
                  {item.cover ? (
                    <img
                      src={item.cover}
                      alt=""
                      className="h-14 w-20 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded bg-muted">
                      <LayoutTemplate className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-sm">{item.name}</span>
                    <span className="block break-all text-muted-foreground text-xs">
                      {item.rel}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed px-3 py-8 text-center text-muted-foreground text-xs">
              <LayoutTemplate className="mx-auto mb-3 h-6 w-6" />
              {t('workspace.empty')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
