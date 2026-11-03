import { useEffect } from 'react';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { closeDesignDemoPreview, useDesignDemoPreview } from '../host/demo-preview';
import { useTranslation } from '../host/translation';
import { DesignRoot } from './DesignRoot';

/** Render inside the detail Dialog's React tree so host nesting/focus restoration stay intact. */
export function DesignDemoViewer() {
  const preview = useDesignDemoPreview((state) => state.preview);
  const { t } = useTranslation();
  useEffect(() => closeDesignDemoPreview, []);
  return (
    <Dialog open={preview !== null} onOpenChange={(open) => !open && closeDesignDemoPreview()}>
      {preview && (
        <DialogPopup
          className="h-[85vh] max-w-[90vw]"
          bottomStickOnMobile={false}
          zIndexLevel="nested"
        >
          <DesignRoot>
            <DialogHeader>
              <DialogTitle>{preview.name}</DialogTitle>
              <DialogDescription>{t('gallery.detail.openDemo.hint')}</DialogDescription>
            </DialogHeader>
            <DialogPanel bare className="flex min-h-0 flex-1 p-0!">
              <iframe
                title={preview.name}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={preview.html}
                className="h-full min-h-0 w-full flex-1 border-0 bg-background"
              />
            </DialogPanel>
          </DesignRoot>
        </DialogPopup>
      )}
    </Dialog>
  );
}
