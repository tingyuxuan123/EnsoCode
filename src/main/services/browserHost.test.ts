import { renderSnapshot } from '@shared/browser/snapshot';
import { describe, expect, it } from 'vitest';
import {
  dragInputEvents,
  explicitTabOutcome,
  hiddenTabCdpCommands,
  interpretPageAction,
  isBrowserPartition,
  pageScreenshotCdpParams,
  partitionName,
  shownTabCdpCommands,
} from './browserHost';

describe('partitionName', () => {
  it('dev 与打包版分罐，且都是 persist', () => {
    expect(partitionName(true)).toBe('persist:enso-browser');
    expect(partitionName(false)).toBe('persist:enso-dev-browser');
    expect(isBrowserPartition(partitionName(true))).toBe(true);
    expect(isBrowserPartition(partitionName(false))).toBe(true);
  });
  it('clear 只认我们自己的罐', () => {
    expect(isBrowserPartition('persist:enso')).toBe(false);
    expect(isBrowserPartition('enso-browser')).toBe(false);
    expect(isBrowserPartition('')).toBe(false);
  });
});

describe('pageScreenshotCdpParams', () => {
  const clip = { x: 0, y: 0, width: 1280, height: 800, scale: 1 };

  it('默认 beyond viewport，给被挡住的无头 tab 离屏出帧', () => {
    expect(pageScreenshotCdpParams(clip)).toEqual({
      format: 'png',
      captureBeyondViewport: true,
      clip,
    });
  });

  it('冻帧必须拍当前合成视口，否则 position:fixed 顶栏会丢', () => {
    expect(pageScreenshotCdpParams(undefined, { captureBeyondViewport: false })).toEqual({
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    });
  });
});

describe('hidden tab rendering', () => {
  it('emulates focus so background tabs keep rAF without being the visible Chrome tab', () => {
    expect(hiddenTabCdpCommands()).toEqual(
      expect.arrayContaining([
        {
          method: 'Emulation.setFocusEmulationEnabled',
          params: { enabled: true },
        },
        expect.objectContaining({ method: 'Emulation.setDeviceMetricsOverride' }),
      ])
    );
    expect(shownTabCdpCommands()).toEqual(
      expect.arrayContaining([
        { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: false } },
        { method: 'Emulation.clearDeviceMetricsOverride', params: {} },
      ])
    );
  });
});

describe('interpretPageAction', () => {
  it('keeps covered distinct from stale so the model re-snapshots instead of retrying a dead ref', () => {
    expect(interpretPageAction('e1', 'ok')).toBeNull();
    expect(interpretPageAction('e1', 'covered')?.message).toMatch(/covered|hittable/);
    expect(interpretPageAction('e1', 'stale')?.message).toMatch(/stale/);
    expect(interpretPageAction('e1', 'not-editable')?.message).toMatch(/not editable/);
  });

  it('ref 失效时把当前页可交互元素一起给出，模型不必再猜一轮', () => {
    const snapshot = renderSnapshot({ url: 'https://example.com', title: 'Example' }, [
      { role: 'button', name: 'Sign in', depth: 0, ref: 'e9' },
    ]);
    const message = interpretPageAction('e1', 'stale', snapshot)?.message ?? '';
    expect(message).toContain('button "Sign in" [e9]');
    expect(message).toMatch(/browser_snapshot/);
  });
});

describe('explicitTabOutcome', () => {
  it('还有效的 tabId 直接使用', () => {
    expect(explicitTabOutcome('click', true, true)).toBe('use');
    expect(explicitTabOutcome('snapshot', true, false)).toBe('use');
  });

  it('只读 op 遇到失效 tabId 回落到会话当前 tab', () => {
    for (const op of ['snapshot', 'read_text', 'read_elements', 'screenshot', 'wait'] as const)
      expect(explicitTabOutcome(op, false, true)).toBe('fallback');
  });

  it('写 op 或没有可回落 tab 时拒绝，不猜页面', () => {
    for (const op of ['click', 'type', 'fill', 'navigate', 'press_key', 'scroll'] as const)
      expect(explicitTabOutcome(op, false, true)).toBe('reject');
    expect(explicitTabOutcome('snapshot', false, false)).toBe('reject');
  });
});

describe('dragInputEvents', () => {
  it('emits a trusted mouseDown-move-mouseUp path so HTML5 drag can start', () => {
    const events = dragInputEvents({ x: 10, y: 20 }, { x: 110, y: 80 });
    expect(events[0]).toMatchObject({ type: 'mouseDown', x: 10, y: 20, button: 'left' });
    expect(events.at(-1)).toMatchObject({ type: 'mouseUp', x: 110, y: 80, button: 'left' });
    const moves = events.filter((event) => event.type === 'mouseMove');
    expect(moves.length).toBeGreaterThanOrEqual(8);
    expect(moves[0]?.button).toBe('left');
    expect(
      events.some((event) => event.type === 'mouseMove' && event.x === 10 && event.y === 20)
    ).toBe(false);
    const firstMove = moves[0];
    expect(firstMove).toBeDefined();
    const nudge = Math.hypot((firstMove?.x ?? 0) - 10, (firstMove?.y ?? 0) - 20);
    expect(nudge).toBeGreaterThanOrEqual(7);
  });
});
