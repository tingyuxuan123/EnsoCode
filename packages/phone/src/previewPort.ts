import type {
  HostToPhone,
  PairFileTarget,
  PairPreviewEntry,
  PairPreviewFrame,
  PairPreviewInput,
  PhoneToHost,
} from '@enso/pair';

type Failure = { error: string };
export type PreviewResult = { previewId: string; frame?: PairPreviewFrame } | Failure;
type Reply = Extract<HostToPhone, { type: 'preview-list-result' | 'preview-result' }>;
type Command = Extract<PhoneToHost, { type: `preview-${string}` }>;
type WithoutRequest<T> = T extends unknown ? Omit<T, 'requestId'> : never;
type Request = WithoutRequest<Command>;
const id = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function frameOf(value: unknown): value is PairPreviewFrame {
  return (
    record(value) &&
    id(value.frameId) &&
    typeof value.width === 'number' &&
    Number.isInteger(value.width) &&
    value.width >= 320 &&
    value.width <= 1280 &&
    typeof value.height === 'number' &&
    Number.isInteger(value.height) &&
    value.height >= 240 &&
    value.height <= 1200 &&
    typeof value.dataUrl === 'string' &&
    value.dataUrl.length <= 700_000 &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value.dataUrl) &&
    (value.title === undefined || (typeof value.title === 'string' && value.title.length <= 300))
  );
}
function entryOf(value: unknown): value is PairPreviewEntry {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    /^[a-f0-9]{64}$/.test(value.id) &&
    typeof value.label === 'string' &&
    value.label.length > 0 &&
    value.label.length <= 500 &&
    (value.kind === 'html' || value.kind === 'server')
  );
}

/** 预览只传可信 JPEG 与有限输入；网页正文永远不会进入 Web 的 DOM。 */
export class PreviewPort {
  private seq = 0;
  private readonly pending = new Map<
    string,
    { expected: Reply['type']; settle: (reply: Reply | Failure) => void }
  >();
  private readonly orphanOpens = new Set<string>();
  constructor(private readonly send: (command: PhoneToHost) => unknown) {}
  async list(
    target: PairFileTarget,
    signal?: AbortSignal
  ): Promise<{ entries: PairPreviewEntry[] } | Failure> {
    const result = await this.request({ type: 'preview-list', target }, signal);
    if ('error' in result && result.error) return { error: result.error };
    if (
      !('entries' in result) ||
      !Array.isArray(result.entries) ||
      result.entries.length > 16 ||
      !result.entries.every(entryOf)
    )
      return { error: 'invalid' };
    return { entries: result.entries };
  }
  open(
    target: PairFileTarget,
    entryId: string,
    viewport: { width: number; height: number },
    signal?: AbortSignal
  ): Promise<PreviewResult> {
    return this.result({ type: 'preview-open', target, entryId, ...viewport }, signal);
  }
  frame(previewId: string): Promise<PreviewResult> {
    return this.result({ type: 'preview-frame', previewId });
  }
  input(previewId: string, frameId: string, input: PairPreviewInput): Promise<PreviewResult> {
    return this.result({ type: 'preview-input', previewId, frameId, input });
  }
  refresh(previewId: string): Promise<PreviewResult> {
    return this.result({ type: 'preview-refresh', previewId });
  }
  close(previewId: string): Promise<PreviewResult> {
    return this.result({ type: 'preview-close', previewId });
  }

  receive(reply: Reply): void {
    if (!record(reply) || typeof reply.requestId !== 'string') return;
    if (
      this.orphanOpens.delete(reply.requestId) &&
      reply.type === 'preview-result' &&
      id(reply.previewId)
    ) {
      void this.close(reply.previewId);
      return;
    }
    const pending = this.pending.get(reply.requestId);
    if (pending?.expected === reply.type) pending.settle(reply);
  }
  reset(): void {
    for (const pending of [...this.pending.values()]) pending.settle({ error: 'offline' });
    this.orphanOpens.clear();
  }
  private async result(command: Request, signal?: AbortSignal): Promise<PreviewResult> {
    const result = await this.request(command, signal);
    if ('error' in result && result.error) return { error: result.error };
    if (
      !('previewId' in result) ||
      !id(result.previewId) ||
      ('previewId' in command && command.previewId !== result.previewId) ||
      (command.type !== 'preview-close' && !frameOf('frame' in result ? result.frame : undefined))
    )
      return { error: 'invalid' };
    return {
      previewId: result.previewId,
      ...('frame' in result && frameOf(result.frame) ? { frame: result.frame } : {}),
    };
  }
  private request(command: Request, signal?: AbortSignal): Promise<Reply | Failure> {
    if (signal?.aborted) return Promise.resolve({ error: 'cancelled' });
    if (this.pending.size >= 4 && command.type !== 'preview-close')
      return Promise.resolve({ error: 'busy' });
    const requestId = `preview-${Date.now().toString(36)}-${++this.seq}`;
    return new Promise((resolve) => {
      const abort = () => settle({ error: 'cancelled' });
      const timer = setTimeout(() => settle({ error: 'timeout' }), 20_000);
      const settle = (reply: Reply | Failure) => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (
          command.type === 'preview-open' &&
          'error' in reply &&
          (reply.error === 'cancelled' || reply.error === 'timeout')
        ) {
          this.orphanOpens.add(requestId);
          while (this.orphanOpens.size > 16)
            this.orphanOpens.delete(this.orphanOpens.values().next().value!);
        }
        resolve(reply);
      };
      this.pending.set(requestId, {
        expected: command.type === 'preview-list' ? 'preview-list-result' : 'preview-result',
        settle,
      });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (this.send({ ...command, requestId }) === false) settle({ error: 'offline' });
      } catch {
        settle({ error: 'offline' });
      }
    });
  }
}
