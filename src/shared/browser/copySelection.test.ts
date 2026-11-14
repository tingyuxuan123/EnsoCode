import { afterEach, describe, expect, it } from 'vitest';
import {
  COPY_SELECTION_MAX_BYTES,
  COPY_SELECTION_STATE_KEY,
  pageCopySelectionCleanupScript,
  pageCopySelectionInstallScript,
  pageCopySelectionReadScript,
  parseCopySelectionResult,
} from './copySelection';

const TOKEN = 'copy-token-0123456789';
const OTHER_TOKEN = 'copy-token-9876543210';

const nativeWrites: { type: string; data: unknown }[] = [];
const nativeReads: string[] = [];

class FakeDataTransfer {
  setData(type: string, data: unknown): void {
    nativeWrites.push({ type, data });
  }
  getData(type: string): string {
    nativeReads.push(type);
    return 'system-clipboard-secret';
  }
}

const originalSetData = FakeDataTransfer.prototype.setData;
const originalGetData = FakeDataTransfer.prototype.getData;

const runScript = (script: string, scope: Record<string, unknown>): unknown =>
  new Function('window', 'DataTransfer', 'setTimeout', `return ${script}`)(
    scope,
    FakeDataTransfer,
    setTimeout
  );

const install = (scope: Record<string, unknown>, token = TOKEN): unknown =>
  runScript(pageCopySelectionInstallScript(token), scope);

const read = (
  scope: Record<string, unknown>,
  waitMs = 10,
  token = TOKEN
): Promise<Record<string, unknown>> =>
  runScript(pageCopySelectionReadScript(token, waitMs), scope) as Promise<Record<string, unknown>>;

const cleanup = (scope: Record<string, unknown>, token = TOKEN): unknown =>
  runScript(pageCopySelectionCleanupScript(token), scope);

const fresh = (): Record<string, unknown> => {
  nativeWrites.length = 0;
  nativeReads.length = 0;
  return {};
};

afterEach(() => {
  FakeDataTransfer.prototype.setData = originalSetData;
  FakeDataTransfer.prototype.getData = originalGetData;
  nativeWrites.length = 0;
  nativeReads.length = 0;
});

