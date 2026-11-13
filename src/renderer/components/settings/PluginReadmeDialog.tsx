import { lazy, Suspense, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/i18n';

const Markdown = lazy(async () => ({
  default: (await import('@/components/chat/Markdown')).Markdown,
}));
export function PluginReadmeDialog({
  plugin,
  onClose,
}: {
  plugin: { id: string; name: string; from: 'installed' | 'market' } | null;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const id = plugin?.id;
  const from = plugin?.from;
  useEffect(() => {
    if (!id || !from) return;
    let active = true;
    setBody('');
    setError('');
    void window.electronAPI.extensionPlugins
      .readme({ id, from })
      .then((result) => {
        if (!active) return;
        if (result.ok) setBody(result.text);
        else setError(result.error);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [id, from]);
  return (
    <Dialog
      open={!!plugin}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {plugin?.name} · {t('Documentation')}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="text-sm">
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : body ? (
              <Suspense fallback={t('Loading...')}>
                <Markdown text={body} />
              </Suspense>
            ) : (
              t('Loading...')
            )}
          </div>
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}
