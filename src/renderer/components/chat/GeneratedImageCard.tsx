import { generatedImageFromOutput } from '@shared/imageGeneration';
import { toLocalImageUrl } from '@shared/localImage';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { handleDraftRequest } from '@/plugins/draftBridge';
import { requestFocusComposer } from './composerMentionBridge';
import { ZoomableImage } from './ZoomableImage';

/** The reference is restored from the durable tool result, not a transient image cache. */
export function GeneratedImageCard({
  output,
  path,
  sessionId,
}: {
  output: string;
  path: string;
  sessionId?: string;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const image = generatedImageFromOutput(output);
  if (!image) return null;
  const edit = () => {
    if (!sessionId) return;
    const read = handleDraftRequest({ sessionId, op: 'readDraft', payload: {} });
    const value = read.ok ? read.value : null;
    if (
      !value ||
      typeof value !== 'object' ||
      !('generation' in value) ||
      typeof value.generation !== 'string' ||
      !('rev' in value) ||
      typeof value.rev !== 'string'
    )
      return;
    const result = handleDraftRequest({
      sessionId,
      op: 'insertText',
      payload: {
        expect: { generation: value.generation, rev: value.rev },
        text: `${t('Edit image')} (edit_image, sourceImageId: ${image.id}): `,
      },
    });
    if (!result.ok) addToast({ type: 'error', title: t('Edit image'), description: result.error });
    else requestFocusComposer();
  };
  return (
    <figure
      className="mt-2 max-w-lg overflow-hidden rounded-xl border border-border/60 bg-card"
      data-slot="generated-image"
    >
      {failed ? (
        <p className="px-3 py-5 text-sm text-muted-foreground">{t('Image file unavailable')}</p>
      ) : (
        <ZoomableImage
          src={toLocalImageUrl(path)}
          onError={() => setFailed(true)}
          frameClassName="block w-full"
          className="mx-auto block max-h-96 max-w-full object-contain"
        />
      )}
      <figcaption className="flex items-center gap-2 px-3 py-2">
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
          title={path}
        >
          {image.path}
        </span>
        {sessionId && (
          <Button size="sm" variant="outline" onClick={edit}>
            {t('Edit image')}
          </Button>
        )}
      </figcaption>
    </figure>
  );
}
