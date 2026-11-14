import { lazy, Suspense, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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

/** 只在请求真正结算后离开 loading；空正文是「暂无说明」，不是还在加载 */
type ReadmeState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'empty' }
  | { status: 'error'; error: string };

export function PluginReadmeDialog({
  plugin,
  onClose,
}: {
  plugin: { id: string; name: string; from: 'installed' | 'market' } | null;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadmeState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const id = plugin?.id;
  const from = plugin?.from;
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt 只是重试的触发信号，effect 内不参与计算
  useEffect(() => {
    if (!id || !from) return;
    // 关闭、切插件或重试后，旧请求的回包一律丢弃
    let active = true;
    setState({ status: 'loading' });
    void window.electronAPI.extensionPlugins
      .readme({ id, from })
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setState({ status: 'error', error: result.error });
          return;
        }
        const text = typeof result.text === 'string' ? result.text : '';
        setState(text.trim() ? { status: 'ready', text } : { status: 'empty' });
      })
      .catch((reason) => {
        if (active) setState({ status: 'error', error: String(reason) });
      });
    return () => {
      active = false;
    };
  }, [id, from, attempt]);
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
            {state.status === 'error' ? (
              <div role="alert" className="flex flex-col items-start gap-2 text-destructive">
                <p>{state.error}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAttempt((count) => count + 1)}
                >
                  {t('Retry')}
                </Button>
              </div>
            ) : state.status === 'empty' ? (
              <p className="text-muted-foreground">{t('No documentation yet')}</p>
            ) : state.status === 'ready' ? (
              <Suspense fallback={t('Loading...')}>
                <Markdown text={state.text} />
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
