import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  GENERATED_IMAGE_DIR,
  type GeneratedImage,
  parseGeneratedImage,
  validImageSize,
} from '@shared/imageGeneration';
import {
  type ImageProviderSettings,
  imageOutputParams,
  parseImageProviderSettings,
} from '@shared/imageProvider';
import { sniffImageMime } from '@shared/imageSniff';
import {
  type ImageStudioOptions,
  type ImageStudioResult,
  type ImageStudioSession,
  type ImageStudioSummary,
  type ImageStudioTurn,
  imageStudioTitleFromPrompt,
  parseImageStudioGenerateRequest,
  parseImageStudioImageVariant,
  parseImageStudioOptions,
  parseImageStudioSessionId,
  studioOutputSettings,
  studioRequestedSize,
  studioThumbnailSize,
  studioTurnImages,
} from '@shared/imageStudio';
import { nativeImage } from 'electron';
import { generateImage, type ImageProviderConfig } from './service';

/**
 * 图片工作台会话（独立生图）的 Main 侧实现。
 *
 * 一个会话 = `userData/image-studio/<uuid>/` 下一个目录，产物仍由现有 `generateImage`
 * 落到 `<会话目录>/.xiaoman/images/<uuid>.<ext>`，不经过聊天 worker，也不改既有工具行为。
 *
 * 边界：
 * - 只接受 UUID 形式的会话/图片 id；路径一律由 Main 用权威记录推导，绝不接受渲染层路径。
 * - 会话目录、`.xiaoman`、`images` 必须是真实目录（realpath 与自身相等），读写都不跟随
 *   符号链接写到目录之外。
 * - `session.json` 有大小上限、严格字段校验、同目录 tmp + rename 原子写；
 *   坏文件 fail closed，不覆盖。
 * - 生成参数只覆盖本次请求，绝不写回全局图片服务配置；收费接口不自动重试。
 * - 同一会话同一时刻只允许一次生成；取消真正 abort 上游请求。
 * - 重启遗留的 `running` 在读取时改成 `cancelled` 并落盘，绝不伪造成完成。
 */

const SESSION_FILE = 'session.json';
const MAX_SESSION_BYTES = 1024 * 1024;
const RUNNING_TURN_RESERVE_BYTES = 2048;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_ERROR_CHARS = 300;
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const OUTPUT_SEGMENTS = GENERATED_IMAGE_DIR.split('/');
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const TURN_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const;
const SESSION_KEYS = [
  'version',
  'id',
  'title',
  'createdAt',
  'updatedAt',
  'turns',
  'references',
] as const;
const TURN_KEYS = [
  'id',
  'prompt',
  'createdAt',
  'options',
  'sourceImageId',
  'status',
  'image',
  'images',
  'error',
  'size',
] as const;

export interface ImageStudioConnection {
  config: ImageProviderSettings;
  apiKey: string;
}

export interface ImageStudioDeps {
  /** `<userData>/image-studio`；服务内部 realpath 后作为唯一写根。 */
  root: string;
  /** 独立生图配置；未配置（无 key / 无 endpoint）返回 undefined。 */
  provider: () => ImageStudioConnection | undefined;
  /** 默认是现有 `generateImage`；测试注入。 */
  generate?: typeof generateImage;
  /** 默认用 Electron `nativeImage` 生成长边 ≤480 的 PNG data URL；测试注入。 */
  thumbnail?: (bytes: Buffer, mimeType: string) => string | null;
  /**
   * 每次持久化成功后立即通知界面（`sendToAllWindows`）。
   *
   * 生成必须先广播刚落盘的 running turn：renderer 不做乐观回显，靠这条广播立刻显示
   * prompt / running 卡片，而不是等 300 秒请求结束。
   */
  changed?: () => void;
  now?: () => number;
  nextId?: () => string;
}

const ok = <T>(value: T): ImageStudioResult<T> => ({ ok: true, value });
const fail = <T>(error: string): ImageStudioResult<T> => ({ ok: false, error });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

interface StoredSession {
  version: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ImageStudioTurn[];
  references: GeneratedImage[];
}

