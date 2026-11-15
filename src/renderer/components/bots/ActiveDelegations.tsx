import type { BotProfile, Delegation } from '@shared/types/bot';
import { useI18n } from '@/i18n';
import { DelegationCard } from './DelegationCard';

/** 私聊右侧「委派」页签：该成员发起、仍在进行的委派 */
export function ActiveDelegations({
  items,
  bots,
  onOpenConversation,
}: {
  items: Delegation[];
  bots: Map<string, BotProfile>;
  onOpenConversation: (conversationId: string, title: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div data-slot="active-delegations" className="min-h-0 flex-1 overflow-y-auto">
      <div className="px-3 py-3">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-8 text-center">
            <p className="font-medium text-sm">{t('No delegations in progress')}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              {t('Delegations this member starts stay here until they finish')}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-2 text-muted-foreground text-[calc(11rem/14)]">
              {t('Delegations in progress · {{n}}', { n: items.length })}
            </div>
            <div className="flex flex-col gap-1.5">
              {items.map((record) => (
                <DelegationCard
                  key={record.id}
                  record={record}
                  bots={bots}
                  onOpenConversation={onOpenConversation}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
