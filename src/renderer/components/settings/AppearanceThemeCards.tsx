import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import type { ThemeEntry, ThemePreviewPalette } from './appearanceThemes';

/** 模拟侧栏 / 内容区 / 输入框三层，用主题自己的调色板着色（与终端预览同一做法）。 */
function ThemeCardPreview({ preview }: { preview: ThemePreviewPalette }) {
  const line = (key: string, width: string, color = preview.border) => (
    <span
      key={key}
      className="block h-[3px] rounded-full"
      style={{ width, backgroundColor: color }}
    />
  );

  return (
    <div
      aria-hidden
      className="flex h-[calc(58rem/14)] w-full overflow-hidden rounded-[5px] border"
      style={{ backgroundColor: preview.surface, borderColor: preview.border }}
    >
      <div
        className="flex w-[26%] flex-col gap-[4px] border-r px-[5px] py-[6px]"
        style={{ backgroundColor: preview.canvas, borderColor: preview.border }}
      >
        {line('a', '72%', preview.accent)}
        {line('b', '86%')}
        {line('c', '60%')}
      </div>
      <div className="flex flex-1 flex-col gap-[4px] px-[6px] py-[6px]">
        {line('d', '78%')}
        {line('e', '56%')}
        <div
          className="mt-auto flex items-center gap-[4px] rounded-[3px] border px-[4px] py-[3px]"
          style={{ backgroundColor: preview.sunken, borderColor: preview.border }}
        >
          {line('f', '40%')}
          <span
            className="ml-auto size-[4px] shrink-0 rounded-full"
            style={{ backgroundColor: preview.accent }}
          />
        </div>
      </div>
    </div>
  );
}

export function AppearanceThemeCards({
  entries,
  selectedId,
  onSelect,
}: {
  entries: readonly ThemeEntry[];
  selectedId: string;
  onSelect: (entry: ThemeEntry) => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="grid grid-cols-3 gap-[12px] max-sm:grid-cols-2"
      role="group"
      aria-label={t('Themes')}
      data-slot="appearance-theme-cards"
    >
      {entries.map((entry) => {
        const selected = entry.id === selectedId;
        const unavailable = entry.kind === 'plugin-unavailable';
        const label =
          entry.kind === 'builtin'
            ? t(entry.nameKey)
            : entry.kind === 'plugin'
              ? entry.name
              : t('Plugin theme unavailable');
        const source = entry.kind === 'builtin' ? t('Built-in') : t('Plugin');

        return (
          <button
            key={entry.id}
            type="button"
            data-theme-card={entry.kind}
            data-theme-id={entry.id}
            aria-pressed={selected}
            disabled={unavailable}
            title={entry.kind === 'plugin' ? `${entry.name} · ${entry.pluginName}` : label}
            onClick={() => onSelect(entry)}
            className={cn(
              'flex flex-col gap-[8px] rounded-[8px] border-2 p-[8px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              selected
                ? 'border-selection-border bg-selection text-selection-foreground'
                : 'border-transparent bg-muted/50 hover:bg-muted',
              unavailable && 'cursor-default opacity-60'
            )}
          >
            {entry.preview ? (
              <ThemeCardPreview preview={entry.preview} />
            ) : (
              <div className="h-[calc(58rem/14)] rounded-[5px] border border-dashed" />
            )}
            <div className="flex items-center justify-between gap-[6px]">
              <span className="truncate text-[calc(12rem/14)] font-medium" title={label}>
                {label}
              </span>
              <span className="shrink-0 rounded-full border px-[6px] text-[calc(10rem/14)] text-muted-foreground">
                {source}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