export class ImageStudioService {
  private readonly deps: ImageStudioDeps;
  private readonly runGenerate: typeof generateImage;
  private readonly thumbnail: (bytes: Buffer, mimeType: string) => string | null;
  private readonly notify: () => void;
  private readonly now: () => number;
  private readonly nextId: () => string;
  private readonly generating = new Map<string, AbortController>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(deps: ImageStudioDeps) {
    this.deps = deps;
    this.runGenerate = deps.generate ?? generateImage;
    this.thumbnail = deps.thumbnail ?? nativeImageThumbnail;
    this.notify = deps.changed ?? (() => {});
    this.now = deps.now ?? Date.now;
    this.nextId = deps.nextId ?? randomUUID;
  }

  async list(): Promise<ImageStudioResult<ImageStudioSummary[]>> {
    const root = await this.resolveRoot().catch(() => null);
    if (!root) return fail('图片工作台目录不可用。');
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return fail('图片工作台目录不可用。');
    }
    const summaries: ImageStudioSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const sessionId = parseImageStudioSessionId(entry.name);
      if (!sessionId) continue;
      const session = await this.readRepaired(sessionId).catch(() => null);
      if (!session?.ok) continue;
      summaries.push(summarize(session.value));
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
    return ok(summaries);
  }

  async create(): Promise<ImageStudioResult<ImageStudioSession>> {
    const id = parseImageStudioSessionId(this.nextId());
    if (!id) return fail('无法创建图片会话。');
    const dir = await this.resolveSessionDir(id, true).catch(() => null);
    if (!dir) return fail('无法创建图片会话。');
    const timestamp = this.now();
    const stored: StoredSession = {
      version: 1,
      id,
      title: '',
      createdAt: timestamp,
      updatedAt: timestamp,
      turns: [],
      references: [],
    };
    try {
      writeSessionFile(dir, stored);
    } catch {
      return fail('无法保存图片会话。');
    }
    this.notify();
    return ok(project(stored));
  }

  async read(rawSessionId: unknown): Promise<ImageStudioResult<ImageStudioSession>> {
    const sessionId = parseImageStudioSessionId(rawSessionId);
    if (!sessionId) return fail('会话 id 无效。');
    return this.readRepaired(sessionId);
  }

  async generate(rawRequest: unknown): Promise<ImageStudioResult<ImageStudioSession>> {
    const request = parseImageStudioGenerateRequest(rawRequest);
    if (!request) return fail('生成请求无效。');
    const connection = this.deps.provider();
    if (!connection) return fail('还没有配置独立图片服务。');
    const providerConfig = parseImageProviderSettings(connection.config);
    if (!providerConfig) return fail('独立图片服务配置无效。');
    // 界面总是发显式模型；留空时回落到独立 provider 的第一个模型（仍必须来自列表）。
    const model = request.options.model || providerConfig.models[0] || '';
    if (!model || !providerConfig.models.includes(model)) {
      return fail('所选模型不在独立图片服务的模型列表里。');
    }
    if (request.sourceImageId && !providerConfig.imageToImage) {
      return fail('独立图片服务没有启用图生图。');
    }
    // 到这里之前全是同步校验：并发同会话的第二次调用会在这里被拒绝，不会重复收费。
    if (this.generating.has(request.sessionId)) return fail('该会话正在生成，请等待或取消。');
    const options: ImageStudioOptions = { ...request.options, model };
    const controller = new AbortController();
    this.generating.set(request.sessionId, controller);
    try {
      return await this.runTurn(request, options, connection, providerConfig, controller);
    } finally {
      this.generating.delete(request.sessionId);
    }
  }

  async cancel(rawSessionId: unknown): Promise<ImageStudioResult<null>> {
    const sessionId = parseImageStudioSessionId(rawSessionId);
    if (!sessionId) return fail('会话 id 无效。');
    this.generating.get(sessionId)?.abort();
    return ok(null);
  }

  /** `sourceFile` 只能来自 Main 的原生选图对话框；null 表示用户取消。 */
  async importReference(
    rawSessionId: unknown,
    sourceFile: string | null
  ): Promise<ImageStudioResult<GeneratedImage | null>> {
    const sessionId = parseImageStudioSessionId(rawSessionId);
    if (!sessionId) return fail('会话 id 无效。');
    if (sourceFile === null) return ok(null);
    if (typeof sourceFile !== 'string' || !path.isAbsolute(sourceFile) || sourceFile.length > 4096)
      return fail('参考图路径无效。');
    const session = await this.readRepaired(sessionId);
    if (!session.ok) return session;
    const dir = await this.resolveSessionDir(sessionId, true).catch(() => null);
    if (!dir) return fail('会话不存在。');
    const imageId = parseImageStudioSessionId(this.nextId());
    if (!imageId) return fail('无法导入参考图。');
    let mimeType: string;
    try {
      mimeType = copyReferenceImage(dir, imageId, sourceFile);
    } catch {
      return fail('无法导入这张图片，只支持 32 MiB 以内的 png / jpeg / webp / gif。');
    }
    const reference: GeneratedImage = {
      id: imageId,
      path: `${GENERATED_IMAGE_DIR}/${imageId}.${MIME_EXTENSIONS[mimeType]}`,
      mimeType,
    };
    const updated = await this.mutateSession(sessionId, (current) => ({
      ...current,
      references: [...current.references, reference],
      updatedAt: this.now(),
    }));
    if (!updated.ok) {
      try {
        unlinkSync(path.join(dir, reference.path));
      } catch {
        /* Only remove this newly imported UUID. */
      }
    }
    return updated.ok ? ok(reference) : updated;
  }

  async image(
    rawSessionId: unknown,
    rawImageId: unknown,
    rawVariant?: unknown
  ): Promise<ImageStudioResult<{ dataUrl: string }>> {
    const sessionId = parseImageStudioSessionId(rawSessionId);
    const imageId = parseImageStudioSessionId(rawImageId);
    if (!sessionId || !imageId) return fail('图片 id 无效。');
    const variant = parseImageStudioImageVariant(rawVariant);
    if (!variant) return fail('图片读取方式无效。');
    const session = await this.readRepaired(sessionId);
    if (!session.ok) return session;
    const record = findImage(session.value, imageId);
    if (!record) return fail('该会话里没有这张图片。');
    const dir = await this.resolveSessionDir(sessionId, false).catch(() => null);
    if (!dir) return fail('会话不存在。');
    let bytes: Buffer;
    try {
      bytes = readRecordedImage(dir, record);
    } catch {
      return fail('无法读取这张图片。');
    }
    if (variant === 'thumb') {
      let thumb: string | null = null;
      try {
        thumb = this.thumbnail(bytes, record.mimeType);
      } catch {
        thumb = null;
      }
      // 只认 PNG data URL：缩略图必须是这里生成的那份，不接受其他外壳。
      if (!thumb?.startsWith('data:image/png;base64,')) return fail('无法生成缩略图。');
      return ok({ dataUrl: thumb });
    }
    return ok({ dataUrl: `data:${record.mimeType};base64,${bytes.toString('base64')}` });
  }

  async remove(rawSessionId: unknown): Promise<ImageStudioResult<null>> {
    const sessionId = parseImageStudioSessionId(rawSessionId);
    if (!sessionId) return fail('会话 id 无效。');
    if (this.generating.has(sessionId)) return fail('会话正在生成，无法删除。');
    const dir = await this.resolveSessionDir(sessionId, false).catch(() => null);
    if (!dir) return fail('会话不存在。');
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      return fail('无法删除图片会话。');
    }
    this.notify();
    return ok(null);
  }

  private async runTurn(
    request: NonNullable<ReturnType<typeof parseImageStudioGenerateRequest>>,
    options: ImageStudioOptions,
    connection: ImageStudioConnection,
    providerConfig: ImageProviderSettings,
    controller: AbortController
  ): Promise<ImageStudioResult<ImageStudioSession>> {
    const current = await this.readRepaired(request.sessionId);
    if (!current.ok) return current;
    if (request.sourceImageId && !findImage(current.value, request.sourceImageId)) {
      return fail('参考图不在这个会话里。');
    }
    const dir = await this.resolveSessionDir(request.sessionId, false).catch(() => null);
    if (!dir) return fail('会话不存在。');

    const settings = studioOutputSettings(providerConfig, options);
    const requestedSize = studioRequestedSize(options.ratio, options.resolution);
    const sent = imageOutputParams(settings, requestedSize);
    const size = normalizedStoredSize(sent.size) ?? undefined;
    const turnId = parseImageStudioSessionId(this.nextId());
    if (!turnId) return fail('无法创建生成记录。');
    const turn: ImageStudioTurn = {
      id: turnId,
      prompt: request.prompt,
      createdAt: this.now(),
      options,
      ...(request.sourceImageId ? { sourceImageId: request.sourceImageId } : {}),
      status: 'running',
      ...(options.count > 1 ? { images: [] } : {}),
    };
    const started = await this.mutateSession(request.sessionId, (session) => ({
      ...session,
      title: session.title || imageStudioTitleFromPrompt(request.prompt),
      turns: [...session.turns, turn],
      updatedAt: this.now(),
    }));
    if (!started.ok) return started;

    const images: GeneratedImage[] = [];
    let error: string | undefined;
    let status: ImageStudioTurn['status'] = 'completed';
    for (let index = 0; index < options.count; index++) {
      if (controller.signal.aborted) {
        status = 'cancelled';
        break;
      }
      try {
        const result = await this.runGenerate(
          {
            prompt: request.prompt,
            ...(requestedSize ? { size: requestedSize } : {}),
            ...(request.sourceImageId ? { sourceImageId: request.sourceImageId } : {}),
          },
          dir,
          buildConfig(connection, options, settings),
          controller.signal
        );
        if (!result.ok) {
          status = controller.signal.aborted ? 'cancelled' : 'failed';
          if (status === 'failed') error = redact(result.error, connection.apiKey);
          break;
        }
        const image = parseGeneratedImage(result.image);
        if (!image || images.some((previous) => previous.id === image.id)) {
          status = 'failed';
          error = '图片服务返回的产物记录无效。';
          break;
        }
        images.push(image);
      } catch (failure) {
        status = controller.signal.aborted ? 'cancelled' : 'failed';
        if (status === 'failed')
          error = redact(
            failure instanceof Error ? failure.message : '图片生成失败。',
            connection.apiKey
          );
        break;
      }
      // 每张都是用户明确选择的一次调用；先保存、广播，再发下一张，不重试。
      if (options.count > 1) {
        const progress = await this.mutateSession(request.sessionId, (session) => ({
          ...session,
          turns: session.turns.map((row) =>
            row.id === turn.id ? { ...row, images: [...images], ...(size ? { size } : {}) } : row
          ),
          updatedAt: this.now(),
        }));
        if (!progress.ok) return progress;
      }
    }
    const finished = await this.mutateSession(request.sessionId, (session) => ({
      ...session,
      turns: session.turns.map((row) =>
        row.id === turn.id
          ? {
              ...row,
              status,
              ...(options.count > 1 ? { images } : images[0] ? { image: images[0] } : {}),
              ...(error ? { error } : {}),
              ...(size ? { size } : {}),
            }
          : row
      ),
      updatedAt: this.now(),
    }));
    return finished;
  }

  /** 读取会话；进程重启遗留的 running 会被改成 cancelled 并落盘。 */
  private async readRepaired(sessionId: string): Promise<ImageStudioResult<ImageStudioSession>> {
    const loaded = await this.readSession(sessionId);
    if (!loaded.ok) return loaded;
    if (!loaded.value.turns.some((turn) => turn.status === 'running')) return loaded;
    // 本进程正在生成时不清 running，避免把在途 turn 误判成重启遗留。
    if (this.generating.has(sessionId)) return loaded;
    return this.runLocked(sessionId, async () => {
      const fresh = await this.readSession(sessionId);
      if (!fresh.ok) return fresh;
      const dir = await this.resolveSessionDir(sessionId, false).catch(() => null);
      if (!dir) return fail<ImageStudioSession>('会话不存在。');
      const next: ImageStudioSession = {
        ...fresh.value,
        turns: fresh.value.turns.map((turn) =>
          turn.status === 'running' ? { ...turn, status: 'cancelled' } : turn
        ),
      };
      try {
        writeSessionFile(dir, toStored(next));
      } catch {
        return fail<ImageStudioSession>('无法保存图片会话。');
      }
      this.notify();
      return ok(next);
    });
  }

  private async readSession(sessionId: string): Promise<ImageStudioResult<ImageStudioSession>> {
    const dir = await this.resolveSessionDir(sessionId, false).catch(() => null);
    if (!dir) return fail('会话不存在。');
    let raw: Buffer;
    try {
      raw = readFileBounded(path.join(dir, SESSION_FILE), MAX_SESSION_BYTES);
    } catch {
      return fail('无法读取图片会话。');
    }
    const session = parseStoredSession(raw);
    return session && session.id === sessionId
      ? ok(project(session))
      : fail('图片会话已损坏，已拒绝读取。');
  }

  private async mutateSession(
    sessionId: string,
    change: (session: ImageStudioSession) => ImageStudioSession
  ): Promise<ImageStudioResult<ImageStudioSession>> {
    return this.runLocked(sessionId, async () => {
      const loaded = await this.readSession(sessionId);
      if (!loaded.ok) return loaded;
      const dir = await this.resolveSessionDir(sessionId, false).catch(() => null);
      if (!dir) return fail<ImageStudioSession>('会话不存在。');
      const next = change(loaded.value);
      try {
        writeSessionFile(dir, toStored(next));
      } catch {
        return fail<ImageStudioSession>('无法保存图片会话。');
      }
      // 每次落盘后立即广播：running turn 落盘那一刻界面就能画出发送中的卡片。
      this.notify();
      // 摘要由 turns 派生：写盘后重新投影，避免把调用前的 imageCount 回给界面。
      return ok(project(toStored(next)));
    });
  }

  private async resolveRoot(): Promise<string> {
    const root = this.deps.root;
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('invalid root');
    await mkdir(root, { recursive: true, mode: DIRECTORY_MODE });
    const canonical = await realpath(root);
    const info = await stat(canonical);
    if (!info.isDirectory()) throw new Error('root is not a directory');
    // 唯一写根必须是真实目录：不接受符号链接把整棵会话树带出 userData。
    if (lstatSync(root).isSymbolicLink()) throw new Error('root is a symlink');
    return canonical;
  }

  private async resolveSessionDir(sessionId: string, create: boolean): Promise<string | null> {
    const root = await this.resolveRoot().catch(() => null);
    if (!root) return null;
    const dir = path.join(root, sessionId);
    if (create) await mkdir(dir, { recursive: true, mode: DIRECTORY_MODE });
    let canonical: string;
    try {
      canonical = await realpath(dir);
    } catch {
      return null;
    }
    if (canonical !== dir) return null;
    const info = lstatSync(dir, { throwIfNoEntry: false });
    if (!info?.isDirectory() || info.isSymbolicLink()) return null;
    return dir;
  }

  /** 同一会话的元数据写入串行化；生成本身不持锁，读取与取消不会被 300 秒请求拖住。 */
  private async runLocked<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(sessionId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.locks.set(sessionId, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.locks.get(sessionId) === tail) this.locks.delete(sessionId);
    }
  }
}

