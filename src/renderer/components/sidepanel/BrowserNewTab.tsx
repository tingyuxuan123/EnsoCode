import { BookOpen, Globe, History, MousePointer2, ScanLine } from 'lucide-react';
import { useI18n } from '@/i18n';

const CAPABILITIES = [
  { icon: Globe, title: 'Browse the web', detail: 'Open websites, search, and move between tabs.' },
  {
    icon: BookOpen,
    title: 'Read pages',
    detail: 'Read page text, inspect elements, and capture screenshots.',
  },
  {
    icon: MousePointer2,
    title: 'Interact with pages',
    detail: 'Click, type, fill forms, and scroll with the agent.',
  },
  {
    icon: ScanLine,
    title: 'Test layouts',
    detail: 'Preview desktop, tablet, and phone layouts with device controls.',
  },
  {
    icon: History,
    title: 'Retrace your steps',
    detail: 'Search browsing history and manage downloads.',
  },
];

export function BrowserNewTab() {
  const { t } = useI18n();
  return (
    <div className="h-full overflow-y-auto px-5 py-7">
      <div className="mx-auto flex min-h-full w-fit max-w-md flex-col justify-center">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-primary">
            <Globe className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-medium text-lg">{t('Enso Browser')}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('Your agent can explore the web with you.')}
            </p>
          </div>
        </div>
        <div className="space-y-5">
          {CAPABILITIES.map(({ icon: Icon, title, detail }) => (
            <div key={title} className="flex items-start gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <h3 className="font-medium text-sm leading-5">{t(title)}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{t(detail)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
