import type { HostToPhone, PhoneToHost } from '@enso/pair';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewPort } from './previewPort';

type Command = Extract<PhoneToHost, { type: `preview-${string}` }>;
type Reply = Extract<HostToPhone, { type: 'preview-result' | 'preview-list-result' }>;
const target = { sessionId: 's' };
const entry = { id: 'a'.repeat(64), kind: 'html' as const, label: 'index.html' };
const frame = {
  frameId: 'frame1',
  width: 393,
  height: 752,
  dataUrl: 'data:image/jpeg;base64,AA==',
};
describe('Web 加密预览请求', () => {
  let sent: Command[];
  let port: PreviewPort;
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    port = new PreviewPort((command) => sent.push(command as Command));
  });
  afterEach(() => {
    port.reset();
    vi.useRealTimers();
  });
  function reply(value: Record<string, unknown>) {
    expect(sent.at(-1)).toBeDefined();
    port.receive({ ...value, requestId: sent.at(-1)!.requestId } as Reply);
  }
  it('只传会话和不透明候选标识，列表和打开回执按请求关联', async () => {
    const pending = port.list(target);
    expect(sent[0]).toMatchObject({ type: 'preview-list', target });
    port.receive({ type: 'preview-list-result', requestId: 'other', entries: [entry] });
    reply({ type: 'preview-list-result', entries: [entry] });
    expect(await pending).toEqual({ entries: [entry] });
    const opened = port.open(target, entry.id, { width: 393, height: 752 });
    expect(sent.at(-1)).toMatchObject({
      type: 'preview-open',
      target,
      entryId: entry.id,
      width: 393,
      height: 752,
    });
    reply({ type: 'preview-result', previewId: 'preview1', frame });
    expect(await opened).toEqual({ previewId: 'preview1', frame });
  });
  it('操作必须携带当前画面标识，不接受伪造图像 URL 或无尺寸画面', async () => {
    const action = port.input('preview1', 'frame1', { kind: 'click', x: 100, y: 200 });
    expect(sent.at(-1)).toMatchObject({
      type: 'preview-input',
      previewId: 'preview1',
      frameId: 'frame1',
      input: { kind: 'click', x: 100, y: 200 },
    });
    reply({
      type: 'preview-result',
      previewId: 'preview1',
      frame: { ...frame, dataUrl: 'https://evil.test/image' },
    });
    expect(await action).toEqual({ error: 'invalid' });
    const next = port.frame('preview1');
    reply({ type: 'preview-result', previewId: 'preview1', frame: { ...frame, width: 0 } });
    expect(await next).toEqual({ error: 'invalid' });
  });
  it('关闭在途预览也能发送，关闭成功无需画面，过期和只读错误直接展示', async () => {
    const pending = port.frame('preview1');
    const closed = port.close('preview1');
    expect(sent.at(-1)).toMatchObject({ type: 'preview-close', previewId: 'preview1' });
    reply({ type: 'preview-result', previewId: 'preview1' });
    expect(await closed).toEqual({ previewId: 'preview1' });
    port.reset();
    expect(await pending).toEqual({ error: 'offline' });
    const denied = port.input('preview1', 'old', { kind: 'key', key: 'Enter' });
    reply({ type: 'preview-result', error: 'read-only' });
    expect(await denied).toEqual({ error: 'read-only' });
  });
  it('断线、超时、取消和传输不可用都能结算，关闭丢失的预览不复活旧回执', async () => {
    const pending = port.list(target);
    port.reset();
    expect(await pending).toEqual({ error: 'offline' });
    const timed = port.frame('preview1');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await timed).toEqual({ error: 'timeout' });
    const controller = new AbortController();
    const cancelled = port.list(target, controller.signal);
    controller.abort();
    expect(await cancelled).toEqual({ error: 'cancelled' });
    expect(await new PreviewPort(() => false).list(target)).toEqual({ error: 'offline' });
  });
  it('脏列表和错误预览身份不交给界面', async () => {
    const list = port.list(target);
    reply({ type: 'preview-list-result', entries: [{ ...entry, id: '/etc/passwd' }] });
    expect(await list).toEqual({ error: 'invalid' });
    const next = port.frame('preview1');
    reply({ type: 'preview-result', previewId: 'wrong-preview', frame });
    expect(await next).toEqual({ error: 'invalid' });
  });
  it('打开后立即取消时，迟到的浏览器创建回执会触发关闭', async () => {
    const controller = new AbortController();
    const pending = port.open(target, entry.id, { width: 393, height: 752 }, controller.signal);
    const requestId = sent.at(-1)!.requestId;
    controller.abort();
    expect(await pending).toEqual({ error: 'cancelled' });
    port.receive({ type: 'preview-result', requestId, previewId: 'late-preview', frame });
    expect(sent.at(-1)).toMatchObject({ type: 'preview-close', previewId: 'late-preview' });
    reply({ type: 'preview-result', previewId: 'late-preview' });
  });
});
