import {
  type HostToPhone,
  PAIR_FILE_CHUNK_BYTES,
  PAIR_FILE_MAX_BYTES,
  type PairFileEntry,
  type PairFileTarget,
  type PhoneToHost,
} from '@enso/pair';

type Reply = Extract<HostToPhone, { type: 'file-list-result' | 'file-read-result' }>;
type Request = Extract<PhoneToHost, { type: 'file-list' | 'file-read' }>;
type Failure = { error: string };
type Pending = { type: Reply['type']; settle: (reply: Reply | Failure) => void };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function fileEntry(value: unknown): value is PairFileEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-f0-9]{64}$/.test(value.id) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    value.name.length <= 1024 &&
    typeof value.rel === 'string' &&
    value.rel.length > 0 &&
    value.rel.length <= 4096 &&
    typeof value.size === 'number' &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0
  );
}

function decodeChunk(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(PAIR_FILE_CHUNK_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    return null;
  try {
    const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    return bytes.length <= PAIR_FILE_CHUNK_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** 每次只拉一块，直连和加密中继共用；请求超时/取消后不重试未知结果。 */
export class FileTransferPort {
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private epoch = 0;
  private activeDownload: symbol | null = null;

  constructor(private readonly send: (command: PhoneToHost) => unknown) {}

  async list(
    target: PairFileTarget,
    signal?: AbortSignal
  ): Promise<{ files: PairFileEntry[] } | Failure> {
    const result = await this.request({ type: 'file-list', target }, signal);
    if ('error' in result && result.error) return { error: result.error };
    if (
      !('files' in result) ||
      !Array.isArray(result.files) ||
      result.files.length > 128 ||
      !result.files.every(fileEntry)
    )
      return { error: 'invalid' };
    return { files: result.files };
  }

  async download(
    target: PairFileTarget,
    file: PairFileEntry,
    progress?: (bytes: number) => void,
    signal?: AbortSignal
  ): Promise<{ blob: Blob; name: string } | Failure> {
    if (this.activeDownload) return { error: 'busy' };
    if (!fileEntry(file)) return { error: 'invalid' };
    if (file.size > PAIR_FILE_MAX_BYTES) return { error: 'too-large' };
    const token = Symbol();
    this.activeDownload = token;
    const epoch = this.epoch;
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let offset = 0;
    try {
      do {
        if (epoch !== this.epoch) return { error: 'offline' };
        const result = await this.request(
          { type: 'file-read', target, fileId: file.id, offset },
          signal
        );
        if ('error' in result && result.error) return { error: result.error };
        if (epoch !== this.epoch) return { error: 'offline' };
        if (signal?.aborted) return { error: 'cancelled' };
        if (
          !('data' in result) ||
          result.offset !== offset ||
          result.size !== file.size ||
          result.name !== file.name
        )
          return { error: 'invalid' };
        const bytes = decodeChunk(result.data);
        if (
          !bytes ||
          offset + bytes.length > file.size ||
          (bytes.length === 0 && offset < file.size)
        )
          return { error: 'invalid' };
        chunks.push(bytes);
        offset += bytes.length;
        progress?.(offset);
      } while (offset < file.size);
      return { blob: new Blob(chunks, { type: 'application/octet-stream' }), name: file.name };
    } finally {
      if (this.activeDownload === token) this.activeDownload = null;
    }
  }

  receive(frame: Reply): void {
    const pending = this.pending.get(frame.requestId);
    if (pending?.type === frame.type) pending.settle(frame);
  }

  reset(): void {
    this.epoch++;
    this.activeDownload = null;
    for (const pending of [...this.pending.values()]) pending.settle({ error: 'offline' });
  }

  private request(
    command:
      | Omit<Extract<Request, { type: 'file-list' }>, 'requestId'>
      | Omit<Extract<Request, { type: 'file-read' }>, 'requestId'>,
    signal?: AbortSignal
  ): Promise<Reply | Failure> {
    if (signal?.aborted) return Promise.resolve({ error: 'cancelled' });
    if (this.pending.size >= 16) return Promise.resolve({ error: 'busy' });
    const requestId = `file-${Date.now().toString(36)}-${++this.seq}`;
    return new Promise((resolve) => {
      const cancel = () => settle({ error: 'cancelled' });
      const timer = setTimeout(() => settle({ error: 'timeout' }), 30_000);
      const settle = (reply: Reply | Failure) => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        resolve(reply);
      };
      this.pending.set(requestId, {
        type: command.type === 'file-list' ? 'file-list-result' : 'file-read-result',
        settle,
      });
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        if (this.send({ ...command, requestId }) === false) settle({ error: 'offline' });
      } catch {
        settle({ error: 'offline' });
      }
    });
  }
}