function buildConfig(
  connection: ImageStudioConnection,
  options: ImageStudioOptions,
  settings: ImageProviderSettings
): ImageProviderConfig {
  return {
    baseUrl: connection.config.baseUrl,
    apiKey: connection.apiKey,
    modelId: options.model,
    output: settings,
  };
}

const summarize = (session: {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ImageStudioTurn[];
}): ImageStudioSummary => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  imageCount: session.turns.reduce((count, turn) => count + studioTurnImages(turn).length, 0),
});

/** `imageCount` 由 turns 派生，不单独落盘。 */
const project = (stored: StoredSession): ImageStudioSession => ({
  ...summarize(stored),
  turns: stored.turns,
  references: stored.references,
});

const toStored = (session: ImageStudioSession): StoredSession => ({
  version: 1,
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  turns: session.turns,
  references: session.references,
});

function findImage(session: ImageStudioSession, imageId: string): GeneratedImage | undefined {
  const fromTurn = session.turns.flatMap(studioTurnImages).find((image) => image.id === imageId);
  return fromTurn ?? session.references.find((reference) => reference.id === imageId);
}

function parseStoredSession(raw: Buffer): StoredSession | null {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !(SESSION_KEYS as readonly string[]).includes(key)))
    return null;
  if (value.version !== 1) return null;
  const id = parseImageStudioSessionId(value.id);
  if (!id) return null;
  if (typeof value.title !== 'string' || value.title.length > 200) return null;
  const createdAt = timestamp(value.createdAt);
  const updatedAt = timestamp(value.updatedAt);
  if (createdAt === null || updatedAt === null) return null;
  if (!Array.isArray(value.turns) || !Array.isArray(value.references)) return null;
  const turns: ImageStudioTurn[] = [];
  for (const row of value.turns) {
    const turn = parseStoredTurn(row);
    if (!turn) return null;
    turns.push(turn);
  }
  const references: GeneratedImage[] = [];
  for (const row of value.references) {
    const reference = parseGeneratedImage(row);
    if (!reference) return null;
    references.push(reference);
  }
  return { version: 1, id, title: value.title, createdAt, updatedAt, turns, references };
}

