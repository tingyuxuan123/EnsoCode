import { useEffect, useState } from 'react';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { addToast } from '@/components/ui/toast';
import { useOverlayGuard } from '@/hooks/useOverlayGuard';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Z_INDEX } from '@/lib/z-index';
import { copyImageToClipboard } from './imageClipboard';

interface ZoomableImageProps {
  src: string;
  className?: string;
  /** 点击区域；需要把图片限制在父级宽度内时传 `block w-full` */
  frameClassName?: string;
  onError?: () => void;
}

/** 消息里的图片：点击全屏预览，点遮罩或 Esc 关闭 */
export function ZoomableImage({ src, className, frameClassName, onError }: ZoomableImageProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useOverlayGuard(open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const copy = async () => {
    try {
      await copyImageToClipboard(src);
      addToast({ type: 'success', title: t('Image copied') });
    } catch (error: unknown) {
      addToast({
        type: 'error',
        title: t('Could not copy image'),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={cn('cursor-zoom-in', frameClassName)}
            >
              <img src={src} alt="" className={className} onError={onError} />
            </button>
          }
          onContextMenu={(event) => event.stopPropagation()}
        />
        <ContextMenuPopup className="min-w-36">
          <ContextMenuItem closeOnClick onClick={() => void copy()}>
            {t('Copy image')}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
      {open && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={cn(
            'fixed inset-0 flex cursor-zoom-out items-center justify-center bg-black/75'
          )}
          style={{ zIndex: Z_INDEX.NESTED_MODAL_BACKDROP }}
          data-enso-float=""
        >
          <img src={src} alt="" className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain" />
        </button>
      )}
    </>
  );
}
