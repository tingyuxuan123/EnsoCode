import { CHAT_TYPOGRAPHY_DEFAULTS, chatTypographyVariables } from '@shared/chatTypography';
import { useMemo } from 'react';
import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { buildFilePreviewSanitizeSchema } from '@/components/sidepanel/filePreviewSanitize';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { injectWikiLinksIntoMarkdown, parseWikiLinkHref } from './wikiLinks';

const REMARK_PLUGINS = [remarkGfm];
const BASE_SCHEMA = buildFilePreviewSanitizeSchema();
const SANITIZE_SCHEMA = {
  ...BASE_SCHEMA,
  protocols: {
    ...BASE_SCHEMA.protocols,
    href: [...(BASE_SCHEMA.protocols?.href ?? ['http', 'https', 'mailto']), 'wikilink'],
  },
};
const PREVIEW_STYLE = chatTypographyVariables(CHAT_TYPOGRAPHY_DEFAULTS);

export function WikiMarkdownPreview({
  markdown,
  brokenTargets,
  onOpenWikiLink,
}: {
  markdown: string;
  brokenTargets?: ReadonlySet<string>;
  onOpenWikiLink: (target: string) => void;
}) {
  const { t } = useI18n();
  const processed = useMemo(() => injectWikiLinksIntoMarkdown(markdown), [markdown]);

  const components = useMemo<Components>(
    () => ({
      h1: ({ children }) => (
        <h1 className="mt-4 mb-2 border-border/50 border-b pb-1 text-lg font-semibold first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="mt-4 mb-1.5 text-base font-semibold first:mt-0">{children}</h2>
      ),
      h3: ({ children }) => (
        <h3 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h3>
      ),
      p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
      ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
      blockquote: ({ children }) => (
        <blockquote className="my-2 border-border border-l-2 pl-3 text-muted-foreground">
          {children}
        </blockquote>
      ),
      code: ({ className, children }) => {
        const isBlock = Boolean(className?.includes('language-'));
        if (isBlock) {
          return (
            <code className={cn('block font-mono text-[calc(12.5rem/14)] leading-5', className)}>
              {children}
            </code>
          );
        }
        return (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[calc(12.5rem/14)]">
            {children}
          </code>
        );
      },
      pre: ({ children }) => (
        <pre className="my-2 overflow-x-auto rounded-md border border-border/60 bg-muted/40 p-3">
          {children}
        </pre>
      ),
      table: ({ children }) => (
        <div className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-left text-[calc(13rem/14)]">
            {children}
          </table>
        </div>
      ),
      th: ({ children }) => (
        <th className="border-b border-border px-2.5 py-1.5 font-medium text-foreground">
          {children}
        </th>
      ),
      td: ({ children }) => <td className="border-b border-border/50 px-2.5 py-1.5">{children}</td>,
      a: ({ href, children }) => {
        const target = parseWikiLinkHref(href);
        if (target) {
          const isBroken = brokenTargets?.has(target) ?? false;
          return (
            <button
              type="button"
              data-wikilink={target}
              title={
                isBroken
                  ? t('Unresolved link — click to create [[{{target}}]]', { target })
                  : `[[${target}]]`
              }
              onClick={() => onOpenWikiLink(target)}
              className={cn(
                'inline cursor-pointer rounded px-0.5 font-medium underline decoration-1 underline-offset-2 transition-colors',
                isBroken
                  ? 'text-destructive decoration-dashed hover:bg-destructive/10'
                  : 'text-brand hover:bg-selection/70'
              )}
            >
              {children}
            </button>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-brand underline underline-offset-2 hover:opacity-80"
          >
            {children}
          </a>
        );
      },
    }),
    [brokenTargets, onOpenWikiLink, t]
  );

  return (
    <div style={PREVIEW_STYLE} className="text-[calc(13.5rem/14)] text-foreground">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}
        urlTransform={(url) => (url.startsWith('wikilink://') ? url : defaultUrlTransform(url))}
        components={components}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
