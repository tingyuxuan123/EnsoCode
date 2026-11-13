import { useEffect } from 'react';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { describePluginNotice } from './pluginNotice';
export function PluginNotices() {
  const { t } = useI18n();
  useEffect(
    () =>
      window.electronAPI.extensionPlugins?.onNotice?.((notice) => {
        const view = describePluginNotice(notice);
        if (view)
          addToast({
            type: view.type,
            title: t(view.titleKey, view.params),
            actions: [
              {
                label: t(view.actionKey),
                onClick: () => {
                  void window.electronAPI.window.openSettings({
                    category: 'plugins',
                    rowId: 'plugins.enso',
                    pluginId: view.pluginId,
                  });
                },
              },
            ],
          });
      }),
    [t]
  );
  return null;
}
