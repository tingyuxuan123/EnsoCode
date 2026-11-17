import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = { current: undefined as unknown };

vi.mock('../ipc/settings', () => ({
  readSettings: () => settings.current,
}));

import {
  isSessionMuted,
  resetSessionMuteOverrides,
  setSessionMuteOverride,
} from './sessionMuteGate';

const persisted = (conversations: Record<string, Record<string, unknown>>) => ({
  'enso-conversations': { state: { conversations } },
});

describe('sessionMuteGate', () => {
  beforeEach(() => {
    settings.current = undefined;
    resetSessionMuteOverrides();
  });

  it('没有覆盖时读持久化', () => {
    settings.current = persisted({ a: { muted: true } });
    expect(isSessionMuted('a')).toBe(true);
    expect(isSessionMuted('a::cw-x')).toBe(true);
    expect(isSessionMuted('b')).toBe(false);
  });

  it('覆盖优先于磁盘：静音立即生效，取消静音也立即恢复', () => {
    settings.current = persisted({ a: { muted: true } });
    setSessionMuteOverride('a', false);
    expect(isSessionMuted('a')).toBe(false);
    setSessionMuteOverride('a::cw-x', true);
    expect(isSessionMuted('a')).toBe(true);
    expect(isSessionMuted('b')).toBe(false);
  });

  it('覆盖落在权威根 id 上，不用子会话 id 里不可信的 :: 前缀', () => {
    settings.current = persisted({
      victim: {},
      real: {},
      'victim::cw-a': { parentId: 'real' },
    });
    setSessionMuteOverride('victim::cw-a', true);
    expect(isSessionMuted('real')).toBe(true);
    expect(isSessionMuted('victim')).toBe(false);
  });

  it('落盘值追上覆盖后覆盖失效，之后真正的持久化值说了算', () => {
    settings.current = persisted({ a: { muted: false } });
    setSessionMuteOverride('a', true);
    expect(isSessionMuted('a')).toBe(true);
    // 落盘追上本次覆盖
    settings.current = persisted({ a: { muted: true } });
    expect(isSessionMuted('a')).toBe(true);
    // 另一个入口（多窗口 / 归档 / 重启后编辑）真正改回 false：覆盖不能永久压住它
    settings.current = persisted({ a: { muted: false } });
    expect(isSessionMuted('a')).toBe(false);
  });

  it('取消静音的覆盖同样让位给后续落盘的真值', () => {
    settings.current = persisted({ a: { muted: true } });
    setSessionMuteOverride('a', false);
    expect(isSessionMuted('a')).toBe(false);
    settings.current = persisted({ a: { muted: false } });
    expect(isSessionMuted('a')).toBe(false);
    settings.current = persisted({ a: { muted: true } });
    expect(isSessionMuted('a')).toBe(true);
  });

  it('空 id 不建覆盖', () => {
    setSessionMuteOverride('', true);
    settings.current = persisted({});
    expect(isSessionMuted('')).toBe(false);
  });

  it('覆盖表有上限：任意 id 反复灌入也不能无界增长', () => {
    settings.current = persisted({});
    for (let i = 0; i < 2000; i++) setSessionMuteOverride(`spam-${i}`, true);
    expect(isSessionMuted('spam-1999')).toBe(true);
    expect(isSessionMuted('spam-0')).toBe(false);
  });
});
