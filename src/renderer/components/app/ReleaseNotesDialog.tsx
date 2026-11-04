import type { Schema } from 'hast-util-sanitize';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
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

const components: Components = {
  a: ({ href, children }) => {
    // target=_blank uses createAppWindow's http(s)-only setWindowOpenHandler → shell.openExternal.
    return href ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
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
  return (
    <Dialog open={info !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Release notes')}</DialogTitle>
          <DialogDescription>{info?.version}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3 break-words text-[calc(13rem/14)] leading-relaxed [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-medium [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_ul]:list-disc">
          {info && (
            <ReactMarkdown
              rehypePlugins={[rehypeRaw, [rehypeSanitize, releaseNotesSchema]]}
              urlTransform={externalUrl}
              components={components}
            >
              {info.releaseNotes}
            </ReactMarkdown>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('Close')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