describe('页面复制选区捕获脚本', () => {
  it('空串也标记确实收到，且不写系统剪贴板、不读系统剪贴板', async () => {
    const scope = fresh();
    expect(install(scope)).toEqual({ ok: true });
    expect(FakeDataTransfer.prototype.setData).not.toBe(originalSetData);

    const transfer = new FakeDataTransfer();
    transfer.setData('text/plain', '');
    expect(nativeWrites).toEqual([]);
    expect(transfer.getData('text/plain')).toBe('');
    expect(nativeReads).toEqual([]);

    const raw = await read(scope);
    expect(raw).toEqual({ ok: true, seen: true, text: '', meta: '' });
    expect(parseCopySelectionResult(raw)).toEqual({ text: '' });
    expect(cleanup(scope)).toEqual({ ok: true });
    expect(FakeDataTransfer.prototype.setData).toBe(originalSetData);
    expect(FakeDataTransfer.prototype.getData).toBe(originalGetData);
    expect(COPY_SELECTION_STATE_KEY in scope).toBe(false);
  });

  it('捕获中文 TSV 与零基表格范围，未知元数据不透出', async () => {
    const scope = fresh();
    install(scope);
    const meta = JSON.stringify({
      fileId: 'file-secret',
      linkId: 'link-secret',
      html: '<b>secret</b>',
      srcRange: 'sheetIdx:0,rowFrom:2,rowTo:3,colFrom:1,colTo:4,sheetStId:17',
    });
    const transfer = new FakeDataTransfer();
    transfer.setData('text/ksDocClipBoardInfo', meta);
    transfer.setData('text/plain', '需求\t数量\nA\t1');

    const raw = await read(scope);
    expect(raw).toMatchObject({ seen: true, text: '需求\t数量\nA\t1', meta });
    const parsed = parseCopySelectionResult(raw);
    expect(parsed).toEqual({
      text: '需求\t数量\nA\t1',
      range: { sheetId: '17', rowFrom: 2, rowTo: 3, colFrom: 1, colTo: 4 },
    });
    const serialized = JSON.stringify(parsed);
    for (const secret of ['file-secret', 'link-secret', '<b>secret</b>', 'srcRange', 'ksDoc'])
      expect(serialized).not.toContain(secret);
    cleanup(scope);
  });

  it('没有捕获到内容时报错，不冒充空串', async () => {
    const scope = fresh();
    install(scope);
    const raw = await read(scope, 20);
    expect(raw).toMatchObject({ ok: true, seen: false });
    expect(() => parseCopySelectionResult(raw)).toThrow(/没有捕获/);
    cleanup(scope);
  });

  it('超过 64KB UTF-8 明确报错且不截断；边界内照常返回', async () => {
    const scope = fresh();
    install(scope);
    const over = '需'.repeat(Math.floor(COPY_SELECTION_MAX_BYTES / 3) + 1);
    const transfer = new FakeDataTransfer();
    transfer.setData('text/plain', over);
    const raw = await read(scope);
    expect(raw).toMatchObject({ seen: true, text: over });
    expect(() => parseCopySelectionResult(raw)).toThrow(/64/);

    const exact = { ok: true, seen: true, text: 'a'.repeat(COPY_SELECTION_MAX_BYTES), meta: '' };
    expect(parseCopySelectionResult(exact)).toEqual({
      text: 'a'.repeat(COPY_SELECTION_MAX_BYTES),
    });
    cleanup(scope);
  });

  it('清理后还原原型方法、删除临时状态，页面自己的改动不被覆盖', () => {
    const scope = fresh();
    install(scope);
    const pageSetData = () => {};
    FakeDataTransfer.prototype.setData = pageSetData;
    expect(cleanup(scope)).toEqual({ ok: true });
    expect(FakeDataTransfer.prototype.setData).toBe(pageSetData);
    expect(COPY_SELECTION_STATE_KEY in scope).toBe(false);

    FakeDataTransfer.prototype.setData = originalSetData;
    const again = fresh();
    install(again);
    expect(cleanup(again)).toEqual({ ok: true });
    expect(cleanup(again)).toEqual({ ok: false, reason: 'missing' });
  });

  it('唯一 token：并发安装被拒绝，陌生 token 读不到也清不掉', async () => {
    const scope = fresh();
    const pageOwned = { not: 'ours' };
    const occupied = fresh();
    occupied[COPY_SELECTION_STATE_KEY] = pageOwned;
    expect(install(occupied)).toEqual({ ok: false, reason: 'busy' });
    expect(FakeDataTransfer.prototype.setData).toBe(originalSetData);
    expect(occupied[COPY_SELECTION_STATE_KEY]).toBe(pageOwned);

    expect(install(scope)).toEqual({ ok: true });
    expect(install(scope)).toEqual({ ok: false, reason: 'busy' });
    await expect(read(scope, 5, OTHER_TOKEN)).resolves.toEqual({ ok: false, reason: 'lost' });
    expect(cleanup(scope, OTHER_TOKEN)).toEqual({ ok: false, reason: 'missing' });
    expect(FakeDataTransfer.prototype.setData).not.toBe(originalSetData);
    expect(cleanup(scope)).toEqual({ ok: true });
  });

  it('token 只作为字符串字面量注入', () => {
    for (const token of ['', 'short', "'; window.pwned = 1; //", 'x'.repeat(65), 'a b c d e f'])
      expect(() => pageCopySelectionInstallScript(token)).toThrow();
    expect(pageCopySelectionInstallScript(TOKEN)).toContain(JSON.stringify(TOKEN));
  });

  it('元数据缺失、坏 JSON、负数、小数与倒序范围都不返回 range', () => {
    const text = 'A\tB';
    for (const meta of [
      '',
      'not-json',
      '[]',
      JSON.stringify({ fileId: 'x' }),
      JSON.stringify({ srcRange: '' }),
      JSON.stringify({ srcRange: 'rowFrom:-1,rowTo:0,colFrom:0,colTo:0,sheetStId:1' }),
      JSON.stringify({ srcRange: 'rowFrom:1.5,rowTo:2,colFrom:0,colTo:0,sheetStId:1' }),
      JSON.stringify({ srcRange: 'rowFrom:3,rowTo:1,colFrom:0,colTo:0,sheetStId:1' }),
      JSON.stringify({ srcRange: 'rowFrom:0,rowTo:1,colFrom:4,colTo:2,sheetStId:1' }),
      JSON.stringify({ srcRange: 'rowFrom:0,rowTo:1,colFrom:0,colTo:2' }),
      JSON.stringify({ srcRange: 'sheetStId:1' }),
    ])
      expect(parseCopySelectionResult({ ok: true, seen: true, text, meta })).toEqual({ text });
  });

  it('拒绝异常读取结果', () => {
    for (const raw of [undefined, null, 'x', {}, { ok: false, reason: 'busy' }, { ok: true }])
      expect(() => parseCopySelectionResult(raw)).toThrow();
    expect(() => parseCopySelectionResult({ ok: true, seen: true, text: 1 })).toThrow();
  });
});
