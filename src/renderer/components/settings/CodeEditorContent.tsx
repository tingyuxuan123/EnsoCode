import { Editor, type EditorOptions } from '@pierre/diffs/edit';
import { EditProvider, File, Virtualizer } from '@pierre/diffs/react';
import * as React from 'react';
import { CODE_THEME, ensureHighlighter } from '@/components/chat/codeHighlighter';
import { useCodeHighlightOptions } from '@/hooks/useColorScheme';
import { cn } from '@/lib/utils';

const FILE_OPTIONS = {
  theme: CODE_THEME,
  disableFileHeader: true,
  overflow: 'scroll',
  preferredHighlighter: 'shiki-js',
} as const;

function createEditor<A>(options: EditorOptions<A>) {
  return new Editor(options);
}

export function CodeEditorContent({
  fileName,
  value,
  epoch,
  onChange,
  className,
  loading,
}: {
  fileName: string;
  value: string;
  epoch: number | string;
  onChange: (value: string) => void;
  className: string;
  loading: React.ReactNode;
}) {
  const [ready, setReady] = React.useState(false);
  const options = useCodeHighlightOptions(FILE_OPTIONS);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const editOptions = React.useMemo<EditorOptions<undefined>>(
    () => ({
      onChange(file) {
        onChangeRef.current(file.contents);
      },
    }),
    []
  );

  React.useEffect(() => {
    let alive = true;
    void ensureHighlighter().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) return loading;

  return (
    <div className={cn('w-full overflow-hidden rounded-[6px] border border-input', className)}>
      <EditProvider createEditor={createEditor}>
        <Virtualizer style={{ height: '100%', overflow: 'auto' }}>
          <File
            key={epoch}
            file={{ name: fileName, contents: value }}
            disableWorkerPool
            edit
            editorOptions={editOptions}
            options={options}
          />
        </Virtualizer>
      </EditProvider>
    </div>
  );
}
