import { generatedImageFromOutput } from '@shared/imageGeneration';
import { toLocalImageUrl } from '@shared/localImage';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { handleDraftRequest } from '@/plugins/draftBridge';
import { requestFocusComposer } from './composerMentionBridge';
import { copyImageToClipboard } from './imageClipboard';
import { downloadImage } from './imageDownload';
import { ZoomableImage } from './ZoomableImage';

/** Exact upstream image-gen action glyphs (Apache-2.0), not the app's generic icons. */
function ImageActionIcon({ kind }: { kind: 'edit' | 'copy' | 'download' | 'check' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-image-copied={kind === 'check' ? '' : undefined}
    >
      {kind === 'edit' && (
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </>
      )}
      {kind === 'copy' && (
        <>
          <rect x="9" y="9" width="12" height="12" rx="2.5" />
          <path d="M6 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V6" />
        </>
      )}
      {kind === 'download' && (
        <>
          <path d="M12 3v12" />
          <path d="M7 11l5 5 5-5" />
          <path d="M5 21h14" />
        </>
      )}
      {kind === 'check' && <path d="M4 12.5l5 5L20 6.5" />}
    </svg>
  );
}

/** Open Vetta's translucent overlay control, independent of the app's button theme. */
function ImageAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="imagegen-action"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

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
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);
  const image = generatedImageFromOutput(output);
  if (!image) return null;
  const src = toLocalImageUrl(path);
  const action = async (kind: 'copy' | 'download') => {
    if (pending) return;
    setPending(true);
    try {
      if (kind === 'copy') {
        await copyImageToClipboard(src);
        if (!alive.current) return;
        setCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1600);
      } else await downloadImage(src, image.path.slice(image.path.lastIndexOf('/') + 1));
    } catch (error) {
      if (alive.current)
        addToast({
          type: 'error',
          title: t(kind === 'copy' ? 'Could not copy image' : 'Could not download image'),
          description: error instanceof Error ? error.message : String(error),
        });
    } finally {
      if (alive.current) setPending(false);
    }
  };
  const edit = () => {
    if (!sessionId) return;
    const read = handleDraftRequest({ sessionId, op: 'readDraft', payload: {} });
    if (!read.ok) {
      addToast({ type: 'error', title: t('Edit image'), description: read.error });
      return;
    }
    const value = read.value;
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
      className="imagegen-preview relative mt-2 overflow-hidden"
      data-slot="generated-image"
      aria-busy={!loaded && !failed}
    >
      {failed ? (
        <p className="px-3 py-5 text-sm text-muted-foreground">{t('Image file unavailable')}</p>
      ) : (
        <ZoomableImage
          src={src}
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          frameClassName="block max-w-full"
          className={cn(
            'block max-h-[calc(256rem/14)] max-w-full object-contain',
            loaded ? 'imagegen-fade-in' : 'opacity-0'
          )}
        />
      )}
      {loaded && !failed && (
        <div
          className="imagegen-actions"
          data-slot="image-actions"
          role="group"
          aria-label={t('Image actions')}
        >
          <ImageAction label={t('Edit image')} disabled={!sessionId || pending} onClick={edit}>
            <ImageActionIcon kind="edit" />
          </ImageAction>
          <ImageAction
            label={t(copied ? 'Image copied' : 'Copy image')}
            disabled={pending}
            onClick={() => void action('copy')}
          >
            <ImageActionIcon kind={copied ? 'check' : 'copy'} />
          </ImageAction>
          <ImageAction
            label={t('Download image')}
            disabled={pending}
            onClick={() => void action('download')}
          >
            <ImageActionIcon kind="download" />
          </ImageAction>
        </div>
      )}
      <figcaption className="sr-only">{image.path}</figcaption>
    </figure>
  );
}
