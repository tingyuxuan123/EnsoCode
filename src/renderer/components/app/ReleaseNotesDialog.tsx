import type { Schema } from 'hast-util-sanitize';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/i18n';

const REMARK_PLUGINS = [remarkGfm];

// Official GitHub feeds may supply HTML. Allow only formatting and hyperlinks, with
// no IDs, styles, event handlers, embedded resources or interactive controls.
const releaseNotesSchema: Schema = {
  tagNames: [
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'dd',
    'del',
    'dl',
    'dt',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'kbd',
    'li',
    'ol',
    'p',
    'pre',
    's',
    'span',
    'strong',
    'sub',
    'sup',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'ul',
  ],
  attributes: { a: ['href'], ol: ['start'] },
  protocols: { href: ['http', 'https'] },
  strip: [
    'audio',
    'button',
    'embed',
    'form',
    'iframe',
    'math',
    'object',
    'picture',
    'script',
    'style',
    'svg',
    'template',
    'textarea',
    'video',
  ],
};

function externalUrl(value: string): string {
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    // Relative and malformed addresses are not external links.
  }
  return '';
}

function formatVersionTag(version?: string): string {
  const trimmed = version?.trim() ?? '';
  if (!trimmed) return '';
  return /^v/i.test(trimmed) ? trimmed : `v${trimmed}`;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-5 mb-3 border-b border-border/60 pb-2.5 font-semibold text-[calc(16rem/14)] text-foreground leading-snug tracking-[-0.015em] first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-5 mb-2 font-semibold text-[calc(14rem/14)] text-foreground leading-snug tracking-[-0.01em] first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 mb-1.5 font-semibold text-[calc(13rem/14)] text-foreground leading-snug first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 mb-1 font-medium text-[calc(13rem/14)] text-foreground leading-snug first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="my-2 text-foreground/85 leading-[1.65] first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1.5 pl-5 text-foreground/85 marker:text-muted-foreground/75 first:mt-0 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ start, children }) => (
    <ol
      start={start}
      className="my-2 list-decimal space-y-1.5 pl-5 text-foreground/85 marker:text-muted-foreground/75 first:mt-0 last:mb-0"
    >
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="pl-0.5 leading-[1.65] [&>ol]:mt-1.5 [&>p]:my-1 [&>ul]:mt-1.5">{children}</li>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  b: ({ children }) => <b className="font-semibold text-foreground">{children}</b>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-border border-l-2 pl-3.5 text-muted-foreground [&>p]:text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="mx-0.5 rounded-[4px] border border-border/60 bg-muted/60 px-1 py-px font-mono text-[calc(11rem/14)] text-foreground">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto whitespace-pre-wrap rounded-[6px] border border-border/60 bg-muted/50 px-3 py-2.5 font-mono text-[calc(12rem/14)] text-foreground leading-relaxed [&>code]:mx-0 [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-4 border-0 border-border/70 border-t" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-[calc(12rem/14)]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-border border-b px-2.5 py-1.5 text-left font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-border/50 border-b px-2.5 py-1.5 align-top text-foreground/85">
      {children}
    </td>
  ),
  kbd: ({ children }) => (
    <kbd className="rounded-[4px] border border-border bg-muted px-1.5 py-0.5 font-mono text-[calc(11rem/14)] text-foreground">
      {children}
    </kbd>
  ),
  a: ({ href, children }) => {
    // target=_blank uses createAppWindow's http(s)-only setWindowOpenHandler → shell.openExternal.
    return href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand underline decoration-brand/40 underline-offset-2 transition-colors hover:decoration-brand"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
};

export function ReleaseNotesDialog({
  info,
  onClose,
}: {
  info: { version: string; releaseNotes: string } | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const versionTag = formatVersionTag(info?.version);
  return (
    <Dialog open={info !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-h-[min(82vh,760px)] max-w-[min(680px,calc(100vw-3rem))] shadow-float">
        <DialogHeader className="gap-0 px-[24px] py-[13px] pr-[52px]">
          <div className="flex items-center gap-2.5">
            <DialogTitle className="text-[calc(15rem/14)] leading-[calc(22rem/14)] tracking-[-0.01em]">
              {t('Release notes')}
            </DialogTitle>
            {versionTag && (
              <span
                data-slot="release-version-badge"
                className="inline-flex items-center rounded-[5px] border border-border/80 bg-muted/70 px-[7px] py-[2px] font-medium font-mono text-[calc(11rem/14)] text-muted-foreground leading-none"
              >
                {versionTag}
              </span>
            )}
          </div>
          <DialogDescription className="sr-only">{info?.version}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="px-[24px] py-[20px] text-[calc(13rem/14)] text-foreground/85 leading-[1.65] break-words [&_hr+p:last-child]:mt-0 [&_hr+p:last-child]:text-[calc(12rem/14)] [&_hr+p:last-child]:text-muted-foreground [&_hr+p:last-child]:leading-relaxed">
          {info && (
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={[rehypeRaw, [rehypeSanitize, releaseNotesSchema]]}
              urlTransform={externalUrl}
              components={components}
            >
              {info.releaseNotes}
            </ReactMarkdown>
          )}
        </DialogPanel>
        <DialogFooter className="px-[24px] py-[12px]">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('Close')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
