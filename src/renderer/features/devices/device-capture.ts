// Screenshots and recordings of the device a pane shows. A recording is made from the canvas the
// stream is drawn to, so it works the same for every kind of device and needs no host support.

import type { DeviceCaptureKind, DeviceInfo } from '@shared/device-host';
import { addToast } from '@/components/ui/toast';
import { useDevicesStore } from '@/stores/devices';
import { deviceBridge } from './bridge';
import { DEVICES_KEYS, devicesText } from './i18n';
import { errorMessage } from './support';

const BITS_PER_SECOND = 8_000_000;
/**
 * How often the device's picture is copied onto the canvas that is recorded. A screen that does
 * not change paints nothing, and a canvas that never paints hands `captureStream` no frames at
 * all, so a still screen would otherwise record as an empty file.
 */
const COPY_INTERVAL_MS = 100;

/** The containers a recording may come in, the one most players open first. */
const FORMATS: { mimeType: string; kind: DeviceCaptureKind }[] = [
  { mimeType: 'video/mp4;codecs=avc1.640033', kind: 'mp4' },
  { mimeType: 'video/mp4', kind: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9', kind: 'webm' },
  { mimeType: 'video/webm', kind: 'webm' },
];

/** The canvas each shown device is drawn to. */
const canvases = new Map<string, HTMLCanvasElement>();

let active: {
  deviceId: string;
  recorder: MediaRecorder;
  stream: MediaStream;
  timer: ReturnType<typeof setInterval>;
} | null = null;

export function canRecord(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    FORMATS.some((format) => MediaRecorder.isTypeSupported(format.mimeType))
  );
}

async function keep(device: DeviceInfo, kind: DeviceCaptureKind, data: ArrayBuffer): Promise<void> {
  const save = deviceBridge()?.saveCapture;
  if (!save) {
    // Without a capture channel the picture stays on screen only; say so rather than pretend.
    addToast({ type: 'warning', title: devicesText(DEVICES_KEYS.saveUnavailable) });
    return;
  }
  try {
    await save(device.name, kind, data);
    addToast({
      type: 'success',
      title: devicesText(
        kind === 'png' ? 'Screenshot saved to Downloads' : 'Recording saved to Downloads'
      ),
    });
  } catch (error) {
    addToast({ type: 'error', title: errorMessage(error) });
  }
}

export async function saveScreenshot(device: DeviceInfo, sessionId: string): Promise<void> {
  const api = deviceBridge();
  if (!api) {
    addToast({ type: 'warning', title: devicesText('The device host is not ready') });
    return;
  }
  try {
    const { png } = await api.request('devices.screenshot', { deviceId: device.id, sessionId });
    await keep(device, 'png', png);
  } catch (error) {
    addToast({ type: 'error', title: errorMessage(error) });
  }
}

export function startRecording(device: DeviceInfo): void {
  const source = canvases.get(device.id);
  const format = FORMATS.find((entry) => MediaRecorder.isTypeSupported(entry.mimeType));
  if (active || !source || !format) return;
  // The stage is what is recorded: a copy of the screen's canvas, repainted on a steady beat.
  const stage = document.createElement('canvas');
  const paint = (): void => {
    if (stage.width !== source.width || stage.height !== source.height) {
      stage.width = source.width;
      stage.height = source.height;
    }
    stage.getContext('2d')?.drawImage(source, 0, 0, stage.width, stage.height);
  };
  paint();
  const timer = setInterval(paint, COPY_INTERVAL_MS);
  const stream = stage.captureStream(Math.round(1000 / COPY_INTERVAL_MS));
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mimeType,
    videoBitsPerSecond: BITS_PER_SECOND,
  });
  const parts: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) parts.push(event.data);
  };
  recorder.onstop = () => {
    clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
    if (parts.length === 0) {
      addToast({ type: 'warning', title: devicesText(DEVICES_KEYS.emptyRecording) });
      return;
    }
    void new Blob(parts)
      .arrayBuffer()
      .then((data) => keep(device, format.kind, data))
      .catch((error: unknown) => addToast({ type: 'error', title: errorMessage(error) }));
  };
  recorder.onerror = () => stopRecording();
  recorder.start(1_000);
  active = { deviceId: device.id, recorder, stream, timer };
  useDevicesStore.setState({ recording: { deviceId: device.id, since: Date.now() } });
}

/** Ends the recording and saves what it holds. */
export function stopRecording(): void {
  const current = active;
  if (!current) return;
  active = null;
  useDevicesStore.setState({ recording: null });
  if (current.recorder.state !== 'inactive') current.recorder.stop();
}

/**
 * The canvas a device's screen is drawn to, while it is on the page. A recording of it ends when
 * the canvas leaves, as when the pane shows another device or session.
 */
export function shareCanvas(deviceId: string, canvas: HTMLCanvasElement): () => void {
  canvases.set(deviceId, canvas);
  return () => {
    if (canvases.get(deviceId) !== canvas) return;
    canvases.delete(deviceId);
    if (active?.deviceId === deviceId) stopRecording();
  };
}
