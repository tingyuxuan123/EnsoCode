import type { BotProfile } from '@shared/types/bot';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { useBotsStore } from '@/stores/bots';

export function QueuedInterjections({
  chatId,
  bots,
}: {
  chatId: string;
  bots: Map<string, BotProfile>;
}) {
  const { t } = useI18n();
  const queue = useBotsStore((s) => s.queue);
  const [pending, setPending] = useState<string | null>(null);
  return queue
    .filter((item) => item.chatId === chatId && item.deliveryId)
    .map((item) => {
      const name = bots.get(item.botId)?.name ?? t('Deleted member');
      return (
        <div
          key={item.deliveryId}
          className="flex items-center gap-2 text-muted-foreground text-[calc(11rem/14)]"
        >
          <span>
            {name} · {t('Queued')}
          </span>
          {item.canInterject && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending !== null}
              onClick={async () => {
                if (!item.deliveryId) return;
                setPending(item.deliveryId);
                try {
                  const result = await window.electronAPI.bots.interjectQueued(
                    chatId,
                    item.deliveryId
                  );
                  if (!result.ok) addToast({ type: 'error', title: result.error });
                } catch {
                  addToast({ type: 'error', title: t('Failed to send') });
                } finally {
                  setPending(null);
                }
              }}
            >
              {t('Insert into {{name}}’s current task', { name })}
            </Button>
          )}
        </div>
      );
    });
}
