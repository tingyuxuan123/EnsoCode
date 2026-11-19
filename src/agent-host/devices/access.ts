// The mobile devices the user always lets agents use, kept in `state/device-access.json` under the
// app's data folder. Main reads it; the agent worker never does, and no tool can write it.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface DeviceAccessFile {
  version: 1;
  /** Device ids: `ios-sim:<udid>`, `ios:<udid>`, `android:<serial>` or `avd:<name>`. */
  allowed: string[];
}

const DEVICE_ID = /^(ios-sim|ios|android|avd):[\w.:\-@]+$/;
const MAX_DEVICES = 500;
const MAX_ID = 256;

/** A device id a device host could list; anything else is dropped rather than stored. */
export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID && DEVICE_ID.test(value);
}

export function parseDeviceAccessFile(data: unknown): DeviceAccessFile | string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'the file must be an object';
  const allowed = (data as Record<string, unknown>).allowed;
  if (!Array.isArray(allowed)) return '"allowed" must be a list';
  return {
    version: 1,
    allowed: [...new Set(allowed.filter(isDeviceId))].slice(0, MAX_DEVICES),
  };
}

export type DeviceAccessLog = (message: string) => void;

/**
 * The devices the user chose to keep allowed across sessions. A read or a write that fails leaves
 * the store as it was: a broken file means no device is always allowed, never every device.
 */
export class DeviceAccessStore {
  private readonly file: string;
  private allowed = new Set<string>();

  /** `file` is the whole path, such as `<userData>/state/device-access.json`. */
  constructor(
    file: string,
    private readonly log: DeviceAccessLog = () => {}
  ) {
    this.file = file;
    this.load();
  }

  has(deviceId: string): boolean {
    return this.allowed.has(deviceId);
  }

  add(deviceId: string): void {
    if (!isDeviceId(deviceId)) throw new Error('Invalid device id.');
    if (this.allowed.has(deviceId)) return;
    if (this.allowed.size >= MAX_DEVICES) throw new Error('Too many always-allowed devices.');
    this.save(new Set(this.allowed).add(deviceId));
  }

  remove(deviceId: string): void {
    if (!isDeviceId(deviceId)) throw new Error('Invalid device id.');
    if (!this.allowed.has(deviceId)) return;
    const next = new Set(this.allowed);
    next.delete(deviceId);
    this.save(next);
  }

  list(): string[] {
    return [...this.allowed];
  }

  private load(): void {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return;
    }
    try {
      const parsed = parseDeviceAccessFile(JSON.parse(text));
      if (typeof parsed === 'string') {
        this.log(`Ignored device-access.json: ${parsed}`);
        return;
      }
      this.allowed = new Set(parsed.allowed);
    } catch {
      this.log('Ignored an unreadable device-access.json');
    }
  }

  private save(next: Set<string>): void {
    const body = JSON.stringify({ version: 1, allowed: [...next] });
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, body);
      renameSync(temporary, this.file);
      this.allowed = next;
    } catch (error) {
      this.log(`Cannot save device-access.json: ${String(error)}`);
      throw error;
    }
  }
}
