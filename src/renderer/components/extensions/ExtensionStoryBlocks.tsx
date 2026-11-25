import { ArrowRight, Bot, Check, FileCode2, FileText, GitCompareArrows, Minus } from 'lucide-react';
import { useI18n } from '@/i18n';

type StoryItem = { title: string; description: string };

/** Host-owned presentation blocks. Their content is text, never DOM, code or plugin actions. */
export type ExtensionStoryBlock =
  | {
      type: 'hero';
      eyebrow: string;
      title: string;
      description: string;
      highlights: readonly string[];
    }
  | {
      type: 'showcase';
      title: string;
      file: string;
      items: readonly StoryItem[];
      prompt: string;
      reply: string;
    }
  | {
      type: 'comparison';
      title: string;
      before: string;
      after: string;
      pairs: readonly { before: string; after: string }[];
    }
  | { type: 'steps'; title: string; items: readonly StoryItem[] };

function BlockTitle({ children }: { children: string }) {
  return (
    <h2 className="flex items-center gap-3 font-semibold text-base after:h-px after:flex-1 after:bg-line">
      {children}
    </h2>
  );
}

function StoryBlock({ block }: { block: ExtensionStoryBlock }) {
  const { t } = useI18n();
  switch (block.type) {
    case 'hero':
      return (
        <section data-story-block="hero" className="border-line border-s-2 ps-4 @min-[36rem]:ps-6">
          <p className="font-medium text-muted-foreground text-xs">{t(block.eyebrow)}</p>
          <h2 className="mt-2 text-balance font-semibold text-2xl leading-tight tracking-tight">
            {t(block.title)}
          </h2>
          <p className="mt-3 max-w-[64ch] text-muted-foreground text-sm leading-relaxed">
            {t(block.description)}
          </p>
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">
            {block.highlights.map((highlight) => (
              <li key={highlight} className="flex items-center gap-1.5">
                <Check aria-hidden className="size-3.5 text-brand" />
                {t(highlight)}
              </li>
            ))}
          </ul>
        </section>
      );
    case 'showcase':
      return (
        <figure
          data-story-block="showcase"
          className="overflow-hidden rounded-xl border border-line bg-secondary/40"
        >
          <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 border-line border-b px-4 py-3 font-medium text-xs">
            {t('Workflow illustration')}
            <span className="text-muted-foreground">· {t('Example project')}</span>
          </figcaption>
          <div className="grid min-w-0 gap-5 p-4 @min-[38rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] @min-[38rem]:p-5">
            <div className="min-w-0 rounded-lg border border-line bg-popover p-3">
              <p className="flex items-center gap-2 font-medium text-sm">
                <FileCode2 aria-hidden className="size-4 shrink-0 text-brand" />
                <code className="min-w-0 wrap-anywhere">{block.file}</code>
              </p>
              <p className="mt-3 flex items-center gap-2 text-muted-foreground text-xs">
                <GitCompareArrows aria-hidden className="size-3.5 shrink-0" />
                {t(block.title)}
              </p>
              <ul className="mt-2 divide-y divide-line">
                {block.items.map((item) => (
                  <li key={item.title} className="flex min-w-0 items-center gap-2 py-2.5">
                    <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 wrap-anywhere font-mono text-xs">
                      {item.title}
                    </span>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {t(item.description)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex min-w-0 flex-col justify-center gap-2.5 text-sm leading-relaxed">
              <p className="self-end rounded-xl rounded-tr-sm bg-selection px-3 py-2">
                {t(block.prompt)}
              </p>
              <div className="flex items-start gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-inverse-foreground">
                  <Bot aria-hidden className="size-4" />
                </span>
                <p className="min-w-0 rounded-xl rounded-tl-sm border border-line bg-popover px-3 py-2">
                  {t(block.reply)}
                </p>
              </div>
              <p className="text-right text-muted-foreground text-xs">{t('Demo conversation')}</p>
            </div>
          </div>
        </figure>
      );
    case 'comparison':
      return (
        <section data-story-block="comparison" className="space-y-4">
          <BlockTitle>{t(block.title)}</BlockTitle>
          <div className="grid gap-3 @min-[32rem]:grid-cols-2">
            {(
              [
                { label: block.before, key: 'before' },
                { label: block.after, key: 'after' },
              ] as const
            ).map(({ label, key }) => (
              <div key={key} className={key === 'after' ? 'rounded-xl bg-secondary/60 p-4' : 'p-4'}>
                <h3
                  className={
                    key === 'after'
                      ? 'font-semibold text-sm'
                      : 'font-medium text-muted-foreground text-sm'
                  }
                >
                  {t(label)}
                </h3>
                <ul className="mt-2 divide-y divide-line">
                  {block.pairs.map((pair) => (
                    <li
                      key={pair[key]}
                      className="flex items-start gap-2 py-2 text-sm leading-relaxed"
                    >
                      {key === 'after' ? (
                        <Check aria-hidden className="mt-1 size-4 shrink-0 text-brand" />
                      ) : (
                        <Minus aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span>{t(pair[key])}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      );
    case 'steps':
      return (
        <section data-story-block="steps" className="space-y-4">
          <BlockTitle>{t(block.title)}</BlockTitle>
          <ol className="grid gap-4 @min-[38rem]:grid-cols-3">
            {block.items.map((item, index) => (
              <li key={item.title} className="min-w-0 border-line border-t pt-3">
                <p
                  aria-hidden
                  className="flex items-center justify-between font-mono text-brand text-xs"
                >
                  {String(index + 1).padStart(2, '0')}
                  {index < block.items.length - 1 && (
                    <ArrowRight className="hidden size-3.5 @min-[38rem]:block" />
                  )}
                </p>
                <h3 className="mt-2 font-semibold text-sm">{t(item.title)}</h3>
                <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
                  {t(item.description)}
                </p>
              </li>
            ))}
          </ol>
        </section>
      );
  }
}

export function ExtensionStoryBlocks({ blocks }: { blocks: readonly ExtensionStoryBlock[] }) {
  return (
    <div className="space-y-7">
      {blocks.map((block) => (
        <StoryBlock key={block.type} block={block} />
      ))}
    </div>
  );
}
