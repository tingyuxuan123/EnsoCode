import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  windows: vi.fn(),
  skyAvailable: () => true,
  appIdentity: vi.fn(),
  frontPid: () => 99,
  activateWindow: vi.fn(),
  deactivateWindow: vi.fn(),
  setFrontProcess: vi.fn(),
  axEnable: vi.fn(async () => ({ changed: [] })),
  axRestoreEnable: vi.fn(async () => {}),
  axElementAt: vi.fn(async () => null),
  axSnapshot: vi.fn(),
  axNode: vi.fn(),
  axPerform: vi.fn(),
  raise: vi.fn(),
  skyClick: vi.fn(async () => {
    throw new Error('SKY_CLICK_UNAVAILABLE');
  }),
  skyPointer: vi.fn(async () => {}),
  skyScroll: vi.fn(async () => {}),
  pidTypeText: vi.fn(async () => {}),
  pidKeyChord: vi.fn(async () => {}),
  inputMethodActive: () => false,
  click: vi.fn(async () => {}),
  move: vi.fn(async () => {}),
  drag: vi.fn(async () => {}),
  scroll: vi.fn(async () => {}),
  typeText: vi.fn(async () => {}),
  keyChord: vi.fn(async () => {}),
}));
vi.mock('electron', () => ({
  systemPreferences: { isTrustedAccessibilityClient: () => true },
  clipboard: {},
  desktopCapturer: {},
  screen: {},
}));
vi.mock('./macosNative', () => ({ loadMacosNative: async () => native }));
vi.mock('./occupancyHid', () => ({ hidSecondsSinceLastEvent: () => 10 }));

import type { InputGuard } from './backend';
import { MacosDesktopBackend } from './macos';

