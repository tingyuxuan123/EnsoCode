import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { HostToPhone, PhoneToHost } from '@enso/pair';
import { previewImageMime } from '@shared/markdownPreviewImage';
import { normalizeSessionImageRel } from '@shared/pair/imageRel';
import { resolveArtifactFile } from './bots/artifacts';
import type { PairReply } from './pairHost';

/**
 * 会话图片（read / 生成图片）的手机预览端口：
 * - 手机只给 sessionId + 工作区相对路径，绝对路径由 Main 按权威根解析并校验边界；
 * - 只读普通文件、扩展名白名单、有字节上限，编码交给注入的 encoder（Main 用 nativeImage 压到帧预算内）；
 * - 与文件端口同构：cwd/root 或授权变化后重新校验，答复前再确认一次访问权。
 */

/** 直接读盘上限：超过就不解码（和 Bot 产物同一口径） */
export const SESSION_IMAGE_FILE_MAX = 20 * 1024 * 1024;

export type SessionImageFailure =
  | 'invalid'
  | 'unavailable'
  | 'not-found'
  | 'unsupported'
  | 'too-large'
  | 'changed';

export { normalizeSessionImageRel };

/** 根内、真实路径仍在根内的普通图片文件；越界/不存在的输入一律 null */
export function resolveSessionImageFile(root: string, rel: unknown): string | null {
  const normalized = normalizeSessionImageRel(rel);
  if (!normalized) return null;
  return resolveArtifactFile(root, normalized);
}

export function sessionImageMime(file: string): string | null {
  return previewImageMime(file);
}

export type SessionImageRead =
  | { file: string; mime: string; data: Buffer }
  | { error: SessionImageFailure };

/** 读字节：O_NOFOLLOW 拒绝被换成符号链接，前后各校验一次身份，避免读到一半被替换 */
export async function readSessionImage(root: string, rel: unknown): Promise<SessionImageRead> {
  if (!normalizeSessionImageRel(rel)) return { error: 'invalid' };
  const file = resolveSessionImageFile(root, rel);
  if (!file) return { error: 'not-found' };
  const mime = sessionImageMime(file);
  if (!mime) return { error: 'unsupported' };
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile()) return { error: 'not-found' };
    if (before.size > SESSION_IMAGE_FILE_MAX) return { error: 'too-large' };
    if (resolveSessionImageFile(root, rel) !== file) return { error: 'changed' };
    const data = await handle.readFile();
    const after = await handle.stat();
    if (
      after.size !== before.size ||
      after.ino !== before.ino ||
      after.mtimeMs !== before.mtimeMs ||
      data.length !== before.size
    )
      return { error: 'changed' };
    return { file, mime, data };
  } catch {
    return { error: 'not-found' };
  } finally {
    await handle?.close().catch(() => {});
  }
}

export type SessionImageEncoder = (data: Buffer, mime: string) => string | null;

export type SessionImageCommand = Extract<PhoneToHost, { type: 'session-image' }>;
export type SessionImageFrame = Extract<HostToPhone, { type: 'session-image-result' }>;

export interface SessionImageSource {
  root: string;
  /** 权威记录指纹：cwd/工作树/授权变化后旧请求不能再读 */
  stamp: string;
}

export interface PairImagePort {
  handle(command: SessionImageCommand, reply: PairReply): Promise<void>;
  canAccess?(sessionId: string): boolean;
  accessKey?(sessionId: string): string | null;
}

export function createPairImagePort(input: {
  lookup: (sessionId: string) => SessionImageSource | null;
  encode: SessionImageEncoder;
}): PairImagePort {
  const accessKey = (sessionId: string): string | null => {
    const source = input.lookup(sessionId);
    return source ? JSON.stringify([source.root, source.stamp]) : null;
  };
  return {
    canAccess: (sessionId) => accessKey(sessionId) !== null,
    accessKey,
    async handle(command, reply) {
      const fail = async (error: SessionImageFailure): Promise<void> => {
        await reply({ type: 'session-image-result', requestId: command.requestId, error });
      };

      const before = input.lookup(command.sessionId);
      if (!before) return fail('unavailable');
      const read = await readSessionImage(before.root, command.rel);
      // 读盘期间 cwd/工作树/授权可能已经变了：重新按权威记录校验，旧内容不回给手机
      const after = input.lookup(command.sessionId);
      if (!after || after.root !== before.root || after.stamp !== before.stamp)
        return fail('unavailable');
      if ('error' in read) return fail(read.error);
      let dataUrl: string | null = null;
      try {
        dataUrl = input.encode(read.data, read.mime);
      } catch {
        dataUrl = null;
      }
      if (!dataUrl) return fail('too-large');
      await reply({ type: 'session-image-result', requestId: command.requestId, dataUrl });
      return;
    },
  };
}
