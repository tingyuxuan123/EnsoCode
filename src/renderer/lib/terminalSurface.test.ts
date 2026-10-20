import { describe, expect, it } from 'vitest';
import { matchTerminalBackground } from './terminalSurface';

describe('matchTerminalBackground', () => {
  it('同一档明暗时用应用面板色,消掉终端主题底色的色差', () => {
    // Adwaita Dark #1d1d20 配应用深色面板 #1a1c24
    expect(matchTerminalBackground('#1d1d20', 'rgb(26 28 36)')).toBe('rgb(26 28 36)');
    expect(matchTerminalBackground('#ffffff', '#f7f7f8')).toBe('#f7f7f8');
  });

  it('明暗相反时保留终端配色底色,避免掉对比度', () => {
    expect(matchTerminalBackground('#1d1d20', '#ffffff')).toBe('#1d1d20');
    expect(matchTerminalBackground('#ffffff', 'rgb(26 28 36)')).toBe('#ffffff');
  });

  it('缺省或无法解析的面板色一律保留终端底色', () => {
    expect(matchTerminalBackground('#1d1d20', undefined)).toBe('#1d1d20');
    expect(matchTerminalBackground('#1d1d20', '')).toBe('#1d1d20');
    expect(matchTerminalBackground('#1d1d20', 'var(--panel)')).toBe('#1d1d20');
  });
});
