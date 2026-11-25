import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { PluginIcon } from './PluginIcon';
import { PluginView } from './PluginView';
import type { PluginViewRef } from './viewBridge';

export function PluginWorkspacePage({
  view,
  sessionId,
  onBack,
}: {
  view: PluginViewRef;
  sessionId: string | null;
  onBack(): void;
}) {
  const { t } = useI18n();
  return (
    <section
      data-slot="plugin-workspace"
      data-plugin-id={view.pluginId}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label={t('Back')}
          title={t('Back')}
          className="size-7"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <PluginIcon pluginId={view.pluginId} icon={view.icon} className="size-4 object-contain" />
        <span className="truncate text-sm font-medium">{view.title}</span>
      </header>
      <div className="min-h-0 flex-1">
        <PluginView
          key={`${view.pluginId}:${view.id}:${sessionId ?? ''}:${view.build ?? ''}`}
          pluginId={view.pluginId}
          viewId={view.id}
          sessionId={sessionId}
        />
      </div>
    </section>
  );
}
