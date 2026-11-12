import type { GeneratedImage } from '@shared/imageGeneration';
import { Check, Copy, Download, Loader2, Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { copyImageToClipboard } from '@/components/chat/imageClipboard';
import { ZoomableImage } from '@/components/chat/ZoomableImage';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';

/** Images are resolved by Main's session + image authority, never renderer disk paths. */
export function useStudioImage(
  sessionId: string,
  imageId: string,
  variant: 'thumb' | 'original' = 'original'
) {
  const [result, setResult] = useState<{ src?: string; error?: string }>({});
  useEffect(() => {
    let alive = true;
    setResult({});
    window.electronAPI.imageStudio
      .image(sessionId, imageId, variant)
      .then((value) => {
        if (alive) setResult(value.ok ? { src: value.value.dataUrl } : { error: value.error });
      })
      .catch(() => {
        if (alive) setResult({ error: 'Image file unavailable' });
      });
    return () => {
      alive = false;
    };
  }, [sessionId, imageId, variant]);
  return result;
}

export function StudioThumbnail({
  sessionId,
  imageId,
  alt,
}: {
  sessionId: string;
  imageId: string;
  alt: string;
}) {
  const { src, error } = useStudioImage(sessionId, imageId, 'thumb');
  return src ? (
    <img src={src} alt={alt} className="size-full object-cover" loading="lazy" />
  ) : (
    <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
      {error ? '—' : <Loader2 className="size-4 animate-spin" />}
    </span>
  );
}

export function StudioImage({
  sessionId,
  image,
  onEdit,
  editingDisabled,
}: {
  sessionId: string;
  image: GeneratedImage;
  onEdit(): void;
  editingDisabled?: boolean;
}) {
  const { t } = useI18n();
  const { src, error } = useStudioImage(sessionId, image.id);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const copy = async () => {
    if (!src || busy) return;
    setBusy(true);
    try {
      await copyImageToClipboard(src);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      addToast({
        type: 'error',
        title: t('Could not copy image'),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <figure
      className="imagegen-preview relative mt-2 overflow-hidden"
      data-slot="studio-image"
      aria-busy={!error && !loaded && !failed}
    >
      {error || failed ? (
        <p role="status" className="p-5 text-sm text-muted-foreground">
          {t('Image file unavailable')}
        </p>
      ) : src ? (
        <ZoomableImage
          src={src}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          frameClassName="block max-w-full"
          className="block max-h-[calc(256rem/14)] max-w-full object-contain"
        />
      ) : (
        <div className="flex h-44 w-64 items-center justify-center bg-muted">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      )}
      {src && loaded && !failed && (
        <div className="imagegen-actions" role="group" aria-label={t('Image actions')}>
          <button
            type="button"
            className="imagegen-action"
            aria-label={t('Edit image')}
            title={t('Edit image')}
            disabled={editingDisabled}
            onClick={onEdit}
          >
            <Pencil />
          </button>
          <button
            type="button"
            className="imagegen-action"
            aria-label={t(copied ? 'Image copied' : 'Copy image')}
            title={t('Copy image')}
            disabled={busy}
            onClick={() => void copy()}
          >
            {copied ? <Check /> : <Copy />}
          </button>
          <a
            className="imagegen-action"
            aria-label={t('Download image')}
            title={t('Download image')}
            href={src}
            download={image.path.split('/').at(-1)}
          >
            <Download />
          </a>
        </div>
      )}
      <figcaption className="sr-only">{image.path}</figcaption>
    </figure>
  );
}
