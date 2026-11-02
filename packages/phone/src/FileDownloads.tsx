import { PAIR_FILE_MAX_BYTES, type PairFileEntry, type PairFileTarget } from '@enso/pair';
import { Download, FileText, FolderDown, Loader2, RefreshCw } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { FileTransferPort } from './fileTransferPort';
import type { PreviewPort } from './previewPort';
import { WebPreviewContext } from './WebPreview';

export const FileDownloadsContext = createContext<{
  port: FileTransferPort;
  available: boolean;
  online: boolean;
} | null>(null);

export function FileDownloadsRoot({
  port,
  available,
  online,
  preview,
  children,
}: {
  port: FileTransferPort;
  available: boolean;
  online: boolean;
  preview?: { port: PreviewPort; available: boolean; readOnly: boolean };
  children: ReactNode;
}) {
  return (
    <FileDownloadsContext.Provider value={{ port, available, online }}>
      <WebPreviewContext.Provider value={preview ? { ...preview, online } : null}>
        <div className="phone-app-root flex h-full min-h-0">{children}</div>
      </WebPreviewContext.Provider>
    </FileDownloadsContext.Provider>
  );
}

const sizeText = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const ERROR: Record<string, string> = {
  offline: '连接已断开，请连上电脑后重新下载。',
  timeout: '文件读取超时，请检查连接后重试。',
  'too-large': '文件超过 50 MB，暂不支持下载。',
  'not-found': '文件已修改或移走，请刷新列表后重试。',
  changed: '文件正在修改，请等待完成后刷新列表。',
  busy: '另一个文件正在下载，请稍候。',
  unavailable: '该会话暂不支持文件下载（例如 SSH 远程项目）。',
  invalid: '文件已变化或不可用，请刷新列表后重试。',
};

/** 普通会话顶栏 / Bot 回复共用。只下载原始字节，不把 HTML/SVG 当同源页面打开。 */
export function FileDownloads({
  target,
  children,
}: {
  target: PairFileTarget;
  children?: ReactNode;
}) {
  const context = useContext(FileDownloadsContext);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<PairFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ id: string; bytes: number } | null>(null);
  const [ready, setReady] = useState<{ url: string; name: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const port = context?.port;
  const online = context?.online ?? false;
  const key = JSON.stringify(target);
  // target 在父层内联构建；稳定身份变化才取消旧请求。
  // biome-ignore lint/correctness/useExhaustiveDependencies: key 完整表达 target 身份
  useEffect(() => {
    request.current?.abort();
    setReady(null);
    setLoading(false);
    setProgress(null);
    setFiles([]);
    setError(null);
    if (!open || !port) return;
    if (!online) {
      setError('offline');
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    void port.list(target, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if ('error' in result) setError(result.error);
      else setFiles(result.files);
      setLoading(false);
    });
    return () => controller.abort();
  }, [open, port, key, revision, online]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(
    () => () => {
      if (ready) URL.revokeObjectURL(ready.url);
    },
    [ready]
  );
  if (!context?.available) return null;

  const download = async (file: PairFileEntry) => {
    if (!port || progress) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setReady(null);
    setError(null);
    setProgress({ id: file.id, bytes: 0 });
    const result = await port.download(
      target,
      file,
      (bytes) => {
        if (!controller.signal.aborted) setProgress({ id: file.id, bytes });
      },
      controller.signal
    );
    if (controller.signal.aborted) return;
    setProgress(null);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    // 第二次由用户点「保存」：Safari/PWA 不依赖异步网络后的程序化 click 手势。
    setReady({ url: URL.createObjectURL(result.blob), name: result.name });
  };
  const changeOpen = (next: boolean) => {
    if (!next) request.current?.abort();
    setOpen(next);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => changeOpen(true)}
        aria-label="下载会话文件"
        title="下载会话文件"
        className={
          children
            ? 'flex max-w-60 items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-left text-xs'
            : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'
        }
      >
        {children ?? <FolderDown className="h-4.5 w-4.5" />}
      </button>
      <Sheet open={open} onOpenChange={changeOpen}>
        <SheetContent side="bottom" className="phone-sheet pb-safe">
          <SheetHeader className="px-4 pt-7 pb-4">
            <SheetTitle className="font-semibold text-[15px]">下载会话文件</SheetTitle>
            <SheetDescription>
              取回助手生成、修改或在回复中提到的工作区文件。通过加密连接传输，单文件最多 50 MB。
            </SheetDescription>
          </SheetHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto px-4 pb-4">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || Boolean(progress) || !online}
              onClick={() => setRevision((n) => n + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              刷新文件列表
            </Button>
            {loading && (
              <p className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在读取文件列表…
              </p>
            )}
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {ERROR[error] ?? '文件读取失败，请刷新后重试。'}
              </p>
            )}
            {!loading && !error && files.length === 0 && (
              <div className="rounded-md border border-dashed p-5 text-center text-muted-foreground text-sm">
                还没有可下载的文件。请让助手把结果保存到项目目录，并在回复中写出文件名，再刷新列表。
              </div>
            )}
            {files.map((file) => (
              <div key={file.id} className="flex min-w-0 items-center gap-2 rounded-md border p-3">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{file.name}</p>
                  <p className="truncate text-muted-foreground text-xs" title={file.rel}>
                    {file.rel} · {sizeText(file.size)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(progress) || !online || file.size > PAIR_FILE_MAX_BYTES}
                  onClick={() => void download(file)}
                  aria-label={`取回 ${file.name}`}
                >
                  {progress?.id === file.id ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {Math.round((progress.bytes / Math.max(1, file.size)) * 100)}%
                    </>
                  ) : (
                    <>
                      <Download className="h-3.5 w-3.5" />
                      {file.size > PAIR_FILE_MAX_BYTES ? '超过 50 MB' : '取回'}
                    </>
                  )}
                </Button>
              </div>
            ))}
            {progress && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  request.current?.abort();
                  setProgress(null);
                }}
              >
                取消下载
              </Button>
            )}
            {ready && (
              <a
                href={ready.url}
                download={ready.name}
                className="flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-primary-foreground text-sm"
              >
                <Download className="h-4 w-4" />
                保存 {ready.name}
              </a>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
