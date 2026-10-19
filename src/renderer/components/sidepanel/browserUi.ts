import { assertAllowedUrl } from '@shared/browser/urlPolicy';
import type { BrowserDevice, BrowserResult } from '@shared/types/browser';

/** 设备预览时 guest 占位框尺寸：Main 按同一框计算 fit，scale 与这里一致。 */
export function browserDeviceFrame(
  device: BrowserDevice | undefined,
  stage: { width: number; height: number },
  padding: number
): { width: number; height: number; scale: number } | null {
  if (!device?.enabled) return null;
  const width = device.width ?? 1280;
  const height = device.height ?? 800;
  const availableWidth = stage.width - padding * 2;
  const availableHeight = stage.height - padding * 2;
  if (availableWidth < 1 || availableHeight < 1 || width < 1 || height < 1) return null;
  const fit = Math.min(availableWidth / width, availableHeight / height, 1);
  const scale = Math.min(device.scale ?? fit, fit);
  const frameWidth = Math.floor(width * scale);
  const frameHeight = Math.floor(height * scale);
  if (frameWidth < 1 || frameHeight < 1) return null;
  return { width: frameWidth, height: frameHeight, scale };
}

export function resolveBrowserAddress(raw: string): BrowserResult<string> {
  const input = raw.trim();
  if (
    !input ||
    Array.from(input).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    input.startsWith('//')
  ) {
    return { ok: false, error: 'Enter a valid web address or search term.' };
  }
  if (/^file:/i.test(input)) {
    try {
      const url = new URL(input);
      if (url.protocol !== 'file:' || url.username || url.password || /%00/i.test(input)) {
        throw new Error();
      }
      return { ok: true, result: raw };
    } catch {
      return {
        ok: false,
        error:
          'Enter a valid file URL without credentials or NUL characters. Enso checks workspace access.',
      };
    }
  }
  const explicitHttp = /^https?:/i.test(input);
  const hostPort =
    /^(?:localhost|[\p{L}\p{N}.-]+\.[\p{L}\p{N}.-]+|\[[a-f\d:]+\]):\d+(?:[/?#]|$)/iu.test(input);
  if (!explicitHttp && !hostPort && /^[a-z][a-z\d+.-]*:/i.test(input)) {
    return {
      ok: false,
      error:
        'Only HTTP, HTTPS, or workspace file URLs can be opened here. Workspace files are validated by Enso.',
    };
  }
  const host = input.split(/[/?#]/, 1)[0] ?? '';
  const looksLikeHost =
    !/\s/.test(input) &&
    (hostPort ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      /^\[[a-f\d:]+\]$/i.test(host) ||
      /^[\p{L}\p{N}.-]+\.[\p{L}\p{N}-]+$/u.test(host));
  if (explicitHttp || looksLikeHost) {
    try {
      return {
        ok: true,
        result: assertAllowedUrl(
          !explicitHttp && /^\[::1\](?::|\/|$)/i.test(input) ? `http://${input}` : input
        ).href,
      };
    } catch {
      return { ok: false, error: 'Enter a valid web address without embedded credentials.' };
    }
  }
  return { ok: true, result: `https://www.google.com/search?q=${encodeURIComponent(input)}` };
}

export function formatBrowserBytes(bytes: number): string {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index =
    value >= 1 ? Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1) : 0;
  return `${Number((value / 1024 ** index).toFixed(index === 0 ? 0 : 1))} ${units[index]}`;
}

export function browserDownloadProgress(received: number, total: number): number | null {
  if (!Number.isFinite(received) || !Number.isFinite(total) || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((received / total) * 100)));
}
