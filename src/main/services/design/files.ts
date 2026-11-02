import { open } from 'node:fs/promises';
import path from 'node:path';
import { DesignServiceError, MAX_FILE_BYTES, tooLarge } from './errors';

export async function readBounded(file: string, limit = MAX_FILE_BYTES): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new DesignServiceError('INVALID_ARGUMENT', 'Expected a regular file');
    if (info.size > limit) tooLarge();
    const chunks: Buffer[] = [];
    let count = 0;
    for (;;) {
      const bytes = Buffer.alloc(Math.min(65536, limit + 1 - count));
      const { bytesRead } = await handle.read(bytes);
      if (!bytesRead) break;
      count += bytesRead;
      if (count > limit) tooLarge();
      chunks.push(bytes.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, count);
  } finally {
    await handle.close();
  }
}
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.txt': 'text/plain',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.vetdz': 'application/zip',
};
export const mimeType = (file: string): string =>
  MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
