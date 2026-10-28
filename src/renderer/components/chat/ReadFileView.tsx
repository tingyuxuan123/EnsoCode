import { File } from '@pierre/diffs/react';
import { stripHashlineRead } from '@shared/hashlineRead';
import { useEffect, useMemo, useState } from 'react';
import { useCodeHighlightOptions } from '@/hooks/useColorScheme';
import { useI18n } from '@/i18n';
import { fileLanguage } from '@/lib/fileLanguage';
import { CODE_THEME, ensureHighlighter } from './codeHighlighter';

const FILE_OPTIONS = {
  theme: CODE_THEME,
  disableFileHeader: true,
  overflow: 'wrap',
  preferredHighlighter: 'shiki-js',
} as const;

/** read 工具输出：按文件名推断语言做语法高亮 + 行号渲染；Hashline 头/gutter 只在展开时剥，不进 buildTimeline 热路径 */
export function ReadFileView({ path, contents }: { path: string; contents: string }) {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const options = useCodeHighlightOptions(FILE_OPTIONS);
  useEffect(() => {
    let alive = true;
    ensureHighlighter().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const file = useMemo(
    () => ({
      name: path.split('/').pop() || 'file',
      contents: stripHashlineRead(contents),
      lang: fileLanguage(path),
    }),
    [path, contents]
  );

  if (!ready) {
    return (
      <div className="px-3 py-2 text-[calc(11rem/14)] text-muted-foreground">{t('Loading...')}</div>
    );
  }
  return <File file={file} disableWorkerPool options={options} />;
}
