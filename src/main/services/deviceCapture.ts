// What the devices pane saves when the user takes a screenshot or ends a recording: one file in
// Downloads, named after the device. The renderer only ever gets the path back.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DeviceCaptureKind } from '@shared/device-host';
import { safeName } from '@shared/file-name';

/** A 60 s recording at 8 Mbit/s is under 64 MiB; anything far beyond that is not a screen capture. */
export const MAX_DEVICE_CAPTURE_BYTES = 128 * 1024 * 1024;

const EXTENSION: Record<DeviceCaptureKind, string> = { png: 'png', webm: 'webm', mp4: 'mp4' };

const MAX_DEVICE_NAME_CHARS = 200;

export interface DeviceCaptureRequest {
  device: string;
  kind: DeviceCaptureKind;
  data: Uint8Array;
}

/**
 * The renderer's capture as the service takes it. The argument is untrusted: anything that is not
 * a named png or recording of real bytes is refused before Main writes a file.
 */
export function parseDeviceCapture(value: unknown): DeviceCaptureRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const { device, kind, data } = value as Record<string, unknown>;
  if (typeof device !== 'string' || device.trim().length === 0) return null;
  if (device.length > MAX_DEVICE_NAME_CHARS) return null;
  if (typeof kind !== 'string' || !Object.hasOwn(EXTENSION, kind)) return null;
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : ArrayBuffer.isView(data) && data instanceof Uint8Array
        ? data
        : null;
  if (!bytes) return null;
  return { device, kind: kind as DeviceCaptureKind, data: bytes };
}

function stamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function bytesOf(data: Uint8Array | ArrayBuffer): Uint8Array {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  if (!(bytes instanceof Uint8Array)) throw new Error('capture data is not bytes');
  if (bytes.byteLength === 0) throw new Error('capture is empty');
  if (bytes.byteLength > MAX_DEVICE_CAPTURE_BYTES) throw new Error('capture is too large');
  return bytes;
}

/**
 * Writes one capture into `directory` and answers its path. A second capture in the same second
 * gets a numbered name instead of overwriting the first.
 */
export async function saveDeviceCapture(options: {
  directory: string;
  device: string;
  kind: DeviceCaptureKind;
  data: Uint8Array | ArrayBuffer;
  now?: Date;
}): Promise<string> {
  const extension = EXTENSION[options.kind];
  if (!extension) throw new Error('unknown capture kind');
  const bytes = bytesOf(options.data);
  // Spaces become dashes so the device name and the time read as one file name.
  const device = safeName(options.device, 'device').replace(/\s+/g, '-');
  const base = `${device}-${stamp(options.now ?? new Date())}`;
  await mkdir(options.directory, { recursive: true });
  for (let attempt = 1; attempt <= 100; attempt++) {
    const name = attempt === 1 ? `${base}.${extension}` : `${base}-${attempt}.${extension}`;
    const target = path.join(options.directory, name);
    try {
      await writeFile(target, bytes, { flag: 'wx' });
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('too many captures in one second');
}
