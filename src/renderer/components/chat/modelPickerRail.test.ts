import { describe, expect, it } from 'vitest';
import { pickRailKey, providerRailKey, showsPickerRail, VIRTUAL_RAIL_KEY } from './modelPickerRail';

describe('modelPickerRail', () => {
  it('条目 id 与 provider id 一一对应，虚拟模型单独一个键', () => {
    expect(providerRailKey('api')).toBe('provider:api');
    expect(VIRTUAL_RAIL_KEY).toBe('virtual');
    expect(VIRTUAL_RAIL_KEY).not.toBe(providerRailKey('virtual'));
  });

  it('打开时停在当前选中模型所属的条目上', () => {
    const keys = [VIRTUAL_RAIL_KEY, providerRailKey('api'), providerRailKey('gateway')];
    expect(pickRailKey(keys, 'gateway')).toBe(providerRailKey('gateway'));
    expect(pickRailKey(keys, 'virtual')).toBe(VIRTUAL_RAIL_KEY);
  });

  it('当前条目已不在列表里（账号被删、设置页未选模型）时退回第一项，不落在空列表上', () => {
    const keys = [providerRailKey('api'), providerRailKey('gateway')];
    expect(pickRailKey(keys, 'removed')).toBe(providerRailKey('api'));
    expect(pickRailKey(keys, '')).toBe(providerRailKey('api'));
  });

  it('没有条目时不返回键', () => {
    expect(pickRailKey([], 'api')).toBeUndefined();
  });

  it('只有一个条目时不画条目轨——没有可切换的来源，占一列只会让人以为还能切', () => {
    expect(showsPickerRail([])).toBe(false);
    expect(showsPickerRail([providerRailKey('api')])).toBe(false);
    expect(showsPickerRail([providerRailKey('api'), VIRTUAL_RAIL_KEY])).toBe(true);
  });
});
