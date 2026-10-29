import { describe, expect, it } from 'vitest';
import { parseCompactReserveTokens, parseCompactReserveTokensDraft } from './compactionSettings';

describe('压缩预留 token 输入', () => {
  it.each([4096, 16384, 20000, 65536, null])('接受范围内整数或清空：%s', (value) => {
    expect(parseCompactReserveTokens(value)).toBe(value);
  });
  it.each([undefined, '16384', 0, -1, 4095, 65537, 4096.5, NaN, Infinity, {}, []])(
    '拒绝脏 IPC 输入：%s',
    (value) => expect(parseCompactReserveTokens(value)).toBeUndefined()
  );
  it.each([
    ['', null],
    ['   ', null],
    [' 20000 ', 20000],
    ['04096', 4096],
    ['65536', 65536],
  ])('界面输入 %j 归一化为 %s', (draft, value) => {
    expect(parseCompactReserveTokensDraft(draft)).toBe(value);
  });
  it.each(['1e4', '+4096', '-4096', '4096.0', '4,096', '4096x', '65537', '0x1000'])(
    '界面拒绝非范围内十进制整数：%s',
    (draft) => expect(parseCompactReserveTokensDraft(draft)).toBeUndefined()
  );
});
