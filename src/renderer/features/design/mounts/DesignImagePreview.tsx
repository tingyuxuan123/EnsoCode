import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/i18n';
import { updateDesignUi, useDesignRegistry } from '../host/registry';
import type { PluginImageRef } from '../vetta/sdk/images';
import { toVettaFileUrl } from '../vetta/src/cards/file-url';
import { getPluginCtx } from '../vetta/src/plugin-context';
import { DesignRoot } from './DesignRoot';

export function DesignImagePreview() {
  const { t } = useI18n();
  const preview = useDesignRegistry((state) => state.ui.imagePreview) as
    | { ref: PluginImageRef; group?: PluginImageRef[] }
    | undefined;
  // The virtualized card may unmount while its modal remains open. The modal
  // owns fresh URLs so card cleanup cannot revoke the currently viewed image.
  const [images, setImages] = useState<PluginImageRef[]>([]);
  const paths = preview ? (preview.group ?? [preview.ref]).map((ref) => ref.id).join('\0') : '';
  useEffect(() => {
    let disposed = false;
    const owned: { dispose(): void }[] = [];
    setImages([]);
    void Promise.all(
      paths
        ? paths.split('\0').map(async (path) => {
            try {
              const image = await toVettaFileUrl(path, getPluginCtx().fs);
              if (disposed) {
                image.dispose();
                return null;
              }
              owned.push(image);
              return { id: path, url: image.url };
            } catch (error) {
              console.warn('[design] preview read failed', error);
              return null;
            }
          })
        : []
    ).then((refs) => {
      if (!disposed) setImages(refs.filter((ref) => ref !== null));
    });
    return () => {
      disposed = true;
      for (const image of owned) image.dispose();
    };
  }, [paths]);
  const selected = images.find((image) => image.id === preview?.ref.id);
  return (
    <Dialog
      open={Boolean(preview)}
      onOpenChange={(open) => {
        if (!open) updateDesignUi('imagePreview', undefined);
      }}
    >
      <DialogPopup className="max-w-[90vw]" bottomStickOnMobile={false}>
        <DesignRoot>
          <DialogHeader>
            <DialogTitle>{t('Design')}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            {selected && (
              <img
                src={selected.url}
                alt={t('Design')}
                className="mx-auto max-h-[70vh] max-w-full object-contain"
              />
            )}
            {preview && images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-auto">
                {images.map((ref) => (
                  <button
                    type="button"
                    key={ref.id}
                    onClick={() => updateDesignUi('imagePreview', { ...preview, ref })}
                  >
                    <img src={ref.url} alt="" className="h-16 w-auto" />
                  </button>
                ))}
              </div>
            )}
          </DialogPanel>
        </DesignRoot>
      </DialogPopup>
    </Dialog>
  );
}
