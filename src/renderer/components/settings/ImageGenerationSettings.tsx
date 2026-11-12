import type { ImageGenerationSettings as ModelSelections } from '@shared/imageGeneration';
import {
  IMAGE_PROVIDER_ID,
  IMAGE_SIZE_MODES,
  type ImageProviderResult,
  type ImageProviderSettings,
  type ImageProviderView,
  imageOutputParams,
  normalizeImageModelIds,
  normalizeImageProviderBaseUrl,
  parseImageExtraParams,
} from '@shared/imageProvider';
import {
  Activity,
  Check,
  Download,
  ImagePlus,
  Layers,
  Link,
  Plus,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useImageProviderSettings } from './useImageProviderSettings';

const SIZE_LABELS = {
  request: 'Follow conversation',
  '1k': '1K',
  '2k': '2K',
  '4k': '4K',
  custom: 'Fixed dimensions',
  omit: 'Do not send',
};
const QUALITY = ['', 'auto', 'low', 'medium', 'high', 'standard', 'hd'];

function Section({
  title,
  description,
  icon,
  action,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-line bg-background/40 p-4">
      <header className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-sm">{title}</h4>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function ModelImport({
  models,
  existing,
  onAdd,
  onClose,
}: {
  models: string[];
  existing: string[];
  onAdd(ids: string[]): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const visible = models.filter((id) => id.toLowerCase().includes(query.toLowerCase()));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Import image models')}</DialogTitle>
          <DialogDescription>
            {t(
              'Select models supported by your image endpoint. A model list may also contain chat models.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <Input
            aria-label={t('Search models')}
            placeholder={t('Search models')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {visible.map((id) => (
              <label
                key={id}
                className="flex min-h-9 items-center gap-3 rounded-md px-2 hover:bg-muted"
              >
                <Checkbox
                  checked={existing.includes(id) || selected.includes(id)}
                  disabled={
                    existing.includes(id) ||
                    (selected.length + existing.length >= 32 && !selected.includes(id))
                  }
                  onCheckedChange={(checked) =>
                    setSelected((old) =>
                      checked ? [...old, id] : old.filter((item) => item !== id)
                    )
                  }
                />
                <span className="min-w-0 break-all font-mono text-xs">{id}</span>
                {existing.includes(id) && <Badge variant="secondary">{t('Added')}</Badge>}
              </label>
            ))}
            {!visible.length && (
              <p className="py-5 text-center text-xs text-muted-foreground">
                {t('No matching models')}
              </p>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button disabled={!selected.length} onClick={() => void onAdd(selected)}>
            {t('Add selected models')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ImageProviderFormProps {
  view: ImageProviderView;
  busy: boolean;
  error: string;
  selections: ModelSelections;
  onSelect(mode: 'textToImage' | 'imageToImage', model: string): void;
  update(patch: Partial<ImageProviderSettings>): Promise<boolean>;
  saveConnection(baseUrl: string, key?: string): Promise<boolean>;
  clearKey(): Promise<boolean>;
  listModels(): Promise<ImageProviderResult<{ models: string[] }>>;
}

export function ImageProviderForm({
  view,
  busy,
  error,
  selections,
  onSelect,
  update,
  saveConnection,
  clearKey,
  listModels,
}: ImageProviderFormProps) {
  const { t } = useI18n();
  const config = view.config;
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [key, setKey] = useState('');
  const [manual, setManual] = useState('');
  const [extra, setExtra] = useState(config.extraParams);
  const [custom, setCustom] = useState(config.customSize);
  const [models, setModels] = useState<string[] | null>(null);
  const [probe, setProbe] = useState<string | null>(null);
  useEffect(() => {
    setBaseUrl(config.baseUrl);
    setKey('');
    setProbe(null);
  }, [config.baseUrl]);
  useEffect(() => setExtra(config.extraParams), [config.extraParams]);
  useEffect(() => setCustom(config.customSize), [config.customSize]);
  const extraValid = parseImageExtraParams(extra) !== null;
  const baseValid = normalizeImageProviderBaseUrl(baseUrl) !== null;
  const previewConfig = { ...config, ...(extraValid ? { extraParams: extra } : {}) };
  const preview = imageOutputParams(previewConfig, '1536x1024');
  const discover = async (importing: boolean) => {
    const result = await listModels();
    if (result.ok) {
      setProbe(t('Connection successful'));
      if (importing) setModels(result.value.models);
    } else setProbe(result.error);
  };
  const add = async (ids: string[]) => {
    if (await update({ models: normalizeImageModelIds([...config.models, ...ids]) })) {
      setManual('');
      setModels(null);
    }
  };
  return (
    <div className="space-y-4" data-settings-row="tools.imageGeneration">
      <div className="flex items-start gap-3 py-1">
        <ImagePlus className="mt-0.5 size-6 shrink-0 text-primary" />
        <div>
          <p className="font-semibold text-base">{t('OpenAI-compatible image generation')}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t(
              'Configure an image endpoint independently from chat providers. Credentials stay encrypted on this device.'
            )}
          </p>
        </div>
      </div>
      {!view.configured && (selections.textToImage || selections.imageToImage) && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t(
            'Your previous image provider selection still works until you save an independent image connection.'
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-70">
        <Section
          title={t('Connection')}
          description={t(
            'API address and authentication. Changing the address clears the saved key.'
          )}
          icon={<Link className="size-4" />}
        >
          <div className="space-y-2">
            <label className="text-xs font-medium" htmlFor="image-base-url">
              {t('API address')}
            </label>
            <Input
              id="image-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!baseValid}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t(
                'Include the version segment, such as /v1. Requests use /images/generations and /images/edits.'
              )}
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label htmlFor="image-api-key" className="text-xs font-medium">
                API Key
              </label>
              {view.hasApiKey && <Badge variant="success">{t('Saved')}</Badge>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Input
                id="image-api-key"
                className="min-w-32 flex-1"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                placeholder={t(
                  view.hasApiKey
                    ? 'Enter a new key to replace the saved key'
                    : 'Enter image API key'
                )}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <Button
                disabled={!baseValid || (!view.secureStorageAvailable && !!key)}
                onClick={async () => {
                  if (await saveConnection(baseUrl, key.trim() || undefined)) {
                    setKey('');
                    setProbe(null);
                  }
                }}
              >
                {t('Save')}
              </Button>
              <Button
                variant="outline"
                disabled={!view.hasApiKey}
                onClick={async () => {
                  if (await clearKey()) {
                    setKey('');
                    setProbe(null);
                  }
                }}
              >
                {t('Clear')}
              </Button>
            </div>
            <p
              className={cn(
                'text-xs leading-relaxed',
                view.secureStorageAvailable ? 'text-muted-foreground' : 'text-destructive'
              )}
            >
              {t(
                view.secureStorageAvailable
                  ? 'The saved key is encrypted locally and is never sent back to this form.'
                  : 'System keychain unavailable. API keys cannot be saved without encryption.'
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2">
            <p className="text-xs" role="status">
              {probe ?? t('Not tested')}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={!view.hasApiKey || baseUrl !== config.baseUrl}
              onClick={() => void discover(false)}
            >
              <Activity className="size-3.5" />
              {t('Test connection')}
            </Button>
          </div>
        </Section>
        <Section
          title={t('Models')}
          description={t(
            'The first model is the default. Add model IDs manually or fetch them from the endpoint.'
          )}
          icon={<Layers className="size-4" />}
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={!view.hasApiKey || baseUrl !== config.baseUrl}
              onClick={() => void discover(true)}
            >
              <Download className="size-3.5" />
              {t('Fetch models')}
            </Button>
          }
        >
          <div className="space-y-2">
            {config.models.map((id, index) => (
              <div
                key={id}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={id}>
                  {id}
                </span>
                {index === 0 ? (
                  <Badge variant="secondary">{t('Default')}</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${t('Set as default')}: ${id}`}
                    onClick={() =>
                      void update({ models: [id, ...config.models.filter((item) => item !== id)] })
                    }
                  >
                    <Check className="size-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('Remove')}: ${id}`}
                  onClick={() =>
                    void update({ models: config.models.filter((item) => item !== id) })
                  }
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
            {!config.models.length && (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-xs text-muted-foreground">
                {t('No image models. Add a model ID below.')}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              aria-label={t('Image model IDs')}
              placeholder={t('Model IDs, separated by commas')}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (manual.trim()) void add(normalizeImageModelIds(manual));
                }
              }}
            />
            <Button
              variant="outline"
              disabled={!normalizeImageModelIds(manual).length || config.models.length >= 32}
              onClick={() => void add(normalizeImageModelIds(manual))}
            >
              <Plus className="size-3.5" />
              {t('Add')}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <div>
              <p className="text-xs font-medium">{t('Supports image editing')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  'Use /images/edits for existing images. Turn this off if the endpoint does not support editing.'
                )}
              </p>
            </div>
            <Switch
              aria-label={t('Supports image editing')}
              checked={config.imageToImage}
              onCheckedChange={(imageToImage) => void update({ imageToImage })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['textToImage', 'imageToImage'] as const).map((mode) => {
              const selection = selections[mode];
              const selected = selection?.providerId === IMAGE_PROVIDER_ID ? selection.modelId : '';
              const labels = Object.fromEntries([
                ['', t('Use first model')],
                ...config.models.map((id) => [id, id]),
                ...(selected && !config.models.includes(selected)
                  ? [[selected, `${selected} (${t('Unavailable')})`]]
                  : []),
              ]);
              return (
                <div className="space-y-1.5" key={mode}>
                  <p className="text-xs font-medium">
                    {t(mode === 'textToImage' ? 'Text to image' : 'Image to image')}
                  </p>
                  <Select
                    items={labels}
                    value={selected}
                    disabled={mode === 'imageToImage' && !config.imageToImage}
                    onValueChange={(value) => {
                      if (typeof value === 'string') onSelect(mode, value);
                    }}
                  >
                    <SelectTrigger
                      aria-label={t(
                        mode === 'textToImage' ? 'Text to image model' : 'Image to image model'
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="">{t('Use first model')}</SelectItem>
                      {config.models.map((id) => (
                        <SelectItem key={id} value={id}>
                          {id}
                        </SelectItem>
                      ))}
                      {selected && !config.models.includes(selected) && (
                        <SelectItem value={selected} disabled>
                          {labels[selected]}
                        </SelectItem>
                      )}
                    </SelectPopup>
                  </Select>
                </div>
              );
            })}
          </div>
        </Section>
        <Section
          title={t('Output parameters')}
          description={t('These options apply to both image generation and editing.')}
          icon={<SlidersHorizontal className="size-4" />}
        >
          <div className="space-y-2">
            <p className="text-xs font-medium">{t('Image dimensions')}</p>
            <div
              role="radiogroup"
              aria-label={t('Image dimensions')}
              className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
            >
              {IMAGE_SIZE_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={config.sizeMode === mode}
                  className={cn(
                    'min-h-8 flex-1 whitespace-nowrap rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    config.sizeMode === mode
                      ? 'bg-background font-medium shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => void update({ sizeMode: mode })}
                >
                  {t(SIZE_LABELS[mode])}
                </button>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t(
                '1K / 2K / 4K keep the requested aspect ratio and scale the long edge to 1024 / 2048 / 3840, aligned to 16 pixels.'
              )}
            </p>
            {config.sizeMode === 'custom' && (
              <div className="flex gap-2">
                <Input
                  aria-label={t('Fixed dimensions')}
                  placeholder="2048x2048"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
                <Button variant="outline" onClick={() => void update({ customSize: custom })}>
                  {t('Save')}
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium">{t('Image quality')}</p>
            <Select
              items={Object.fromEntries(
                [...new Set([...QUALITY, config.quality])].map((quality) => [
                  quality,
                  quality || t('Do not send'),
                ])
              )}
              value={config.quality}
              onValueChange={(quality) => {
                if (typeof quality === 'string') void update({ quality });
              }}
            >
              <SelectTrigger aria-label={t('Image quality')}>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {[...new Set([...QUALITY, config.quality])].map((quality) => (
                  <SelectItem key={quality} value={quality}>
                    {quality || t('Do not send')}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t(
                'Sent as quality: gpt-image supports low / medium / high; dall-e-3 supports standard / hd.'
              )}
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="image-extra-params" className="text-xs font-medium">
              {t('Extra parameters (JSON)')}
            </label>
            <Textarea
              id="image-extra-params"
              className="font-mono text-xs"
              value={extra}
              maxLength={16384}
              aria-invalid={!extraValid}
              placeholder={'{"output_format":"png","background":"auto"}'}
              onChange={(e) => setExtra(e.target.value)}
            />
            <div className="flex items-center justify-between gap-3">
              <p
                className={cn(
                  'text-xs leading-relaxed',
                  extraValid ? 'text-muted-foreground' : 'text-destructive'
                )}
              >
                {t(
                  extraValid
                    ? 'Merged into the request body. Can override size and quality, but not model, prompt, n, image or mask.'
                    : 'Enter a JSON object with valid output parameters.'
                )}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={!extraValid || extra.trim() === config.extraParams}
                onClick={() => void update({ extraParams: extra })}
              >
                {t('Save')}
              </Button>
            </div>
          </div>
          <div className="space-y-2 rounded-lg bg-muted/60 p-3" data-slot="image-output-preview">
            <p className="text-xs text-muted-foreground">
              {t('Preview: actual parameters for an Agent request of 1536x1024')}
            </p>
            <pre className="whitespace-pre-wrap break-all font-mono text-xs">
              {JSON.stringify(preview)}
            </pre>
            {extra.trim() !== config.extraParams && (
              <p className="text-xs text-muted-foreground">{t('Unsaved preview')}</p>
            )}
          </div>
        </Section>
      </fieldset>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(
          'Image calls may be billed. Prompts and reference images go to the selected endpoint; requests are never retried automatically. Local Code sessions only.'
        )}
      </p>
      {models && (
        <ModelImport
          models={models}
          existing={config.models}
          onAdd={add}
          onClose={() => setModels(null)}
        />
      )}
    </div>
  );
}

export function ImageGenerationSettings() {
  const { t } = useI18n();
  const state = useImageProviderSettings();
  const selections = useSettingsStore((s) => s.imageGeneration);
  const setSelections = useSettingsStore((s) => s.setImageGeneration);
  if (!state.view)
    return (
      <p role={state.error ? 'alert' : 'status'} className="text-xs text-muted-foreground">
        {state.error || t('Loading…')}
      </p>
    );
  return (
    <ImageProviderForm
      {...state}
      view={state.view}
      selections={selections}
      onSelect={(mode, modelId) =>
        setSelections({
          ...selections,
          [mode]: modelId ? { providerId: IMAGE_PROVIDER_ID, modelId } : null,
        })
      }
    />
  );
}
