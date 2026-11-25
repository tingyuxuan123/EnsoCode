import { parseMarkdownHttpUrl } from '@shared/markdownLinks';
import { useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';

type ReadmeSource = { id: string; from: 'installed' | 'market' };
type ReadmeState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'empty' }
  | { status: 'error'; error: string };

// A README is documentation, not a chat transcript or a plugin view. Only markdown, and no
// remote images (screenshots come from the separately verified market index).
const markdownComponents: Components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
  a: ({ children, href }) => {
    const url = parseMarkdownHttpUrl(href ?? '');
    return url ? (
      <a href={url} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      children
    );
  },
  table: ({ children }) => (
    <div className="max-w-full overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};

function ReadmeBody({ id, from, retry }: ReadmeSource & { retry(): void }) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadmeState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await window.electronAPI.extensionPlugins.readme({ id, from });
        if (!active) return;
        if (!result.ok) setState({ status: 'error', error: result.error });
        else
          setState(
            result.text.trim() ? { status: 'ready', text: result.text } : { status: 'empty' }
          );
      } catch (error) {
        if (active) setState({ status: 'error', error: String(error) });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [id, from]);

  switch (state.status) {
    case 'loading':
      return (
        <p role="status" className="text-muted-foreground">
          {t('Loading...')}
        </p>
      );
    case 'empty':
      return <p className="text-muted-foreground">{t('No documentation yet')}</p>;
    case 'error':
      return (
        <div role="alert" className="space-y-2 text-destructive [overflow-wrap:anywhere]">
          <p>{state.error}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            {t('Retry')}
          </Button>
        </div>
      );
    case 'ready':
      return (
        <div className="min-w-0 space-y-4 leading-relaxed [overflow-wrap:anywhere] [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-border [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_h3]:font-semibold [&_h3]:text-base [&_h4]:font-medium [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-secondary [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:pl-5">
          <ReactMarkdown
            skipHtml
            disallowedElements={['img', 'input']}
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {state.text}
          </ReactMarkdown>
        </div>
      );
  }
}

export function ExtensionShowcaseReadme({
  id,
  from,
  ready = true,
}: ReadmeSource & { ready?: boolean }) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  return (
    <section className="space-y-4 border-border border-t pt-6">
      <h2 className="font-semibold text-xl">{t('Documentation')}</h2>
      <div className="max-w-[80ch] text-sm">
        {ready ? (
          <ReadmeBody
            key={JSON.stringify([id, from, attempt])}
            id={id}
            from={from}
            retry={() => setAttempt((current) => current + 1)}
          />
        ) : (
          <p role="status" data-slot="showcase-readme-deferred" className="text-muted-foreground">
            {t('Loading...')}
          </p>
        )}
      </div>
    </section>
  );
}
