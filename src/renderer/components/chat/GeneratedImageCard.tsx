import { generatedImageFromOutput } from '@shared/imageGeneration';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { addToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { handleDraftRequest } from '@/plugins/draftBridge';
import { requestFocusComposer } from './composerMentionBridge';
import { copyImageToClipboard } from './imageClipboard';
import { downloadImage } from './imageDownload';
import { localImageErrorText, useLocalImageSource } from './localImageSource';
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
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
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
  // 手机 PWA 没有 local-image://：经 host 按「会话 id + 相对路径」取图，加载/失败都有可见状态
  const { state, remote, retry, invalidate } = useLocalImageSource(path);
  if (!image) return null;
  const src = state.status === 'local' || state.status === 'ready' ? state.src : null;
  // 解码失败绑定到具体像素：换新图（重试成功）自动解除，同一张坏图持续失败
  const failed = src !== null && failedSrc === src;
  const loaded = src !== null && loadedSrc === src;
  const action = async (kind: 'copy' | 'download') => {
    // 远程宿主（手机）的图片只在内存里，没有本地路径可复制/下载
    if (pending || !src) return;
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
      {state.status === 'loading' ? (
        <p data-slot="generated-image-loading" className="px-3 py-5 text-muted-foreground text-sm">
          {t('Loading image…')}
        </p>
      ) : state.status === 'error' || (failed && remote) ? (
        <div data-slot="generated-image-error" className="px-3 py-5 text-sm">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            <span>{localImageErrorText(state.status === 'error' ? state.error : 'failed', t)}</span>
            <button
              type="button"
              onClick={retry}
              className="rounded border px-1.5 py-0.5 font-medium transition-colors hover:bg-accent"
            >
              {t('Retry')}
            </button>
          </p>
        </div>
      ) : failed ? (
        <p className="px-3 py-5 text-sm text-muted-foreground">{t('Image file unavailable')}</p>
      ) : src ? (
        <ZoomableImage
          src={src}
          onError={() => {
            setFailedSrc(src);
            invalidate();
          }}
          onLoad={(event) => {
            // 远程宿主是浏览器解码的 data URL：complete 但 0 宽就是解不出，按失败处理
            if (remote && event.currentTarget.naturalWidth === 0) {
              setFailedSrc(src);
              invalidate();
              return;
            }
            setLoadedSrc(src);
          }}
          frameClassName="block max-w-full"
          className={cn(
            'block max-h-[calc(256rem/14)] max-w-full object-contain',
            loaded ? 'imagegen-fade-in' : 'opacity-0'
          )}
        />
      ) : null}
      {/* 远程宿主（手机）没有文件监视：同名图被覆盖后由用户主动刷新取新版本 */}
      {remote && state.status === 'ready' && !failed && (
        <div className="px-3 pb-2">
          <button
            type="button"
            data-slot="generated-image-refresh"
            onClick={retry}
            className="rounded-md border px-2 py-1 text-[calc(11rem/14)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t('Refresh image')}
          </button>
        </div>
      )}
      {loaded && !failed && !remote && (
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
