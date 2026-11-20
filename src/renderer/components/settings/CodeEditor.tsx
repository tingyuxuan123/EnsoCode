import { type ComponentProps, lazy, Suspense } from 'react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

// Both callers load with Settings, but only the code tabs need the editor and highlighter.
const CodeEditorContent = lazy(async () => ({
  default: (await import('./CodeEditorContent')).CodeEditorContent,
}));

type CodeEditorProps = Omit<ComponentProps<typeof CodeEditorContent>, 'loading' | 'className'> & {
  className?: string;
};

/** 带高亮的代码编辑框；语言按 fileName 扩展名推断，epoch 变化时以 value 重置内容 */
export function CodeEditor({ className = 'h-60', ...props }: CodeEditorProps) {
  const { t } = useI18n();
  const loading = (
    <div
      role="status"
      className={cn(
        'flex w-full items-center justify-center rounded-[6px] border border-input text-muted-foreground text-[calc(12rem/14)]',
        className
      )}
    >
      {t('Loading...')}
    </div>
  );
  return (
    <Suspense fallback={loading}>
      <CodeEditorContent {...props} className={className} loading={loading} />
    </Suspense>
  );
}
