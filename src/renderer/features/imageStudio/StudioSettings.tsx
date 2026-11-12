import {
  IMAGE_STUDIO_COUNTS,
  IMAGE_STUDIO_RATIOS,
  type ImageStudioOptions,
} from '@shared/imageStudio';
import { SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Z_INDEX } from '@/lib/z-index';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-6">
      <span className="w-16 shrink-0 pt-2 text-[calc(13rem/14)] text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Choices<T extends string>({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: { value: T; label: string; glyph?: ReactNode }[];
  value: T;
  onChange(value: T): void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {values.map((item) => (
        <button
          key={item.value}
          type="button"
          role="radio"
          aria-checked={value === item.value}
          className={cn(
            'flex min-h-9 items-center gap-2 rounded-md border px-3 text-[calc(13rem/14)] outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === item.value
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card hover:bg-accent'
          )}
          onClick={() => onChange(item.value)}
        >
          {item.glyph}
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function StudioSettings({
  open,
  onClose,
  options,
  models,
  onSave,
}: {
  open: boolean;
  onClose(): void;
  options: ImageStudioOptions;
  models: string[];
  onSave(options: ImageStudioOptions): void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(options);
  useEffect(() => {
    if (open) setDraft(options);
  }, [open, options]);
  const update = <K extends keyof ImageStudioOptions>(key: K, value: ImageStudioOptions[K]) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const auto = t('Auto');
  const counts = IMAGE_STUDIO_COUNTS.map((value) => ({
    value,
    label: value === 1 ? t('1 image') : t('{{n}} images', { n: value }),
  }));
  const formats = [
    { value: 'auto', label: auto },
    { value: 'png', label: 'PNG' },
    { value: 'jpeg', label: 'JPEG' },
    { value: 'webp', label: 'WebP' },
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="max-w-[720px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <SlidersHorizontal className="size-4" />
            </span>
            {t('Drawing settings')}
          </DialogTitle>
          <DialogDescription>
            {t('Options apply to this studio only; your image service defaults stay unchanged.')}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Row label={t('Quantity')}>
            <Select
              items={counts}
              value={draft.count}
              onValueChange={(value) => {
                if (typeof value === 'number') update('count', value);
              }}
            >
              <SelectTrigger aria-label={t('Quantity')}>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                {counts.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t(
                'Images are generated one by one. Each may be billed; a failure stops the batch without retrying.'
              )}
            </p>
          </Row>
          <Row label={t('Aspect ratio')}>
            <Choices
              label={t('Aspect ratio')}
              value={draft.ratio}
              onChange={(value) => update('ratio', value)}
              values={IMAGE_STUDIO_RATIOS.map((value) => {
                const [w, h] = value === 'auto' ? [1, 1] : value.split(':').map(Number);
                return {
                  value,
                  label: value === 'auto' ? auto : value,
                  glyph: (
                    <span
                      className="inline-block border border-current opacity-70"
                      style={{
                        width: `${(16 * w) / Math.max(w, h) / 14}rem`,
                        height: `${(16 * h) / Math.max(w, h) / 14}rem`,
                      }}
                    />
                  ),
                };
              })}
            />
          </Row>
          <Row label={t('Model')}>
            <Select
              items={models.map((value) => ({ value, label: value }))}
              value={draft.model}
              onValueChange={(value) => {
                if (value) update('model', value);
              }}
              disabled={!models.length}
            >
              <SelectTrigger aria-label={t('Image model ID')}>
                <SelectValue placeholder={t('Configure image service')} />
              </SelectTrigger>
              <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                {models.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Row>
          <Row label={t('Output format')}>
            <Select
              items={formats}
              value={draft.format}
              onValueChange={(value) => {
                const format = formats.find((item) => item.value === value);
                if (format) update('format', format.value as ImageStudioOptions['format']);
              }}
            >
              <SelectTrigger aria-label={t('Output format')}>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                {formats.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Row>
          <Row label={t('Resolution')}>
            <Choices
              label={t('Resolution')}
              value={draft.resolution}
              onChange={(value) => update('resolution', value)}
              values={[
                { value: 'auto', label: auto },
                { value: '1k', label: '1K' },
                { value: '2k', label: '2K' },
                { value: '4k', label: '4K' },
              ]}
            />
          </Row>
          <Row label={t('Image quality')}>
            <Choices
              label={t('Image quality')}
              value={draft.quality}
              onChange={(value) => update('quality', value)}
              values={[
                { value: 'auto', label: auto },
                { value: 'low', label: t('Low') },
                { value: 'medium', label: t('Medium') },
                { value: 'high', label: t('High') },
              ]}
            />
          </Row>
        </DialogPanel>
        <DialogFooter className="sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {t('{{n}} images · Each image may be billed', { n: draft.count })}
          </span>
          <Button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            {t('Done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
