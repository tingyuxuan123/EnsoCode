import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';
import { SwitchRow } from './GeneralSettings';

/** 实验功能开关集中在这里；功能自己的设置放各自的分页 */
export function ExperimentalSettings({ onOpenBots }: { onOpenBots: () => void }) {
  const { t } = useI18n();
  const botModeEnabled = useSettingsStore((s) => s.botModeEnabled);
  const setBotModeEnabled = useSettingsStore((s) => s.setBotModeEnabled);
  return (
    <div className="space-y-[24px]" data-slot="settings-page">
      <div>
        <h3 className="text-[calc(18rem/14)] font-semibold leading-[calc(26rem/14)]">
          {t('Experimental')}
        </h3>
        <p className="text-[calc(13rem/14)] text-muted-foreground">
          {t('Features still being tested. They may change or be removed.')}
        </p>
      </div>
      <div className="space-y-2">
        <SwitchRow
          rowId="experimental.botMode"
          title={t('Bot mode')}
          description={t(
            'Adds a Code | Bot switch to the sidebar. Create members with their own persona, model and tools, and chat with them alone or in groups.'
          )}
          checked={botModeEnabled}
          onChange={setBotModeEnabled}
        />
        {botModeEnabled && (
          <Button variant="outline" size="sm" onClick={onOpenBots}>
            {t('Bot mode settings')}
          </Button>
        )}
      </div>
    </div>
  );
}
