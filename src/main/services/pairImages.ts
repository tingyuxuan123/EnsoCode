import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { HostToPhone, PhoneToHost } from '@enso/pair';
import { previewImageMime } from '@shared/markdownPreviewImage';
import { normalizeSessionImageRel } from '@shared/pair/imageRel';
import type { ProjectedMessage } from '@shared/types/agent';
import type { PairReply } from './pairHost';
import { resolveArtifactFile } from './workspaceArtifacts';

/**
 * 会话图片（read / 生成图片）的手机预览端口：
 * - 手机只给 sessionId + 工作区相对路径，绝对路径由 Main 按权威根解析并校验边界；
 * - 只读普通文件、扩展名白名单、有字节上限，编码交给注入的 encoder（Main 用 nativeImage 压到帧预算内）；
 * - 与文件端口同构：cwd/root 或授权变化后重新校验，答复前再确认一次访问权。
 */

/** 直接读盘上限：超过就不解码 */
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

function readPathArgument(args: unknown): string | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const record = args as Record<string, unknown>;
  const value =
    typeof record.path === 'string'
      ? record.path
      : typeof record.file_path === 'string'
        ? record.file_path
        : null;
  const file = value?.trim();
  if (!file || file.includes('\0') || file.startsWith('~')) return null;
  if (file.startsWith('\\\\') || file.startsWith('//')) return null;
  return file;
}

/**
 * 目录外图片没有可相对化的工作区根，只能由会话记录授权：
 * 工具调用 id 必须恰好对应一条成功的 read，再按其原始 path 参数解析。
 */
export async function resolveSessionImageReference(
  root: string,
  messages: readonly ProjectedMessage[],
  toolCallId: unknown
): Promise<string | null> {
  if (
    typeof toolCallId !== 'string' ||
    !toolCallId ||
    toolCallId.length > 512 ||
    [...toolCallId].some((char) => char.charCodeAt(0) < 0x20)
  )
    return null;

  const calls: string[] = [];
  const completed = new Set<string>();
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const part of message.content) {
        if (part.type !== 'toolCall' || part.id !== toolCallId || part.name !== 'read') continue;
        const file = readPathArgument(part.arguments);
        if (file) calls.push(file);
      }
    } else if (
      message.role === 'toolResult' &&
      message.toolCallId === toolCallId &&
      !message.isError
    ) {
      completed.add(toolCallId);
    }
  }
  if (calls.length !== 1 || !completed.has(toolCallId)) return null;

  const resolved = await realpath(path.resolve(root, calls[0])).catch(() => null);
  if (!resolved || !previewImageMime(resolved)) return null;
  const info = await stat(resolved).catch(() => null);
  return info?.isFile() ? resolved : null;
}

/** 已授权文件的受限读取；身份前后复核，拒绝读取期间被替换。 */
export async function readSessionImageFile(file: string): Promise<SessionImageRead> {
  const mime = sessionImageMime(file);
  if (!mime) return { error: 'unsupported' };
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile()) return { error: 'not-found' };
    if (before.size > SESSION_IMAGE_FILE_MAX) return { error: 'too-large' };
    if ((await realpath(file).catch(() => null)) !== file) return { error: 'changed' };
    // 有界读取：文件在读取过程中增长时最多读到预算 +1 字节就判超限，
    // 不会先把整份增长内容读进内存再判 changed（预算要是真上限）。
    const buffer = Buffer.allocUnsafe(SESSION_IMAGE_FILE_MAX + 1);
    let total = 0;
    while (total < buffer.length) {
      const chunk = await handle.read(buffer, total, buffer.length - total, null);
      if (chunk.bytesRead === 0) break;
      total += chunk.bytesRead;
      if (total > SESSION_IMAGE_FILE_MAX) return { error: 'too-large' };
    }
    const after = await handle.stat();
    if (
      after.size !== before.size ||
      after.ino !== before.ino ||
      after.mtimeMs !== before.mtimeMs ||
      total !== before.size
    )
      return { error: 'changed' };
    // 同路径被换成另一个 inode（删除后重建、目录整体替换）：路径现在指向别的文件，拒绝
    const current = await stat(file).catch(() => null);
    if (!current || current.dev !== after.dev || current.ino !== after.ino)
      return { error: 'changed' };
    return { file, mime, data: buffer.subarray(0, total) };
  } catch {
    return { error: 'not-found' };
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** 读字节：O_NOFOLLOW 拒绝被换成符号链接，前后各校验一次身份，避免读到一半被替换 */
export async function readSessionImage(root: string, rel: unknown): Promise<SessionImageRead> {
  if (!normalizeSessionImageRel(rel)) return { error: 'invalid' };
  const file = resolveSessionImageFile(root, rel);
  if (!file) return { error: 'not-found' };
  const read = await readSessionImageFile(file);
  if ('error' in read) return read;
  if (resolveSessionImageFile(root, rel) !== file) return { error: 'changed' };
  return read;
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
  resolveReferencedFile?: (sessionId: string, toolCallId: string) => Promise<string | null>;
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
      let read: SessionImageRead;
      if ('rel' in command) {
        read = await readSessionImage(before.root, command.rel);
      } else {
        let file: string | null = null;
        try {
          file =
            (await input.resolveReferencedFile?.(command.sessionId, command.toolCallId)) ?? null;
        } catch {
          return fail('unavailable');
        }
        read = file ? await readSessionImageFile(file) : { error: 'not-found' };
      }
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
