import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { IMAGE_MIME_BY_EXT, imageFormat } from './domain.mjs';

/** 单张图片的解码上限；渲染层已压到约 420KB。宿主单次 UI 调用限 1MB，含 base64 膨胀留足余量。 */
export const MAX_IMAGE_BYTES = 600 * 1024;
export const MAX_THUMB_BYTES = 256 * 1024;
/** 图片是独立文件，不进 memory.json；这里给整个附件目录一个硬上限。 */
export const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
/** 尚未被待办引用的新文件只有超过这个年龄才可能被清理，避免删掉正在上传的图。 */
export const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000;
const NAME = /^[a-z0-9-]{1,80}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** 缩略图与正文同名加 `-t` 后缀；`[a-z0-9-]` 本身包含连字符，不能靠分组拆。 */
const thumbOf = (id) => `${id}-t`;
const idOf = (name) => (name.endsWith('-t') ? name.slice(0, -2) : name);

const notFound = () => Object.assign(new Error('图片不存在'), { code: 'ENOENT' });

function decodeBase64(value, limit, label) {
  if (typeof value !== 'string' || !value || value.length % 4 !== 0 || !BASE64.test(value))
    throw new Error(`${label}必须是原始 base64 数据`);
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length) throw new Error(`${label}为空`);
  if (bytes.length > limit) throw new Error(`${label}超过 ${Math.round(limit / 1024)}KB 上限`);
  if (bytes.toString('base64') !== value) throw new Error(`${label}不是有效的 base64 数据`);
  return bytes;
}

export function createAttachmentStore(directory, { minAgeMs = ORPHAN_MIN_AGE_MS } = {}) {
  const root = join(directory, 'attachments');
  /** 本次进程刚写入、还没被待办认领的文件；清理必须放过它们。 */
  const pending = new Map();
  const pathOf = (id, thumb) => join(root, thumb ? thumbOf(id) : id);

  async function prepare() {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('附件目录不可为符号链接');
  }

  /** 文件名不带扩展名，MIME 每次从文件头重新判定，绝不采用渲染层的声明。 */
  async function probe(file) {
    let handle;
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) return null;
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const head = Buffer.alloc(16);
      const { bytesRead } = await handle.read(head, 0, 16, 0);
      const format = imageFormat(head.subarray(0, bytesRead));
      return format ? { mime: IMAGE_MIME_BY_EXT[format], bytes: info.size } : null;
    } catch {
      return null;
    } finally {
      await handle?.close();
    }
  }

  async function write(name, bytes) {
    let handle;
    try {
      handle = await open(join(root, name), 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle?.close();
    }
  }

  /** 同一个句柄里判定格式并读出字节，避免“先检查再读”之间被换成链接。 */
  async function readImage(file) {
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return null;
      const data = await handle.readFile();
      const format = imageFormat(data.subarray(0, 16));
      return format ? { mime: IMAGE_MIME_BY_EXT[format], bytes: data.length, data } : null;
    } catch {
      return null;
    } finally {
      await handle?.close();
    }
  }

  async function totalBytes() {
    const names = await readdir(root);
    let total = 0;
    for (const name of names) {
      if (!NAME.test(idOf(name))) continue;
      try {
        total += (await stat(join(root, name))).size;
      } catch {}
    }
    return total;
  }

  return {
    prepare,
    /** data/thumb 都是原始 base64；两者都按文件头校验，任何一步失败都不留半张图。 */
    async put({ data, thumb }) {
      const full = decodeBase64(data, MAX_IMAGE_BYTES, '图片');
      const format = imageFormat(full);
      if (!format) throw new Error('只支持 PNG / JPEG / WebP / GIF / AVIF 图片');
      const preview =
        thumb === undefined || thumb === '' ? null : decodeBase64(thumb, MAX_THUMB_BYTES, '缩略图');
      if (preview && !imageFormat(preview)) throw new Error('缩略图格式无效');
      await prepare();
      if ((await totalBytes()) + full.length + (preview?.length ?? 0) > MAX_TOTAL_BYTES)
        throw new Error('图片附件已达 128MB 上限，请先清理不需要的待办图片');
      const id = randomUUID();
      pending.set(id, Date.now());
      try {
        await write(id, full);
        if (preview) await write(thumbOf(id), preview);
      } catch (error) {
        await rm(pathOf(id, true), { force: true });
        await rm(pathOf(id, false), { force: true });
        pending.delete(id);
        throw error;
      }
      return { id, mime: IMAGE_MIME_BY_EXT[format], bytes: full.length, thumb: !!preview };
    },
    /** 读回时优先用缩略图；缩略图缺失（旧数据或写入中断）就退回原图。 */
    async get(id, { full = false } = {}) {
      if (typeof id !== 'string' || !NAME.test(id) || id.endsWith('-t')) return null;
      const thumb = full ? null : await readImage(pathOf(id, true));
      return thumb ?? readImage(pathOf(id, false));
    },
    /** 认领时用的元数据：只读文件头与大小，不接受调用方给的 MIME。 */
    async describe(id) {
      if (typeof id !== 'string' || !NAME.test(id) || id.endsWith('-t')) throw notFound();
      const info = await probe(pathOf(id, false));
      if (!info) throw notFound();
      return { id, mime: info.mime, bytes: info.bytes };
    },
    async remove(id) {
      if (typeof id !== 'string' || !NAME.test(id) || id.endsWith('-t')) return;
      pending.delete(id);
      await rm(pathOf(id, true), { force: true });
      await rm(pathOf(id, false), { force: true });
    },
    /** 只清理没有待办或回收站引用的旧文件；正在上传的和刚写入的一律保留。 */
    async sweep(referenced, { minAgeMs: age = minAgeMs } = {}) {
      await prepare();
      const cutoff = Date.now() - age;
      for (const [id, at] of pending) if (at <= cutoff) pending.delete(id);
      let removed = 0;
      for (const name of await readdir(root)) {
        const id = idOf(name);
        if (!NAME.test(id)) continue;
        if (referenced.has(id) || pending.has(id)) continue;
        try {
          const info = await lstat(join(root, name));
          if (!info.isFile() || info.mtimeMs > cutoff) continue;
          await unlink(join(root, name));
          removed += 1;
        } catch {}
      }
      return removed;
    },
  };
}