function parseStoredTurn(value: unknown): ImageStudioTurn | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !(TURN_KEYS as readonly string[]).includes(key)))
    return null;
  const id = parseImageStudioSessionId(value.id);
  const createdAt = timestamp(value.createdAt);
  const options = parseImageStudioOptions(value.options);
  const status = TURN_STATUSES.find((item) => item === value.status);
  if (!id || createdAt === null || !options || !status) return null;
  if (typeof value.prompt !== 'string' || !value.prompt) return null;
  const sourceImageId =
    value.sourceImageId === undefined ? undefined : parseImageStudioSessionId(value.sourceImageId);
  if (sourceImageId === null) return null;
  if (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 500))
    return null;
  const size = value.size === undefined ? undefined : normalizedStoredSize(value.size);
  if (size === null) return null;
  let image: GeneratedImage | undefined;
  if (value.image !== undefined) {
    image = parseGeneratedImage(value.image) ?? undefined;
    // 只有完成的 turn 能带图；带图即视为 completed，其余状态一律不合法。
    if (!image || status !== 'completed') return null;
  }
  let images: GeneratedImage[] | undefined;
  if (value.images !== undefined) {
    if (image || !Array.isArray(value.images) || value.images.length > options.count) return null;
    images = [];
    for (const raw of value.images) {
      const parsed = parseGeneratedImage(raw);
      if (!parsed || images.some((previous) => previous.id === parsed.id)) return null;
      images.push(parsed);
    }
    if (status === 'completed' && images.length !== options.count) return null;
  }
  return {
    id,
    prompt: value.prompt,
    createdAt,
    options,
    ...(sourceImageId ? { sourceImageId } : {}),
    status,
    ...(image ? { image } : {}),
    ...(images ? { images } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    ...(size ? { size } : {}),
  };
}

