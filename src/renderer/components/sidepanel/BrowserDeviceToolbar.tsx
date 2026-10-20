import {
  BROWSER_DEVICE_CATEGORIES,
  BROWSER_DEVICE_PROFILES,
  parseBrowserDevice,
} from '@shared/browser/devices';
import type { BrowserDevice, BrowserResult, BrowserTabState } from '@shared/types/browser';
import { Check, ChevronDown, RectangleHorizontal, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from '@/components/ui/menu';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

export type BrowserStageBackground = 'default' | 'white' | 'dark' | 'checker';

export const BROWSER_STAGE_BACKGROUNDS: readonly {
  value: BrowserStageBackground;
  label: string;
  className: string;
}[] = [
  { value: 'default', label: 'Default', className: 'bg-muted/70' },
  { value: 'white', label: 'White', className: 'bg-white' },
  { value: 'dark', label: 'Dark', className: 'bg-neutral-900' },
  { value: 'checker', label: 'Checkerboard', className: 'browser-stage-checker' },
];

export const DEFAULT_BROWSER_DEVICE: BrowserDevice = {
  enabled: true,
  profileId: 'responsive',
  width: 393,
  height: 852,
  deviceScaleFactor: 3,
  mobile: true,
  touch: true,
  orientation: 'portrait',
};

const SCALES = [25, 50, 75, 100];
const TRIGGER =
  'inline-flex h-7 shrink-0 items-center whitespace-nowrap gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-popup-open:bg-muted data-popup-open:text-foreground';

function Chip({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-stretch overflow-hidden rounded-md border border-border/70 bg-muted/40 text-[11px] leading-5 tabular-nums">
      <span className="px-1.5 text-muted-foreground">{label}</span>
      <span className="border-l border-border/70 px-1.5 text-foreground/80">{value}</span>
    </span>
  );
}

export function BrowserDeviceToolbar({
  device,
  scale,
  liveSize,
  disabled,
  devtoolsOpen = false,
  background,
  onBackgroundChange,
  onApply,
}: {
  device: BrowserDevice;
  /** 当前设备框实际缩放；未测量出舞台时为 null */
  scale: number | null;
  /** 拖拽调整尺寸时的实时逻辑尺寸 */
  liveSize?: { width: number; height: number } | null;
  disabled: boolean;
  /** DevTools 前端占着 guest 的 CDP，改尺寸必然失败；仍允许关闭预览 */
  devtoolsOpen?: boolean;
  background: BrowserStageBackground;
  onBackgroundChange: (background: BrowserStageBackground) => void;
  onApply: (device: BrowserDevice) => Promise<BrowserResult<BrowserTabState>>;
}) {
  const { t } = useI18n();
  const width = device.width ?? DEFAULT_BROWSER_DEVICE.width ?? 393;
  const height = device.height ?? DEFAULT_BROWSER_DEVICE.height ?? 852;
  const [draftWidth, setDraftWidth] = useState(String(width));
  const [draftHeight, setDraftHeight] = useState(String(height));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraftWidth(String(liveSize?.width ?? width));
    setDraftHeight(String(liveSize?.height ?? height));
  }, [width, height, liveSize?.width, liveSize?.height]);

  const locked = busy || disabled || devtoolsOpen;
  const profileId = device.profileId ?? 'responsive';
  const profileName = (name: string) =>
    name.startsWith('Desktop ') ? t('Desktop {{size}}', { size: name.slice(8) }) : t(name);
  const current = BROWSER_DEVICE_PROFILES.find((profile) => profile.id === profileId);
  const stageBackground =
    BROWSER_STAGE_BACKGROUNDS.find((entry) => entry.value === background) ??
    BROWSER_STAGE_BACKGROUNDS[0];

  const apply = async (next: BrowserDevice): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      let normalized: BrowserDevice;
      try {
        normalized = parseBrowserDevice(next);
      } catch {
        setError(
          t(
            'Use dimensions from 50 to 8192, DPR from 0.5 to 4, and at most 20 million viewport pixels.'
          )
        );
        return false;
      }
      const result = await onApply(normalized);
      if (!result.ok) setError(result.error);
      return result.ok;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not update device preview.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const commitSize = () => {
    const nextWidth = Number(draftWidth);
    const nextHeight = Number(draftHeight);
    if (nextWidth === width && nextHeight === height) return;
    void apply({
      ...device,
      enabled: true,
      profileId: 'responsive',
      width: nextWidth,
      height: nextHeight,
      orientation: nextWidth > nextHeight ? 'landscape' : 'portrait',
    }).then((ok) => {
      if (ok) return;
      setDraftWidth(String(width));
      setDraftHeight(String(height));
    });
  };

  const sizeInput = (value: string, set: (value: string) => void, label: string) => (
    <Input
      type="number"
      inputMode="numeric"
      min={50}
      max={8192}
      size="sm"
      value={value}
      disabled={locked}
      aria-label={label}
      className="w-16 shrink-0 text-xs [&_input]:px-1 [&_input]:text-center [&_input]:tabular-nums"
      onChange={(event) => set(event.target.value)}
      onBlur={commitSize}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        setDraftWidth(String(width));
        setDraftHeight(String(height));
      }}
    />
  );

  return (
    <div className="@container shrink-0 border-b border-border/70">
      <div className="flex h-10 min-w-0 items-center gap-1 overflow-x-auto px-2 text-xs [scrollbar-width:none]">
        <span className="hidden shrink-0 whitespace-nowrap pl-1 pr-0.5 font-medium text-foreground @min-[26rem]:inline">
          {t('Size:')}
        </span>
        <Menu>
          <MenuTrigger
            className={cn(TRIGGER, 'max-w-44 justify-between')}
            disabled={locked}
            aria-label={t('Device preset')}
          >
            <span className="truncate">
              {current ? profileName(current.name) : t('Responsive')}
            </span>
            <ChevronDown className="size-3.5 shrink-0" />
          </MenuTrigger>
          <MenuPopup align="start" className="w-auto min-w-72 max-w-[min(32rem,90vw)]">
            <MenuItem
              onClick={() => void apply({ ...device, enabled: true, profileId: 'responsive' })}
            >
              <span className="flex-1">{t('Responsive')}</span>
              <Check className={cn('text-primary', profileId !== 'responsive' && 'invisible')} />
            </MenuItem>
            {BROWSER_DEVICE_CATEGORIES.map((category) => (
              <MenuGroup key={category.id}>
                <MenuGroupLabel className="pt-2.5">{t(category.name)}</MenuGroupLabel>
                {BROWSER_DEVICE_PROFILES.filter((profile) => profile.category === category.id).map(
                  (profile) => (
                    <MenuItem
                      key={profile.id}
                      onClick={() =>
                        void apply({
                          enabled: true,
                          profileId: profile.id,
                          width: profile.width,
                          height: profile.height,
                          deviceScaleFactor: profile.deviceScaleFactor,
                          mobile: profile.mobile,
                          touch: profile.touch,
                          orientation: profile.width > profile.height ? 'landscape' : 'portrait',
                          ...(device.scale === undefined ? {} : { scale: device.scale }),
                        })
                      }
                    >
                      <span className="shrink-0">{profileName(profile.name)}</span>
                      <Chip label={t('Size')} value={`${profile.width} × ${profile.height}`} />
                      <Chip label="DPR" value={profile.deviceScaleFactor} />
                      <span className="flex-1" />
                      <Check
                        className={cn('text-primary', profileId !== profile.id && 'invisible')}
                      />
                    </MenuItem>
                  )
                )}
              </MenuGroup>
            ))}
          </MenuPopup>
        </Menu>
        <form
          className="flex shrink-0 items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            commitSize();
          }}
        >
          {sizeInput(draftWidth, setDraftWidth, t('Viewport width'))}
          <span className="text-muted-foreground">×</span>
          {sizeInput(draftHeight, setDraftHeight, t('Viewport height'))}
          <button type="submit" hidden />
        </form>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          disabled={locked}
          aria-label={t('Rotate')}
          title={t('Rotate')}
          onClick={() =>
            void apply({
              ...device,
              enabled: true,
              width: height,
              height: width,
              orientation: height > width ? 'landscape' : 'portrait',
            })
          }
        >
          <RectangleHorizontal className="size-3.5" />
        </Button>
        <Menu>
          <MenuTrigger className={TRIGGER} aria-label={t('Background')}>
            <span className="hidden @min-[30rem]:inline">{t('Background')}</span>
            <span
              className={cn(
                'size-4 shrink-0 rounded-[4px] border border-border',
                stageBackground.className
              )}
            />
            <ChevronDown className="size-3.5 shrink-0" />
          </MenuTrigger>
          <MenuPopup align="start" className="min-w-36">
            {BROWSER_STAGE_BACKGROUNDS.map((entry) => (
              <MenuItem key={entry.value} onClick={() => onBackgroundChange(entry.value)}>
                <span
                  className={cn(
                    'size-4 shrink-0 rounded-[4px] border border-border',
                    entry.className
                  )}
                />
                <span className="flex-1">{t(entry.label)}</span>
                <Check className={cn('text-primary', entry.value !== background && 'invisible')} />
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
        <Menu>
          <MenuTrigger
            className={cn(TRIGGER, 'tabular-nums')}
            disabled={locked}
            aria-label={t('Preview scale')}
          >
            {scale === null ? t('Fit to panel') : `${Math.round(scale * 100)}%`}
            <ChevronDown className="size-3.5 shrink-0" />
          </MenuTrigger>
          <MenuPopup align="start" className="min-w-36">
            <MenuItem onClick={() => void apply({ ...device, enabled: true, scale: undefined })}>
              <span className="flex-1">{t('Fit to panel')}</span>
              <Check className={cn('text-primary', device.scale !== undefined && 'invisible')} />
            </MenuItem>
            {SCALES.map((value) => (
              <MenuItem
                key={value}
                onClick={() => void apply({ ...device, enabled: true, scale: value / 100 })}
              >
                <span className="flex-1 tabular-nums">{value}%</span>
                <Check
                  className={cn(
                    'text-primary',
                    (device.scale === undefined || Math.round(device.scale * 100) !== value) &&
                      'invisible'
                  )}
                />
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
        <span className="min-w-2 flex-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          disabled={busy || disabled}
          aria-label={t('Close device preview')}
          title={t('Close device preview')}
          onClick={() => void apply({ enabled: false })}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {(disabled || devtoolsOpen || error) && (
        <p
          role={error ? 'alert' : undefined}
          className={cn(
            'break-words px-3 pb-1.5 text-xs',
            error ? 'text-destructive' : 'text-warning'
          )}
        >
          {error ??
            t(
              disabled
                ? 'Take control before changing the device preview.'
                : 'Close DevTools to change the device preview.'
            )}
        </p>
      )}
    </div>
  );
}
