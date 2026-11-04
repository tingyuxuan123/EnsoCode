import type { BotArtifactTarget, BotDesignArtifact } from '@shared/types/botIpc';
import { ArrowUpRight, LayoutTemplate } from 'lucide-react';
import { useEffect, useState } from 'react';
import { addToast } from '@/components/ui/toast';
import { isViewedBotDesignChat, revealBotDesign } from '@/features/design/host/bot-canvas';
import { resolveDesignRoot } from '@/features/design/host/paths';
import { useTranslation } from '@/features/design/host/translation';
import { loadCover, onCoverSaved } from '@/features/design/vetta/src/canvas/raster-cache';

const designPath = (cwd: string, rel: string) => `${cwd.replace(/\/$/, '')}/${rel}`;
const designRoot = (sessionId: string, projectId?: string) =>
  resolveDesignRoot(projectId ? { kind: 'project', projectId } : { kind: 'session', sessionId });

function useCover({ sessionId, projectId, rel }: BotDesignArtifact): string | null {
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    void designRoot(sessionId, projectId)
      .then(async ({ path: cwd }) => {
        if (!active) return;
        const path = designPath(cwd, rel);
        let updated = false;
        stop = onCoverSaved(path, (dataUrl) => {
          updated = true;
          setCover(dataUrl);
        });
        const cached = await loadCover(path);
        if (active && !updated) setCover(cached);
      })
      .catch(() => {});
    return () => {
      active = false;
      stop?.();
    };
  }, [projectId, sessionId, rel]);
  return cover;
}

export function BotDesignCard({
  target,
  design,
}: {
  target: BotArtifactTarget;
  design: BotDesignArtifact;
}) {
  const { t } = useTranslation();
  const cover = useCover(design);
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (!isViewedBotDesignChat(target.chatId)) return;
    setOpening(true);
    try {
      // Re-derive the card from Main's authoritative turn before opening the engine.
      const current = await window.electronAPI.bots.artifacts.list(target);
      const item =
        current.ok &&
        current.designs?.find(
          (candidate) => candidate.rel === design.rel && candidate.sessionId === design.sessionId
        );
      if (!item) throw new Error('Design artifact no longer available');
      const { path: cwd } = await designRoot(item.sessionId, item.projectId);
      revealBotDesign({
        chatId: target.chatId,
        sessionId: design.sessionId,
        cwd,
        path: designPath(cwd, design.rel),
        projectId: item.projectId,
      });
    } catch {
      if (isViewedBotDesignChat(target.chatId))
        addToast({ type: 'error', title: t('bot.card.unavailable') });
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      type="button"
      data-bot-design-card=""
      disabled={opening}
      onClick={() => void open()}
      className="group w-64 max-w-full overflow-hidden rounded-lg border border-line bg-background text-left hover:bg-accent/40 focus-visible:outline-ring disabled:opacity-70"
      aria-label={`${t('bot.card.open')}: ${design.name}`}
    >
      <span className="flex aspect-[2/1] items-center justify-center bg-muted/55">
        {cover ? (
          <img alt="" src={cover} className="h-full w-full object-contain" />
        ) : (
          <LayoutTemplate aria-hidden="true" className="size-7 text-muted-foreground" />
        )}
      </span>
      <span className="flex items-center gap-2 px-3 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">{design.name}</span>
          <span className="block text-muted-foreground text-xs">{t('bot.card.open')}</span>
        </span>
        <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </span>
    </button>
  );
}