describe('macOS background input fails closed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.windows.mockResolvedValue([
      { id: '12', pid: 42, app: 'Target', x: 0, y: 0, width: 200, height: 100 },
    ]);
    native.appIdentity.mockReturnValue({
      bundleId: 'com.example.target',
      name: 'Target',
      path: '/Applications/Target.app',
    });
  });

  it('SkyLight failure never falls back to the global mouse', async () => {
    native.skyPointer.mockRejectedValueOnce(new Error('SKY_CLICK_UNAVAILABLE'));
    const backend = new MacosDesktopBackend();
    await expect(backend.click('12', 20, 20)).rejects.toThrow();
    expect(native.click).not.toHaveBeenCalled();
    expect(native.move).not.toHaveBeenCalled();
  });

  it('all background input methods avoid global mouse/keyboard APIs', async () => {
    const backend = new MacosDesktopBackend();
    await backend.click('12', 20, 20);
    await backend.drag('12', [
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ]);
    await backend.scroll('12', 20, 20, 0, -200);
    await backend.typeText('12', 'hello');
    await backend.keyChord('12', ['Enter']);
    expect(native.skyPointer).toHaveBeenCalledTimes(2);
    expect(native.skyScroll).toHaveBeenCalledOnce();
    expect(native.pidTypeText).toHaveBeenCalledOnce();
    expect(native.pidKeyChord).toHaveBeenCalledOnce();
    for (const fn of [
      native.click,
      native.move,
      native.drag,
      native.scroll,
      native.typeText,
      native.keyChord,
    ])
      expect(fn).not.toHaveBeenCalled();
  });

  it('a window without a pid is rejected without global delivery', async () => {
    native.windows.mockResolvedValue([{ id: '12', app: 'Target' }]);
    await expect(new MacosDesktopBackend().click('12', 20, 20)).rejects.toThrow();
    expect(native.click).not.toHaveBeenCalled();
  });

  it('window process replacement during synthetic-focus settling refuses input', async () => {
    native.activateWindow.mockImplementationOnce(() => {
      native.windows.mockResolvedValue([{ id: '12', pid: 66, app: 'Other' }]);
    });
    await expect(new MacosDesktopBackend().click('12', 20, 20)).rejects.toThrow(/changed/);
    expect(native.skyPointer).not.toHaveBeenCalled();
    expect(native.click).not.toHaveBeenCalled();
  });

  it.each(['resize', 'replace'] as const)(
    'cleanup after %s only releases the original process',
    async (change) => {
      const events: string[] = [];
      native.pidKeyChord.mockImplementationOnce(async (...args: unknown[]) => {
        const guard = args[2] as InputGuard;
        await guard.check();
        events.push('modifier-down', 'key-down');
        native.windows.mockResolvedValue([
          { id: '13', pid: 42, x: 10, y: 20, width: 400, height: 300 },
        ]);
        if (change === 'replace')
          native.appIdentity.mockReturnValue({ bundleId: 'other', path: '/Other.app' });
        try {
          await guard.check();
        } finally {
          try {
            await guard.check(true);
            events.push('key-up', 'modifier-up');
          } catch {
            /* replaced processes must not receive cleanup */
          }
        }
      });
      await expect(new MacosDesktopBackend().keyChord('12', ['cmd', 'a'])).rejects.toThrow(
        /changed/
      );
      expect(events).toEqual(
        change === 'resize'
          ? ['modifier-down', 'key-down', 'key-up', 'modifier-up']
          : ['modifier-down', 'key-down']
      );
      expect(native.deactivateWindow).toHaveBeenCalledTimes(change === 'resize' ? 1 : 0);
    }
  );

  it('geometry changes after mouse-down still allow mouse-up and focus release', async () => {
    const events: string[] = [];
    native.skyPointer.mockImplementationOnce(async (...args: unknown[]) => {
      const { guard } = args[0] as { guard: InputGuard };
      await guard.check();
      events.push('mouse-down');
      native.windows.mockResolvedValue([
        { id: '12', pid: 42, x: 20, y: 30, width: 500, height: 400 },
      ]);
      try {
        await guard.check();
      } finally {
        await guard.check(true);
        events.push('mouse-up');
      }
    });
    await expect(new MacosDesktopBackend().click('12', 20, 20)).rejects.toThrow(/changed/);
    expect(events).toEqual(['mouse-down', 'mouse-up']);
    expect(native.deactivateWindow).toHaveBeenCalledOnce();
  });

  it('one nested typing check shares a single window and identity snapshot', async () => {
    const snapshots: unknown[] = [];
    const outer: InputGuard = {
      check: async (_cleanup, snapshot) => {
        if (snapshot) snapshots.push(snapshot);
      },
    };
    native.pidTypeText.mockImplementationOnce(async (...args: unknown[]) => {
      const { guard } = args[2] as { guard: InputGuard };
      const beforeWindows = native.windows.mock.calls.length;
      const beforeIdentity = native.appIdentity.mock.calls.length;
      await guard.check();
      expect(native.windows.mock.calls.length - beforeWindows).toBe(1);
      expect(native.appIdentity.mock.calls.length - beforeIdentity).toBe(1);
    });
    await new MacosDesktopBackend().typeText('12', 'x', { guard: outer });
    expect(snapshots).toContainEqual(
      expect.objectContaining({ pid: 42, windowId: '12', path: '/Applications/Target.app' })
    );
  });

  it.each([false, true])(
    'unsupported foreground AXPress raises and confirms the exact window (fails: %s)',
    async (fails) => {
      const backend = new MacosDesktopBackend();
      const node = {
        ref: 'native-handle',
        role: 'button',
        actions: ['press'],
        pid: 42,
        windowId: 12,
        bounds: { x: 10, y: 10, width: 40, height: 20 },
      };
      native.axSnapshot.mockResolvedValue([node]);
      native.axNode.mockResolvedValue(node);
      native.axPerform.mockRejectedValueOnce(new Error('AX action failed (-25206)'));
      native.raise.mockImplementationOnce(async () => {
        if (!fails)
          native.windows.mockResolvedValue([
            {
              id: '12',
              pid: 42,
              app: 'Target',
              focused: true,
              x: 0,
              y: 0,
              width: 200,
              height: 100,
            },
          ]);
      });
      const [element] = await backend.axSnapshot('12');
      const pending = backend.axClick(element.ref, { delivery: 'foreground' });
      if (fails) await expect(pending).rejects.toThrow(/brought to the front/);
      else await pending;
      expect(native.click).toHaveBeenCalledTimes(fails ? 0 : 1);
      if (!fails)
        expect(native.click).toHaveBeenCalledWith(
          30,
          20,
          expect.objectContaining({ delivery: 'foreground' })
        );
    }
  );
});
