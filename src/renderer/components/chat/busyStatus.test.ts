import { describe, expect, it } from 'vitest';
import { busyPhaseFor, formatElapsed } from './busyStatus';

describe('busyPhaseFor', () => {
  it('distinguishes live thinking, writing and tool execution', () => {
    expect(busyPhaseFor({ kind: 'thinking', streaming: true })).toBe('thinking');
    expect(busyPhaseFor({ kind: 'text', streaming: true })).toBe('writing');
    expect(busyPhaseFor({ kind: 'tool', state: 'running' })).toBe('tool');
    expect(busyPhaseFor({ kind: 'tool', state: 'reviewing' })).toBe('tool');
  });

  it('falls back for completed rows and compacted work logs', () => {
    expect(busyPhaseFor({ kind: 'thinking', streaming: false })).toBe('working');
    expect(busyPhaseFor({ kind: 'text', streaming: false })).toBe('working');
    expect(busyPhaseFor({ kind: 'tool', state: 'ok' })).toBe('working');
    expect(busyPhaseFor({ kind: 'tool-group', running: true })).toBe('tool');
    expect(busyPhaseFor(undefined)).toBe('working');
  });
});

describe('formatElapsed', () => {
  it('formats English durations without changing the existing rounding', () => {
    expect(formatElapsed(0, 'en')).toBe('0s');
    expect(formatElapsed(1_499, 'en')).toBe('1s');
    expect(formatElapsed(1_500, 'en')).toBe('2s');
    expect(formatElapsed(65_000, 'en')).toBe('1m5s');
  });

  it('uses readable Chinese units and spacing', () => {
    expect(formatElapsed(0, 'zh')).toBe('0 秒');
    expect(formatElapsed(12_000, 'zh')).toBe('12 秒');
    expect(formatElapsed(65_000, 'zh')).toBe('1 分 5 秒');
  });

  it('never renders a negative duration', () => {
    expect(formatElapsed(-8_000, 'en')).toBe('0s');
    expect(formatElapsed(Number.NaN, 'zh')).toBe('0 秒');
  });
});