function normalizedStoredSize(value: unknown): string | null {
  if (value === 'auto') return value;
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d{2,4})\s*[xX×*]\s*(\d{2,4})\s*$/.exec(value);
  if (!match) return null;
  const size = `${Number(match[1])}x${Number(match[2])}`;
  return validImageSize(size) ? size : null;
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function writeSessionFile(dir: string, stored: StoredSession): void {
  const info = lstatSync(dir, { throwIfNoEntry: false });
  if (!info?.isDirectory() || info.isSymbolicLink() || realpathSync(dir) !== dir) {
    throw new Error('image studio dir is not a real directory');
  }
  const file = path.join(dir, SESSION_FILE);
  const existing = lstatSync(file, { throwIfNoEntry: false });
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new Error('image studio session is not a regular file');
  }
  const data = Buffer.from(JSON.stringify(stored), 'utf8');
  const reserve = stored.turns.reduce(
    (bytes, turn) =>
      turn.status === 'running'
        ? bytes +
          (Math.max(0, turn.options.count - studioTurnImages(turn).length) + 1) *
            RUNNING_TURN_RESERVE_BYTES
        : bytes,
    0
  );
  if (data.length + reserve > MAX_SESSION_BYTES) throw new Error('image studio session too large');
  const tmp = path.join(dir, `.${SESSION_FILE}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, data, { mode: FILE_MODE, flag: 'wx' });
    renameSync(tmp, file);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* 只清自己的 tmp。 */
    }
    throw error;
  }
}

function readFileBounded(file: string, maxBytes: number): Buffer {
  const before = lstatSync(file);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('not a regular file');
  if (before.size > maxBytes) throw new Error('file too large');
  const fd = openSync(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  );
  try {
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      info.size > maxBytes ||
      before.dev !== info.dev ||
      before.ino !== info.ino
    )
      throw new Error('unsafe file');
    const buffer = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    const after = fstatSync(fd);
    if (
      offset !== info.size ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs ||
      after.ctimeMs !== info.ctimeMs
    )
      throw new Error('file changed while reading');
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

/**
 * 把用户在原生对话框里选中的图片复制到本会话产物目录，返回嗅探出的 mime。
 * 先按魔数确认是 png/jpeg/webp/gif，再按 32 MiB 上限整份复制；只写 UUID 目标名。
 */
function copyReferenceImage(dir: string, imageId: string, sourceFile: string): string {
  const canonical = realpathSync(sourceFile);
  const sourceInfo = lstatSync(canonical);
  if (!sourceInfo.isFile() || sourceInfo.size > MAX_IMAGE_BYTES) {
    throw new Error('reference is not a readable image file');
  }
  const bytes = readFileBounded(canonical, MAX_IMAGE_BYTES);
  const mimeType = sniffImageMime(bytes);
  if (!mimeType || !MIME_EXTENSIONS[mimeType]) throw new Error('unsupported reference image');
  const outputDir = ensureOutputDir(dir);
  const target = path.join(outputDir, `${imageId}.${MIME_EXTENSIONS[mimeType]}`);
  let fd: number | undefined;
  let created = false;
  try {
    fd = openSync(
      target,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      FILE_MODE
    );
    created = true;
    const actual = fstatSync(fd);
    const current = lstatSync(target);
    if (
      !current.isFile() ||
      current.dev !== actual.dev ||
      current.ino !== actual.ino ||
      realpathSync(outputDir) !== outputDir
    )
      throw new Error('reference target changed while opening');
    writeFileSync(fd, bytes);
  } catch (error) {
    if (fd !== undefined) {
      closeSync(fd);
      fd = undefined;
    }
    if (created) {
      try {
        unlinkSync(target);
      } catch {
        /* 只清自己写的文件。 */
      }
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return mimeType;
}

/** 会话内的 `.xiaoman/images`：逐段同步创建，每段都必须是真实目录。 */
function ensureOutputDir(dir: string): string {
  if (lstatSync(dir).isSymbolicLink() || realpathSync(dir) !== dir) {
    throw new Error('image studio dir is not a real directory');
  }
  let outputDir = dir;
  for (const segment of OUTPUT_SEGMENTS) {
    outputDir = path.join(outputDir, segment);
    const existing = lstatSync(outputDir, { throwIfNoEntry: false });
    if (existing) {
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new Error('image output dir is not a real directory');
      }
    } else {
      mkdirSync(outputDir, { mode: DIRECTORY_MODE });
    }
    if (realpathSync(outputDir) !== outputDir) throw new Error('image output dir is a symlink');
  }
  return outputDir;
}

/** 只读取权威记录里登记过的图片；路径由记录 id + mime 推导，不信任外部路径。 */
function readRecordedImage(dir: string, record: GeneratedImage): Buffer {
  const outputDir = path.join(dir, ...OUTPUT_SEGMENTS);
  if (realpathSync(outputDir) !== outputDir) throw new Error('image output dir is a symlink');
  const canonical = realpathSync(path.join(dir, record.path));
  const relative = path.relative(outputDir, canonical);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('image is outside the session output dir');
  }
  const bytes = readFileBounded(canonical, MAX_IMAGE_BYTES);
  if (sniffImageMime(bytes) !== record.mimeType) throw new Error('image magic mismatch');
  return bytes;
}

function redact(text: string, apiKey: string): string {
  const safe = apiKey ? text.split(apiKey).join('***') : text;
  return safe.length > MAX_ERROR_CHARS ? `${safe.slice(0, MAX_ERROR_CHARS)}…` : safe;
}

/**
 * 缩略图：长边 ≤480 的 PNG data URL。
 * 原图字节只在这里过一遍，不把 32 MiB 原图塞进历史渲染。
 */
function nativeImageThumbnail(bytes: Buffer): string | null {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return null;
  const size = image.getSize();
  const target = studioThumbnailSize(size.width, size.height);
  if (!target) return null;
  const scaled =
    target.width === size.width && target.height === size.height
      ? image
      : image.resize({ width: target.width, height: target.height, quality: 'good' });
  const png = scaled.toPNG();
  return png.length > 0 ? `data:image/png;base64,${png.toString('base64')}` : null;
}
