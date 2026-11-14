import { describe, expect, it } from 'vitest';
import { applyPluginAction, type PluginRecord, recordPluginCrash } from './lifecycle';

const grant = {
  permissions: [],
  fsRead: [],
  fsWrite: [],
  netDomains: [],
  browserDomains: [],
  mcp: [],
  mcpTools: [],
  renderer: false,
  env: [],
  interop: [],
  intercepts: [],
  resident: false,
  styles: false,
};
const record = (patch: Partial<PluginRecord> = {}): PluginRecord => ({
  id: 'example.demo',
  version: '1',
  dir: 'one',
  state: 'disabled',
  grant,
  installedAt: 1,
  ...patch,
});
const ok = (r: ReturnType<typeof applyPluginAction>) => {
  if ('error' in r) throw new Error(r.error);
  return r;
};
describe('插件生命周期', () => {
  it('启停与崩溃仅改变状态，停用状态不能崩溃', () => {
    expect(applyPluginAction(record(), { type: 'crash' })).toHaveProperty('error');
    const enabled = ok(applyPluginAction(record(), { type: 'enable' }));
    const crashed = ok(applyPluginAction(enabled, { type: 'crash' }));
    expect(crashed.state).toBe('crashed');
    expect(ok(applyPluginAction(crashed, { type: 'enable' })).state).toBe('enabled');
    expect(ok(applyPluginAction(enabled, { type: 'disable' })).state).toBe('disabled');
  });
  it('增权更新 pending，批准切换，拒绝保留旧版本，普通更新清旧 pending', () => {
    const old = record({ state: 'enabled' });
    const pending = ok(
      applyPluginAction(old, { type: 'update', version: '2', dir: 'two', grant, expands: true })
    );
    expect(pending).toMatchObject({
      version: '1',
      dir: 'one',
      state: 'enabled',
      pending: { version: '2' },
    });
    expect(ok(applyPluginAction(pending, { type: 'approve-pending' }))).toMatchObject({
      version: '2',
      dir: 'two',
      state: 'enabled',
    });
    expect(ok(applyPluginAction(pending, { type: 'reject-pending' }))).toEqual(old);
    expect(
      ok(
        applyPluginAction(pending, {
          type: 'update',
          version: '3',
          dir: 'three',
          grant,
          expands: false,
        })
      ).pending
    ).toBeUndefined();
    expect(applyPluginAction(old, { type: 'approve-pending' })).toHaveProperty('error');
  });
  it('崩溃计数只包含开窗口内有效过去时间，恰好边界与未来不计', () => {
    const history = [0, 1, 599_999, 600_001, Number.NaN, -1];
    const result = recordPluginCrash(history, 600_000);
    expect(result.timestamps).toEqual([1, 599_999, 600_000]);
    expect(result.blocked).toBe(true);
    expect(history).toHaveLength(6);
    expect(recordPluginCrash([0, 1], 600_001).blocked).toBe(false);
  });
  it('窗口计数达到第三次立即阻断，保留数量有界且坏配置报错', () => {
    expect(recordPluginCrash([1], 2).blocked).toBe(false);
    expect(recordPluginCrash([1, 2], 3).blocked).toBe(true);
    expect(recordPluginCrash(Array(10_000).fill(1), 2).timestamps).toHaveLength(3);
    for (const args of [
      [Number.NaN, 60_000, 3],
      [-1, 60_000, 3],
      [1, 0, 3],
      [1, 60_000, 0],
    ])
      expect(() => recordPluginCrash([], args[0], args[1], args[2])).toThrow();
  });
});
