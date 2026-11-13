import type { PluginArtifactInfo } from '@shared/extensionPlugins/protocol';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { artifactPreviewKind } from './artifacts';
import { decodeUtf8Base64 } from './viewBridge';

function ArtifactRow({
  artifact,
  onDelete,
}: {
  artifact: PluginArtifactInfo;
  onDelete?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<{ kind: 'text' | 'image'; body: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.extensionPlugins.artifactRead(artifact.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const kind = artifactPreviewKind(result.info.mime);
      if (kind !== 'file')
        setPreview({
          kind,
          body:
            kind === 'image'
              ? `data:${result.info.mime};base64,${result.base64}`
              : decodeUtf8Base64(result.base64),
        });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate">
          {artifact.name}{' '}
          <span className="text-muted-foreground">
            {artifact.mime} · {artifact.size} B
          </span>
        </span>
        {artifactPreviewKind(artifact.mime) !== 'file' && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void open()}>
            {t('Preview')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || ('remote' in window.electronAPI && !!window.electronAPI.remote)}
          onClick={() => {
            setBusy(true);
            void window.electronAPI.extensionPlugins
              .artifactSave(artifact.id)
              .then((result) => {
                if (!result.ok) setError(result.error ?? 'Save failed');
              })
              .catch((reason) => setError(String(reason)))
              .finally(() => setBusy(false));
          }}
        >
          {t('Save as')}
        </Button>
        {onDelete && (
          <Button size="sm" variant="ghost" onClick={() => onDelete(artifact.id)}>
            {t('Delete')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {preview?.kind === 'text' && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{preview.body}</pre>
      )}
      {preview?.kind === 'image' && (
        <img
          src={preview.body}
          alt={artifact.name}
          className="max-h-48 max-w-full object-contain"
        />
      )}
    </div>
  );
}
export function PluginArtifactList({
  artifacts,
  onDelete,
}: {
  artifacts: PluginArtifactInfo[];
  onDelete?: (id: string) => void;
}) {
  const { t } = useI18n();
  return artifacts.length ? (
    <div className="space-y-2">
      {artifacts.map((artifact) => (
        <ArtifactRow key={artifact.id} artifact={artifact} onDelete={onDelete} />
      ))}
    </div>
  ) : (
    <p className="text-muted-foreground text-xs">{t('No artifact files yet')}</p>
  );
}
export function PluginArtifactsCard({ artifacts }: { artifacts: PluginArtifactInfo[] }) {
  const { t } = useI18n();
  return (
    <div className="mt-1 mb-1.5 ml-[30px] rounded-lg border p-3">
      <p className="mb-1 text-muted-foreground text-xs">{t('Artifact files')}</p>
      <PluginArtifactList artifacts={artifacts} />
    </div>
  );
}
export function PluginManagedArtifacts({ pluginId }: { pluginId: string }) {
  const [artifacts, setArtifacts] = useState<PluginArtifactInfo[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void window.electronAPI.extensionPlugins.artifactsList(pluginId).then((result) => {
      if (active) {
        if (result.ok) setArtifacts(result.artifacts);
        else setError(result.error);
      }
    });
    return () => {
      active = false;
    };
  }, [pluginId]);
  return (
    <>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      <PluginArtifactList
        artifacts={artifacts}
        onDelete={(id) => {
          void window.electronAPI.extensionPlugins.artifactDelete(id).then((result) => {
            if (result.ok) setArtifacts((items) => items.filter((item) => item.id !== id));
            else setError(result.error ?? 'Delete failed');
          });
        }}
      />
    </>
  );
}
