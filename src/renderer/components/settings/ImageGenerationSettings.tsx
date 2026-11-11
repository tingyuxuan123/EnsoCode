import { parseImageGenerationSettings } from '@shared/imageGeneration';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';

function ImageModelRow({ mode }: { mode: 'textToImage' | 'imageToImage' }) {
  const { t } = useI18n();
  const providers = useSettingsStore((s) => s.providers);
  const config = useSettingsStore((s) => s.imageGeneration);
  const setConfig = useSettingsStore((s) => s.setImageGeneration);
  const selected = config[mode];
  const [providerId, setProviderId] = useState(selected?.providerId ?? '');
  const [modelId, setModelId] = useState(selected?.modelId ?? '');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setProviderId(selected?.providerId ?? '');
    setModelId(selected?.modelId ?? '');
    setSaved(false);
  }, [selected?.providerId, selected?.modelId]);
  const candidates = providers.filter(
    (p) => p.enabled && !p.oauthAccountKey && !p.oauthAccountPool && p.apiKey
  );
  const available = candidates.some((p) => p.id === providerId);
  const label = t(mode === 'textToImage' ? 'Text to image' : 'Image to image');
  return (
    <div className="space-y-2" data-settings-row={`tools.imageGeneration.${mode}`}>
      <p className="text-[calc(12rem/14)] font-medium">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={Object.fromEntries([
            ['', t('Select image service')],
            ...candidates.map((p) => [p.id, p.name]),
            ...(providerId && !available ? [[providerId, t('Image service unavailable')]] : []),
          ])}
          value={providerId}
          onValueChange={(value) => {
            if (typeof value === 'string') {
              setProviderId(value);
              setSaved(false);
            }
          }}
        >
          <SelectTrigger className="w-56" aria-label={`${label} — ${t('Image service')}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="">{t('Select image service')}</SelectItem>
            {candidates.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
            {providerId && !available && (
              <SelectItem value={providerId} disabled>
                {t('Image service unavailable')}
              </SelectItem>
            )}
          </SelectPopup>
        </Select>
        <Input
          className="w-48"
          aria-label={`${label} — ${t('Image model ID')}`}
          placeholder="gpt-image-1"
          value={modelId}
          maxLength={256}
          onChange={(e) => {
            setModelId(e.target.value);
            setSaved(false);
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!available || !modelId.trim()}
          onClick={() => {
            setConfig(parseImageGenerationSettings({ ...config, [mode]: { providerId, modelId } }));
            setSaved(true);
          }}
        >
          {t(saved ? 'Saved' : 'Save')}
        </Button>
        {selected && (
          <Button size="sm" variant="ghost" onClick={() => setConfig({ ...config, [mode]: null })}>
            {t('Clear')}
          </Button>
        )}
      </div>
      {providerId && !available && (
        <p className="text-destructive text-xs" role="status">
          {t('Image service unavailable')}
        </p>
      )}
    </div>
  );
}

export function ImageGenerationSettings() {
  const { t } = useI18n();
  return (
    <div className="space-y-4" data-settings-row="tools.imageGeneration">
      <p className="text-muted-foreground text-[calc(12rem/14)]">
        {t(
          'Choose an API-key provider with OpenAI-compatible /images/generations and /images/edits endpoints. Include the version in its Base URL (for example /v1). Image model IDs can be entered even if absent from the chat model list. OAuth chat subscriptions are not image API keys.'
        )}
      </p>
      <ImageModelRow mode="textToImage" />
      <ImageModelRow mode="imageToImage" />
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          void window.electronAPI.window.openSettings({
            category: 'providers',
            rowId: 'providers.root',
          })
        }
      >
        {t('Manage image services')}
      </Button>
      <p className="text-muted-foreground text-[calc(12rem/14)]">
        {t(
          'Ask in chat to generate or edit an image. Prompts and reference images are sent to the selected service and each call may incur a charge. No automatic retries. Results are saved in .xiaoman/images inside the workspace; previous versions remain in chat. Local Code sessions only; not SSH, bots or subagents. Tool changes apply after the current turn.'
        )}
      </p>
    </div>
  );
}
