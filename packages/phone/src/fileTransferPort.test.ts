import type { HostToPhone, PairFileEntry, PhoneToHost } from '@enso/pair';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTransferPort } from './fileTransferPort';

const target = { sessionId: 'session' };
const file: PairFileEntry = { id: 'a'.repeat(64), name: '报告.docx', rel: '报告.docx', size: 5 };
type Request = Extract<PhoneToHost, { type: 'file-list' | 'file-read' }>;
type Reply = Extract<HostToPhone, { type: 'file-list-result' | 'file-read-result' }>;

describe('Web 文件取回', () => {
  let sent: Request[];
  let port: FileTransferPort;
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    port = new FileTransferPort((command) => sent.push(command as Request));
  });
  afterEach(() => {
    port.reset();
    vi.useRealTimers();
  });
  const reply = (value: Omit<Reply, 'requestId'> & Record<string, unknown>) => {
    expect(sent.at(-1), '应先发送文件请求').toBeDefined();
    port.receive({ ...value, requestId: sent.at(-1)!.requestId } as Reply);
  };

  it('普通会话和 Bot 都只发标识符并按请求对号入座', async () => {
    const pending = port.list(target);
    expect(sent[0]).toMatchObject({ type: 'file-list', target });
    port.receive({ type: 'file-list-result', requestId: 'stale', files: [file] });
    reply({ type: 'file-list-result', files: [file] });
    expect(await pending).toEqual({ files: [file] });
    const bot = { bot: { chatId: 'chat', entryId: 'entry' } };
    const next = port.list(bot);
    expect(sent.at(-1)).toMatchObject({ target: bot });
    reply({ type: 'file-list-result', files: [] });
    expect(await next).toEqual({ files: [] });
  });

  it('逐块拉取后合成原始二进制，进度只计算已验证字节', async () => {
    const progress: number[] = [];
    const pending = port.download(target, file, (n) => progress.push(n));
    expect(sent[0]).toMatchObject({ type: 'file-read', fileId: file.id, offset: 0 });
    reply({ type: 'file-read-result', name: file.name, size: 5, offset: 0, data: 'AAEC' });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ offset: 3 });
    reply({ type: 'file-read-result', name: file.name, size: 5, offset: 3, data: '/wQ=' });
    const result = await pending;
    expect('blob' in result).toBe(true);
    if ('blob' in result) {
      expect([...new Uint8Array(await result.blob.arrayBuffer())]).toEqual([0, 1, 2, 255, 4]);
      expect(result.blob.type).toBe('application/octet-stream');
      expect(result.name).toBe(file.name);
    }
    expect(progress).toEqual([3, 5]);
  });

  it.each([
    { offset: 1, data: 'AA==' },
    { offset: 0, data: '' },
    { offset: 0, data: 'not base64' },
    { offset: 0, data: 'AAAA', size: 2 },
    { offset: 0, data: 'AA==', name: 'other.docx' },
  ])('拒绝错位、停滞、坏数据和变更中的文件 %j', async (bad) => {
    const pending = port.download(target, file);
    reply({ type: 'file-read-result', name: file.name, size: file.size, ...bad });
    expect(await pending).toEqual({ error: 'invalid' });
    expect(sent).toHaveLength(1);
  });

  it('空文件也能下载；过大文件在请求前拒绝', async () => {
    const pending = port.download(target, { ...file, size: 0 });
    reply({ type: 'file-read-result', name: file.name, size: 0, offset: 0, data: '' });
    const result = await pending;
    expect('blob' in result && result.blob.size).toBe(0);
    expect(await port.download(target, { ...file, size: 51 * 1024 * 1024 })).toEqual({
      error: 'too-large',
    });
    expect(sent).toHaveLength(1);
  });

  it('只允许一个下载，断线后立即结算且不再请求后续块', async () => {
    const first = port.download(target, file);
    expect(await port.download(target, file)).toEqual({ error: 'busy' });
    port.reset();
    expect(await first).toEqual({ error: 'offline' });
    expect(sent).toHaveLength(1);
  });

  it('取消、超时和传输失败不会永久卡在下载中', async () => {
    const abort = new AbortController();
    const pending = port.download(target, file, undefined, abort.signal);
    abort.abort();
    expect(await pending).toEqual({ error: 'cancelled' });
    const timed = port.list(target);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await timed).toEqual({ error: 'timeout' });
    const offline = new FileTransferPort(() => false);
    expect(await offline.download(target, file)).toEqual({ error: 'offline' });
  });

  it('列表不接收脏元数据，错误回执按原样结算', async () => {
    const pending = port.list(target);
    reply({ type: 'file-list-result', files: [{ ...file, id: '../secret' }] });
    expect(await pending).toEqual({ error: 'invalid' });
    const denied = port.list(target);
    reply({ type: 'file-list-result', files: [], error: 'unavailable' });
    expect(await denied).toEqual({ error: 'unavailable' });
  });
});
