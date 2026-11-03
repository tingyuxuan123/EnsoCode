import { useEffect, useState } from 'react';
import { type LoadedDesignPreview, loadDesignPreviewFile } from '../host/preview-files';
import { useTranslation } from '../host/translation';
import { VetdPreview } from '../vetta/src/preview/VetdPreview';
import { DesignRoot } from './DesignRoot';

/** Bound to the dock's owner, never whichever conversation happens to be selected later. */
export function DesignFilePreview({
  conversationId,
  rel,
  revision,
}: {
  conversationId: string;
  rel: string;
  revision: number;
}) {
  const { t } = useTranslation();
  const identity = `${conversationId}:${rel}:${revision}`;
  const [result, setResult] = useState<{ identity: string; loaded: LoadedDesignPreview } | null>(
    null
  );
  const loaded = result?.identity === identity ? result.loaded : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let current: LoadedDesignPreview | null = null;
    setResult(null);
    setFailed(false);
    void loadDesignPreviewFile(conversationId, rel)
      .then((value) => {
        if (disposed) {
          value.dispose();
          return;
        }
        current = value;
        setResult({ identity, loaded: value });
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      current?.dispose();
    };
  }, [conversationId, rel, identity]);
  return (
    <DesignRoot>
      {loaded ? (
        <VetdPreview key={identity} file={loaded.file} actions={loaded.actions} />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          {failed ? t('preview.invalid') : '…'}
        </div>
      )}
    </DesignRoot>
  );
}
