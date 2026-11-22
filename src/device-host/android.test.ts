import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootEmulator } from './android';
import { listAndroid } from './discovery';

const { execFile, spawn } = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile, spawn }));
vi.mock('node:timers/promises', () => ({
  setTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}));

const tools = { adb: 'adb', emulator: 'emulator', xcrun: null };
const registry = (...rows: string[]) => `List of devices attached\n${rows.join('\n')}\n`;

function commands(answer: (args: string[]) => string | Error) {
  execFile.mockImplementation((_file, args, _options, done) => {
    const output = answer(args);
    if (output instanceof Error) done(output, '', '');
    else done(null, output, '');
  });
}

describe('Android emulator discovery', () => {
  it('does not list a running but unauthorized AVD again as shut down', async () => {
    commands((args) => {
      if (args[0] === 'devices')
        return registry('emulator-5554 unauthorized', 'usb-id unauthorized');
      if (args[0] === '-list-avds') return 'Eaves_Members_Test\nPixel_10_Pro\n';
      if (args.join(' ') === '-s emulator-5554 emu avd name') return 'Eaves_Members_Test\r\nOK\r\n';
      return new Error('not available');
    });

    const devices = await listAndroid(tools, {});
    expect(devices.map(({ id }) => id)).toEqual([
      'android:emulator-5554',
      'android:usb-id',
      'avd:Pixel_10_Pro',
    ]);
    expect(devices[0]).toMatchObject({
      name: 'Eaves Members Test',
      state: 'unavailable',
      problems: ['usb-debugging-unauthorized'],
    });
  });
});

describe('headless Android boot', () => {
  let child: EventEmitter & { unref: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    child = Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() });
    spawn.mockImplementation(() => child);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('waits for the requested AVD, not the first new serial to finish booting', async () => {
    let listings = 0;
    commands((args) => {
      if (args[0] === 'devices') {
        if (++listings === 1) return registry();
        return registry('emulator-5554 device', 'emulator-5556 device');
      }
      if (args[2] === 'emu') return `${args[1] === 'emulator-5556' ? 'Eaves' : 'Pixel'}\nOK\n`;
      return '1\n';
    });

    const pending = bootEmulator('emulator', 'adb', 'Eaves', {});
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toBe('emulator-5556');
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('fails early with authorization guidance and stops the emulator it launched', async () => {
    let listings = 0;
    commands((args) => {
      if (args[0] === 'devices') {
        return ++listings === 1 ? registry() : registry('emulator-5554 unauthorized');
      }
      return 'Eaves\nOK\n';
    });

    let failure: unknown;
    void bootEmulator('emulator', 'adb', 'Eaves', {}).catch((error) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/ADB.*authoriz.*Android Studio/i);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('reports an emulator that exits instead of waiting for the full boot deadline', async () => {
    commands(() => registry());
    let failure: unknown;
    void bootEmulator('emulator', 'adb', 'Eaves', {}).catch((error) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(0);
    child.emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/exited.*1/i);
    expect(child.kill).not.toHaveBeenCalled();
  });
});
