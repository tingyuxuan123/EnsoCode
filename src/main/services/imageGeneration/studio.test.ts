import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ImageGenerationResult } from '@shared/imageGeneration';
import { DEFAULT_IMAGE_PROVIDER, type ImageProviderSettings } from '@shared/imageProvider';
import { DEFAULT_IMAGE_STUDIO_OPTIONS, type ImageStudioOptions } from '@shared/imageStudio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ImageStudioDeps, ImageStudioService } from './studio';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(8),
]);
const BMP = Buffer.concat([Buffer.from('BM', 'latin1'), Buffer.alloc(8)]);
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

const OPTIONS: ImageStudioOptions = { ...DEFAULT_IMAGE_STUDIO_OPTIONS, model: 'gpt-image-1' };

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'xiaoman-studio-'));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

const provider = (patch: Partial<ImageProviderSettings> = {}) => ({
  config: { ...DEFAULT_IMAGE_PROVIDER, models: ['gpt-image-1', 'gpt-image-2'], ...patch },
  apiKey: 'sk-super-secret-key',
});

interface Fixture {
  service: ImageStudioService;
  root: string;
  generate: ReturnType<typeof vi.fn>;
  provider: () => ReturnType<typeof provider> | undefined;
  changed: ReturnType<typeof vi.fn>;
}

async function fixture(
  options: {
    providerConfig?: () => ReturnType<typeof provider> | undefined;
    generate?: ImageStudioDeps['generate'];
    thumbnail?: ImageStudioDeps['thumbnail'];
    now?: () => number;
    changed?: () => void;
  } = {}
): Promise<Fixture> {
  const root = await makeRoot();
  const providerConfig = options.providerConfig ?? (() => provider());
  const generate = vi.fn<NonNullable<ImageStudioDeps['generate']>>(
    options.generate ?? defaultGenerate
  );
  const changed = vi.fn(options.changed ?? (() => {}));
  const service = new ImageStudioService({
    root,
    provider: providerConfig,
    generate,
    changed,
    ...(options.thumbnail ? { thumbnail: options.thumbnail } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return { service, root, generate, provider: providerConfig, changed };
}

const imageFile = (id: string) => `.xiaoman/images/${id}.png`;

/** 只返回结果，不落盘；测试 image() 时单独写文件。 */
const defaultGenerate = async (): Promise<ImageGenerationResult> => {
  const id = randomUUID();
  return { ok: true, image: { id, path: imageFile(id), mimeType: 'image/png' } };
};

/** 一个会话 + 一张真实落盘的生成图。 */
async function withGeneratedPng(options: { thumbnail?: ImageStudioDeps['thumbnail'] } = {}) {
  const base = await fixture({
    ...(options.thumbnail ? { thumbnail: options.thumbnail } : {}),
    generate: async (_input, cwd) => {
      const id = randomUUID();
      await mkdir(path.join(cwd, '.xiaoman/images'), { recursive: true });
      await writeFile(path.join(cwd, imageFile(id)), PNG);
      return { ok: true, image: { id, path: imageFile(id), mimeType: 'image/png' } };
    },
  });
  const created = await base.service.create();
  if (!created.ok) throw new Error('create failed');
  const generated = await base.service.generate({
    sessionId: created.value.id,
    prompt: '猫',
    options: OPTIONS,
  });
  if (!generated.ok) throw new Error('generate failed');
  const imageId = generated.value.turns[0].image?.id ?? '';
  return {
    ...base,
    sessionId: created.value.id,
    imageId,
    sessionDir: path.join(base.root, created.value.id),
    imagePath: path.join(base.root, created.value.id, imageFile(imageId)),
  };
}

describe('ImageStudioService · 会话目录', () => {
  it('一条提示词逐张生成所选数量，每张落盘即能读到，重启后完整保留', async () => {
    let calls = 0;
    const { service, root, generate } = await fixture({
      generate: async (_input, cwd) => {
        const snapshot = await service.list();
        if (!snapshot.ok) throw new Error('list failed');
        expect(snapshot.value[0].imageCount).toBe(calls);
        const id = randomUUID();
        await mkdir(path.join(cwd, '.xiaoman/images'), { recursive: true });
        await writeFile(path.join(cwd, imageFile(id)), PNG);
        calls++;
        return { ok: true, image: { id, path: imageFile(id), mimeType: 'image/png' } };
      },
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const result = await service.generate({
      sessionId: created.value.id,
      prompt: 'three cats',
      options: { ...OPTIONS, count: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(generate).toHaveBeenCalledTimes(3);
    expect(result.value.turns).toHaveLength(1);
    expect(result.value.turns[0]).toMatchObject({
      status: 'completed',
      options: { count: 3 },
      images: expect.any(Array),
    });
    expect(result.value.turns[0].images).toHaveLength(3);
    expect(result.value.imageCount).toBe(3);
    const restarted = new ImageStudioService({ root, provider: () => provider() });
    const read = await restarted.read(created.value.id);
    expect(read.ok && read.value.imageCount).toBe(3);
    for (const image of result.value.turns[0].images ?? [])
      expect((await restarted.image(created.value.id, image.id)).ok).toBe(true);
  });
  it('批量中途失败仅请求到失败一张，已生成图片不丢失，也不重试或继续收费', async () => {
    let calls = 0;
    const { service, generate } = await fixture({
      generate: async () =>
        ++calls === 2
          ? { ok: false, error: 'upstream failed', retryable: true }
          : defaultGenerate(),
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const result = await service.generate({
      sessionId: created.value.id,
      prompt: 'cats',
      options: { ...OPTIONS, count: 5 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.value.turns[0]).toMatchObject({ status: 'failed', error: 'upstream failed' });
    expect(result.value.turns[0].images).toHaveLength(1);
    expect(result.value.imageCount).toBe(1);
    expect((await service.read(created.value.id)).ok).toBe(true);
  });
  it('取消整批保留先前图片，不会请求剩余图片', async () => {
    let calls = 0;
    const { service, generate } = await fixture({
      generate: async (_input, _cwd, _config, signal) => {
        calls++;
        if (calls === 1) return defaultGenerate();
        await service.cancel(sessionId);
        expect(signal?.aborted).toBe(true);
        throw new Error('aborted');
      },
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const sessionId = created.value.id;
    const result = await service.generate({
      sessionId,
      prompt: 'cats',
      options: { ...OPTIONS, count: 5 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.value.turns[0].status).toBe('cancelled');
    expect(result.value.turns[0].images).toHaveLength(1);
    expect(result.value.imageCount).toBe(1);
  });
  it('非法批量数量在请求和消息落盘之前拒绝', async () => {
    const { service, generate } = await fixture();
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    for (const count of [0, 11, 2.5, '3'])
      expect(
        (
          await service.generate({
            sessionId: created.value.id,
            prompt: 'cat',
            options: { ...OPTIONS, count },
          })
        ).ok
      ).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    const read = await service.read(created.value.id);
    expect(read.ok && read.value.turns).toEqual([]);
  });
  it('重启修复未完成批次时保留已落盘图片，旧单图记录缺省数量为 1', async () => {
    const { service, root } = await fixture();
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const result = await service.generate({
      sessionId: created.value.id,
      prompt: 'cats',
      options: { ...OPTIONS, count: 3 },
    });
    if (!result.ok) throw new Error('generate failed');
    const file = path.join(root, created.value.id, 'session.json');
    const stored = JSON.parse(await readFile(file, 'utf8'));
    stored.turns[0].status = 'running';
    stored.turns[0].images.pop();
    await writeFile(file, JSON.stringify(stored));
    const restarted = new ImageStudioService({ root, provider: () => provider() });
    const repaired = await restarted.read(created.value.id);
    expect(repaired.ok && repaired.value.turns[0].status).toBe('cancelled');
    expect(repaired.ok && repaired.value.imageCount).toBe(2);
    // 旧格式没有 count 和 images，仍能恢复原单图引用。
    stored.turns[0].status = 'completed';
    stored.turns[0].image = stored.turns[0].images[0];
    delete stored.turns[0].images;
    delete stored.turns[0].options.count;
    await writeFile(file, JSON.stringify(stored));
    const legacy = await restarted.read(created.value.id);
    expect(legacy.ok && legacy.value.turns[0].options.count).toBe(1);
    expect(legacy.ok && legacy.value.imageCount).toBe(1);
  });
  it('多图记录拒绝重复 id、超过所选数量与非法路径，不扩大图片读取权限', async () => {
    const { service, root } = await fixture();
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    await service.generate({
      sessionId: created.value.id,
      prompt: 'cats',
      options: { ...OPTIONS, count: 2 },
    });
    const file = path.join(root, created.value.id, 'session.json');
    const original = await readFile(file, 'utf8');
    for (const mutate of [
      (stored: { turns: { images: { id: string; path: string }[] }[] }) => {
        stored.turns[0].images[1] = stored.turns[0].images[0];
      },
      (stored: { turns: { images: { id: string; path: string }[] }[] }) => {
        stored.turns[0].images.push(stored.turns[0].images[0]);
      },
      (stored: { turns: { images: { id: string; path: string }[] }[] }) => {
        stored.turns[0].images[0].path = '../../outside.png';
      },
    ]) {
      const stored = JSON.parse(original);
      mutate(stored);
      await writeFile(file, JSON.stringify(stored));
      expect((await service.read(created.value.id)).ok).toBe(false);
    }
  });
  it('收费前为终态预留空间，接近会话上限时不请求上游', async () => {
    const { service, root, generate } = await fixture();
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const file = path.join(root, created.value.id, 'session.json');
    const stored = JSON.parse(await readFile(file, 'utf8'));
    stored.title = 'full';
    stored.turns = [
      { id: randomUUID(), prompt: '', createdAt: 1, options: OPTIONS, status: 'completed' },
    ];
    // Leaves enough for a running turn, but not its image record and terminal error fields.
    stored.turns[0].prompt = 'a'.repeat(
      1024 * 1024 - 900 - Buffer.byteLength(JSON.stringify(stored))
    );
    await writeFile(file, JSON.stringify(stored));
    const result = await service.generate({
      sessionId: created.value.id,
      prompt: 'cat',
      options: OPTIONS,
    });
    expect(result.ok).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect((await service.read(created.value.id)).ok).toBe(true);
  });
  it('会话文件身份与请求目录不符时拒绝，不允许覆盖别的会话投影', async () => {
    const { service, root, generate } = await fixture();
    const a = await service.create();
    const b = await service.create();
    if (!a.ok || !b.ok) throw new Error('create failed');
    await writeFile(
      path.join(root, b.value.id, 'session.json'),
      await readFile(path.join(root, a.value.id, 'session.json'))
    );
    expect((await service.read(b.value.id)).ok).toBe(false);
    expect(
      (await service.generate({ sessionId: b.value.id, prompt: '猫', options: OPTIONS })).ok
    ).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });
  it('服务合法的 size:auto 不会损坏会话，重读仍有完整成图记录', async () => {
    const { service } = await fixture({
      providerConfig: () => provider({ extraParams: '{"size":"auto"}' }),
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    await service.generate({ sessionId: created.value.id, prompt: '猫', options: OPTIONS });
    const read = await service.read(created.value.id);
    expect(read.ok).toBe(true);
    if (read.ok)
      expect(read.value.turns[0]).toMatchObject({
        status: 'completed',
        size: 'auto',
        image: { mimeType: 'image/png' },
      });
  });
  it.each([' 1024 X 1024 ', '1024×1024', '1024*1024'])(
    '额外尺寸 %s 规范化后持久化，失败历史仍可读',
    async (size) => {
      const { service } = await fixture({
        providerConfig: () => provider({ extraParams: JSON.stringify({ size }) }),
        generate: async () => ({ ok: false, error: 'unsupported', retryable: false }),
      });
      const created = await service.create();
      if (!created.ok) throw new Error('create failed');
      await service.generate({ sessionId: created.value.id, prompt: '猫', options: OPTIONS });
      const result = await service.read(created.value.id);
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.value.turns[0]).toMatchObject({ status: 'failed', size: '1024x1024' });
    }
  );
  it('create 在 userData/image-studio/<uuid>/ 下建会话，list 按更新时间倒序', async () => {
    let time = 1;
    const { service, root } = await fixture({ now: () => time++ });
    const first = await service.create();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.id).toMatch(UUID);
    expect(first.value).toMatchObject({
      title: '',
      imageCount: 0,
      turns: [],
      references: [],
    });
    expect((await lstat(path.join(root, first.value.id))).isDirectory()).toBe(true);
    expect((await lstat(path.join(root, first.value.id, 'session.json'))).isFile()).toBe(true);

    const second = await service.create();
    if (!second.ok) return;
    const listed = await service.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((row) => row.id)).toEqual([second.value.id, first.value.id]);
    expect(Object.keys(listed.value[0]).sort()).toEqual([
      'createdAt',
      'id',
      'imageCount',
      'title',
      'updatedAt',
    ]);
  });

  it('read 只接受 UUID，越界与会话不存在都拒绝', async () => {
    const { service } = await fixture();
    for (const bad of ['..', '../x', '/etc/passwd', '', 1, null]) {
      expect((await service.read(bad)).ok).toBe(false);
    }
    expect((await service.read(randomUUID())).ok).toBe(false);
  });

  it('会话目录被换成符号链接时不读写外部目录', async () => {
    const { service, root } = await fixture();
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const outside = await makeRoot();
    await writeFile(path.join(outside, 'session.json'), '{"version":1}', 'utf8');
    await rm(path.join(root, created.value.id), { recursive: true, force: true });
    await symlink(outside, path.join(root, created.value.id));
    expect((await service.read(created.value.id)).ok).toBe(false);
    const listed = await service.list();
    expect(listed.ok && listed.value.map((row) => row.id)).toEqual([]);
  });

  it('remove 删除整个会话目录，正在生成时拒绝删除', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, root } = await fixture({
      generate: async () => {
        await gate;
        return defaultGenerate();
      },
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    expect(await service.remove('..')).toEqual({ ok: false, error: expect.any(String) });
    const pending = service.generate({
      sessionId: created.value.id,
      prompt: '猫',
      options: OPTIONS,
    });
    await vi.waitFor(async () => {
      expect((await service.read(created.value.id)).ok).toBe(true);
    });
    expect((await service.remove(created.value.id)).ok).toBe(false);
    expect(existsSync(path.join(root, created.value.id))).toBe(true);
    release();
    await pending;
    expect(await service.remove(created.value.id)).toEqual({ ok: true, value: null });
    expect(existsSync(path.join(root, created.value.id))).toBe(false);
    expect((await service.read(created.value.id)).ok).toBe(false);
  });
});

describe('ImageStudioService · 变更广播', () => {
  it('create / importReference / remove 落盘后各广播一次，读取不广播', async () => {
    const { service, changed } = await fixture();
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    expect(changed).toHaveBeenCalledTimes(1);
    await service.read(created.value.id);
    await service.list();
    expect(changed).toHaveBeenCalledTimes(1);
    const source = path.join(await makeRoot(), 'pick.png');
    await writeFile(source, PNG);
    await service.importReference(created.value.id, source);
    expect(changed).toHaveBeenCalledTimes(2);
    await service.remove(created.value.id);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('running turn 落盘后立刻广播，界面不必等 300 秒请求结束', async () => {
    let runningSeen = 0;
    const { service, changed } = await fixture({
      generate: async (_input, cwd) => {
        // 请求进行中：running turn 必须已经落盘，并且广播过一次。
        runningSeen = changed.mock.calls.length;
        const stored = JSON.parse(await readFile(path.join(cwd, 'session.json'), 'utf8'));
        expect(stored.turns.at(-1).status).toBe('running');
        return defaultGenerate();
      },
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    await service.generate({
      sessionId: created.value.id,
      prompt: '一只猫',
      options: OPTIONS,
    });
    expect(runningSeen).toBe(2);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('生成前被拒绝时不广播，也不写 running', async () => {
    const { service, changed } = await fixture({ providerConfig: () => undefined });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    changed.mockClear();
    expect(
      (
        await service.generate({
          sessionId: created.value.id,
          prompt: '猫',
          options: OPTIONS,
        })
      ).ok
    ).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it('清理重启遗留 running 时广播，正在生成时的读取保持 running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, root, changed } = await fixture({
      generate: async () => {
        await gate;
        return defaultGenerate();
      },
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const file = path.join(root, created.value.id, 'session.json');
    const stored = JSON.parse(await readFile(file, 'utf8'));
    stored.turns = [
      { id: randomUUID(), prompt: '中断的猫', createdAt: 1, options: OPTIONS, status: 'running' },
    ];
    await writeFile(file, JSON.stringify(stored), 'utf8');
    changed.mockClear();
    const repaired = await service.read(created.value.id);
    expect(repaired.ok && repaired.value.turns[0].status).toBe('cancelled');
    expect(changed).toHaveBeenCalledTimes(1);

    const pending = service.generate({
      sessionId: created.value.id,
      prompt: '新的一张',
      options: OPTIONS,
    });
    await vi.waitFor(async () => {
      const live = await service.read(created.value.id);
      expect(live.ok && live.value.turns.at(-1)?.status).toBe('running');
    });
    // 在途 turn 不能被当成重启遗留改成 cancelled。
    const during = JSON.parse(await readFile(file, 'utf8'));
    expect(during.turns.at(-1).status).toBe('running');
    release();
    expect((await pending).ok).toBe(true);
  });
});

describe('ImageStudioService · 生成', () => {
  it('成功时先落 running 再落 completed，并记录本次实发尺寸', async () => {
    const writes: string[] = [];
    const { service, root, generate } = await fixture({
      generate: async (input, cwd) => {
        const id = randomUUID();
        await mkdir(path.join(cwd, '.xiaoman/images'), { recursive: true });
        await writeFile(path.join(cwd, imageFile(id)), PNG);
        writes.push(JSON.stringify(input));
        return { ok: true, image: { id, path: imageFile(id), mimeType: 'image/png' } };
      },
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const result = await service.generate({
      sessionId: created.value.id,
      prompt: '一只在窗台的猫',
      options: { ...OPTIONS, ratio: '16:9', resolution: '2k' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const turn = result.value.turns[0];
    expect(turn.status).toBe('completed');
    expect(turn.size).toBe('2048x1152');
    expect(turn.image?.id).toMatch(UUID);
    expect(turn.error).toBeUndefined();
    expect(result.value.title).toBe('一只在窗台的猫');
    expect(result.value.imageCount).toBe(1);
    expect(generate).toHaveBeenCalledTimes(1);
    // 工作目录是会话自己的目录，输入尺寸来自比例+分辨率。
    expect(generate.mock.calls[0][1]).toBe(await realpath(path.join(root, created.value.id)));
    expect(generate.mock.calls[0][2]).toMatchObject({
      apiKey: 'sk-super-secret-key',
      modelId: 'gpt-image-1',
      output: { sizeMode: '2k' },
    });
    expect(JSON.parse(writes[0]).size).toBe('2048x1152');
  });

  it('全 auto 时不编造 size，沿用 provider 默认输出参数', async () => {
    const { service } = await fixture({
      providerConfig: () => provider({ sizeMode: 'omit' }),
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const result = await service.generate({
      sessionId: created.value.id,
      prompt: '猫',
      options: OPTIONS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.turns[0].size).toBeUndefined();
  });

  it('未配置服务、模型不在独立 provider 列表、禁用图生图、坏入参都在写 running 前拒绝', async () => {
    const unconfigured = await fixture({ providerConfig: () => undefined });
    const created = await unconfigured.service.create();
    if (!created.ok) throw new Error('create failed');
    const sessionId = created.value.id;
    const request = { sessionId, prompt: '猫', options: OPTIONS };

    expect((await unconfigured.service.generate(request)).ok).toBe(false);

    const { service, generate } = await fixture({
      providerConfig: () => provider({ imageToImage: false }),
    });
    const usable = await service.create();
    if (!usable.ok) throw new Error('create failed');
    const cases: unknown[] = [
      { ...request, sessionId: usable.value.id, options: { ...OPTIONS, model: 'dall-e-9' } },
      { ...request, sessionId: usable.value.id, prompt: '   ' },
      { ...request, sessionId: usable.value.id, options: { ...OPTIONS, ratio: '5:4' } },
      { ...request, sessionId: usable.value.id, path: '/tmp/a.png' },
      { ...request, sessionId: usable.value.id, sourceImageId: randomUUID() },
    ];
    for (const raw of cases) expect((await service.generate(raw)).ok).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    const after = await service.read(usable.value.id);
    expect(after.ok && after.value.turns).toEqual([]);
    expect(unconfigured.generate).not.toHaveBeenCalled();
  });

  it('参考图必须是本会话已有图片 id，且不能与生成图串会话', async () => {
    const { service } = await fixture({ generate: defaultGenerate });
    const a = await service.create();
    const b = await service.create();
    if (!a.ok || !b.ok) throw new Error('create failed');
    const sourceImageId = randomUUID();
    expect(
      (
        await service.generate({
          sessionId: b.value.id,
          prompt: '改图',
          options: OPTIONS,
          sourceImageId,
        })
      ).ok
    ).toBe(false);
  });

  it('同一会话并发生成被拒绝，不会重复收费', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, generate } = await fixture({
      generate: async () => {
        await gate;
        return defaultGenerate();
      },
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const request = { sessionId: created.value.id, prompt: '猫', options: OPTIONS };
    const first = service.generate(request);
    const second = await service.generate(request);
    expect(second.ok).toBe(false);
    release();
    expect((await first).ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('取消真正中断请求，turn 标记 cancelled；失败不自动重试', async () => {
    const { service } = await fixture({
      generate: (_input, _cwd, _config, signal) =>
        new Promise<ImageGenerationResult>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const pending = service.generate({
      sessionId: created.value.id,
      prompt: '猫',
      options: OPTIONS,
    });
    await vi.waitFor(async () => {
      const current = await service.read(created.value.id);
      expect(current.ok && current.value.turns[0]?.status).toBe('running');
    });
    expect(await service.cancel(created.value.id)).toEqual({ ok: true, value: null });
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.turns[0]).toMatchObject({ status: 'cancelled' });
    expect(result.value.turns[0].image).toBeUndefined();
  });

  it('上游失败只请求一次，错误不泄露密钥', async () => {
    const { service, generate } = await fixture({
      generate: async () => ({
        ok: false,
        error: 'HTTP 401: bad sk-super-secret-key',
        retryable: false,
      }),
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const result = await service.generate({
      sessionId: created.value.id,
      prompt: '猫',
      options: OPTIONS,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.turns[0].status).toBe('failed');
    expect(result.value.turns[0].error).toBeTruthy();
    expect(result.value.turns[0].error).not.toContain('sk-super-secret-key');
  });

  it('重启遗留的 running turn 在读取时改成 cancelled 并落盘，不能伪完成', async () => {
    const { service, root } = await fixture();
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const file = path.join(root, created.value.id, 'session.json');
    const persisted = JSON.parse(await readFile(file, 'utf8'));
    persisted.turns = [
      {
        id: randomUUID(),
        prompt: '中断的猫',
        createdAt: 1,
        options: OPTIONS,
        status: 'running',
      },
    ];
    await writeFile(file, JSON.stringify(persisted), 'utf8');

    const read = await service.read(created.value.id);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.turns[0].status).toBe('cancelled');
    const stored = JSON.parse(await readFile(file, 'utf8'));
    expect(stored.turns[0].status).toBe('cancelled');
  });

  it('会话文件损坏或超限时拒绝读取，不覆盖原文件', async () => {
    const { service, root } = await fixture();
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const file = path.join(root, created.value.id, 'session.json');
    await writeFile(file, '{oops', 'utf8');
    expect((await service.read(created.value.id)).ok).toBe(false);
    await writeFile(file, JSON.stringify({ version: 1, pad: 'x'.repeat(2 * 1024 * 1024) }), 'utf8');
    expect((await service.read(created.value.id)).ok).toBe(false);
    expect(await readFile(file, 'utf8')).toContain('pad');
  });
});

describe('ImageStudioService · 参考图与图片读取', () => {
  it('importReference 复制用户选中的图片到本会话并记录 reference', async () => {
    const { service, root } = await fixture();
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const source = path.join(await makeRoot(), 'pick.png');
    await writeFile(source, PNG);
    const imported = await service.importReference(created.value.id, source);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value?.id).toMatch(UUID);
    expect(imported.value?.path).toBe(imageFile(imported.value?.id ?? ''));
    const copied = path.join(root, created.value.id, imageFile(imported.value?.id ?? ''));
    expect((await readFile(copied)).equals(PNG)).toBe(true);
    const read = await service.read(created.value.id);
    expect(read.ok && read.value.references).toHaveLength(1);
    expect(read.ok && read.value.imageCount).toBe(0);
  });

  it('非图片、非白名单魔数、超大文件都拒绝复制', async () => {
    const { service } = await fixture();
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const dir = await makeRoot();
    const text = path.join(dir, 'a.png');
    await writeFile(text, 'not an image');
    const bmp = path.join(dir, 'b.png');
    await writeFile(bmp, BMP);
    expect((await service.importReference(created.value.id, text)).ok).toBe(false);
    expect((await service.importReference(created.value.id, bmp)).ok).toBe(false);
    expect((await service.importReference(created.value.id, '/tmp')).ok).toBe(false);
    const read = await service.read(created.value.id);
    expect(read.ok && read.value.references).toEqual([]);
  });

  it('用户取消选图时返回 null', async () => {
    const { service } = await fixture();
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    expect(await service.importReference(created.value.id, null)).toEqual({
      ok: true,
      value: null,
    });
  });

  it('image 只按权威 turn/reference 记录 id 读取，未知 id 断言拒绝', async () => {
    const { service, root } = await fixture({
      generate: async (_input, cwd) => {
        const id = randomUUID();
        await mkdir(path.join(cwd, '.xiaoman/images'), { recursive: true });
        await writeFile(path.join(cwd, imageFile(id)), PNG);
        return { ok: true, image: { id, path: imageFile(id), mimeType: 'image/png' } };
      },
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const generated = await service.generate({
      sessionId: created.value.id,
      prompt: '猫',
      options: OPTIONS,
    });
    if (!generated.ok) throw new Error('generate failed');
    const imageId = generated.value.turns[0].image?.id ?? '';
    const loaded = await service.image(created.value.id, imageId);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.dataUrl).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect((await service.image(created.value.id, randomUUID())).ok).toBe(false);
    expect((await service.image(created.value.id, '../../etc/passwd')).ok).toBe(false);
    // 文件被删掉时不回填伪数据
    await rm(path.join(root, created.value.id, imageFile(imageId)));
    expect((await service.image(created.value.id, imageId)).ok).toBe(false);
  });

  it('权威记录指向的文件被换成外部符号链接时拒绝读取', async () => {
    const images: string[] = [];
    const { service, root } = await fixture({
      generate: async (_input, cwd) => {
        const id = randomUUID();
        images.push(id);
        await mkdir(path.join(cwd, '.xiaoman/images'), { recursive: true });
        await writeFile(path.join(cwd, imageFile(id)), PNG);
        return { ok: true, image: { id, path: imageFile(id), mimeType: 'image/png' } };
      },
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const generated = await service.generate({
      sessionId: created.value.id,
      prompt: '猫',
      options: OPTIONS,
    });
    if (!generated.ok) throw new Error('generate failed');
    const imageId = generated.value.turns[0].image?.id ?? '';
    const target = path.join(root, created.value.id, imageFile(imageId));
    const outside = path.join(await makeRoot(), 'secret.png');
    await writeFile(outside, PNG);
    await rm(target);
    await symlink(outside, target);
    expect((await service.image(created.value.id, imageId)).ok).toBe(false);
  });

  it('魔数与记录不一致时拒绝', async () => {
    const { service, root } = await fixture({
      generate: async (_input, cwd) => {
        const id = randomUUID();
        await mkdir(path.join(cwd, '.xiaoman/images'), { recursive: true });
        await writeFile(path.join(cwd, imageFile(id)), PNG);
        return { ok: true, image: { id, path: imageFile(id), mimeType: 'image/png' } };
      },
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const generated = await service.generate({
      sessionId: created.value.id,
      prompt: '猫',
      options: OPTIONS,
    });
    if (!generated.ok) throw new Error('generate failed');
    const imageId = generated.value.turns[0].image?.id ?? '';
    await writeFile(path.join(root, created.value.id, imageFile(imageId)), BMP);
    expect((await service.image(created.value.id, imageId)).ok).toBe(false);
  });
});

describe('ImageStudioService · 图片变体', () => {
  it('缺省读取原图，不调用缩略图', async () => {
    const thumbnail = vi.fn(() => 'data:image/png;base64,thumb');
    const { service, sessionId, imageId } = await withGeneratedPng({ thumbnail });
    const loaded = await service.image(sessionId, imageId);
    expect(loaded).toEqual({
      ok: true,
      value: { dataUrl: `data:image/png;base64,${PNG.toString('base64')}` },
    });
    const explicit = await service.image(sessionId, imageId, 'original');
    expect(explicit.ok).toBe(true);
    expect(thumbnail).not.toHaveBeenCalled();
  });

  it('thumb 交给缩略图实现，返回 PNG dataUrl', async () => {
    const thumbnail = vi.fn<(bytes: Buffer, mimeType: string) => string>(
      (bytes) => `data:image/png;base64,${bytes.toString('base64')}`
    );
    const { service, sessionId, imageId } = await withGeneratedPng({ thumbnail });
    const loaded = await service.image(sessionId, imageId, 'thumb');
    expect(loaded.ok).toBe(true);
    expect(thumbnail).toHaveBeenCalledTimes(1);
    expect(thumbnail.mock.calls[0][0].equals(PNG)).toBe(true);
    expect(thumbnail.mock.calls[0][1]).toBe('image/png');
    expect(loaded.ok && loaded.value.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('未知变体在读取文件前拒绝', async () => {
    const thumbnail = vi.fn(() => 'data:image/png;base64,thumb');
    const { service, sessionId, imageId } = await withGeneratedPng({ thumbnail });
    for (const bad of ['large', '', null, 3]) {
      expect((await service.image(sessionId, imageId, bad)).ok).toBe(false);
    }
    expect(thumbnail).not.toHaveBeenCalled();
  });

  it('默认缩略图实现返回 PNG data URL（nativeImage 桩）', async () => {
    const { service, sessionId, imageId } = await withGeneratedPng();
    const loaded = await service.image(sessionId, imageId, 'thumb');
    expect(loaded.ok).toBe(true);
    expect(loaded.ok && loaded.value.dataUrl).toBe(
      `data:image/png;base64,${PNG.toString('base64')}`
    );
  });
});

describe('ImageStudioService · 符号链接边界', () => {
  it('.xiaoman/images 被换成外部符号链接时拒绝读取', async () => {
    const { service, sessionId, imageId, sessionDir } = await withGeneratedPng();
    const outside = await makeRoot();
    await mkdir(path.join(outside, 'images'), { recursive: true });
    await writeFile(path.join(outside, 'images', path.basename(imageFile(imageId))), PNG);
    await rm(path.join(sessionDir, '.xiaoman/images'), { recursive: true, force: true });
    await symlink(path.join(outside, 'images'), path.join(sessionDir, '.xiaoman/images'));
    expect((await service.image(sessionId, imageId)).ok).toBe(false);
  });

  it('.xiaoman 被换成外部符号链接时拒绝读取', async () => {
    const { service, sessionId, imageId, sessionDir } = await withGeneratedPng();
    const outside = await makeRoot();
    await mkdir(path.join(outside, 'images'), { recursive: true });
    await writeFile(path.join(outside, 'images', path.basename(imageFile(imageId))), PNG);
    await rm(path.join(sessionDir, '.xiaoman'), { recursive: true, force: true });
    await symlink(outside, path.join(sessionDir, '.xiaoman'));
    expect((await service.image(sessionId, imageId)).ok).toBe(false);
  });

  it('会话内的受控符号链接（解析后仍在输出目录）允许', async () => {
    const { service, sessionId, imageId, sessionDir } = await withGeneratedPng();
    const target = path.join(sessionDir, imageFile(imageId));
    const moved = path.join(sessionDir, '.xiaoman/images', 'moved.png');
    await mkdir(path.join(sessionDir, '.xiaoman/images'), { recursive: true });
    await rm(target);
    await writeFile(moved, PNG);
    await symlink(moved, target);
    expect((await service.image(sessionId, imageId)).ok).toBe(true);
  });

  it('参考图被换成外部符号链接时拒绝读取', async () => {
    const { service, root, sessionId, sessionDir } = await withGeneratedPng();
    const source = path.join(await makeRoot(), 'pick.png');
    await writeFile(source, PNG);
    const imported = await service.importReference(sessionId, source);
    if (!imported.ok || !imported.value) throw new Error('import failed');
    const outside = path.join(await makeRoot(), 'secret.png');
    await writeFile(outside, PNG);
    const target = path.join(sessionDir, imported.value.path);
    expect(target.startsWith(path.join(root, sessionId))).toBe(true);
    await rm(target);
    await symlink(outside, target);
    expect((await service.image(sessionId, imported.value.id)).ok).toBe(false);
  });

  it('session.json 被换成符号链接时拒绝读取', async () => {
    const { service, sessionId, sessionDir } = await withGeneratedPng();
    const outside = path.join(await makeRoot(), 'session.json');
    await writeFile(
      outside,
      JSON.stringify({
        version: 1,
        id: sessionId,
        title: '',
        createdAt: 1,
        updatedAt: 1,
        turns: [],
        references: [],
      }),
      'utf8'
    );
    const file = path.join(sessionDir, 'session.json');
    await rm(file);
    await symlink(outside, file);
    expect((await service.read(sessionId)).ok).toBe(false);
  });
});

describe('ImageStudioService · 只覆盖本次请求', () => {
  it('每次生成的 options 不会写回全局 provider 配置', async () => {
    let current = provider();
    const snapshot = JSON.parse(JSON.stringify(current));
    const { service } = await fixture({ providerConfig: () => current });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    await service.generate({
      sessionId: created.value.id,
      prompt: '猫',
      options: { ...OPTIONS, quality: 'low', format: 'jpeg', resolution: '4k' },
    });
    expect(current).toEqual(snapshot);
    current = provider();
  });

  it('模型留空时回落到独立 provider 的第一个模型，并记进 turn', async () => {
    const { service, generate } = await fixture();
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    const result = await service.generate({
      sessionId: created.value.id,
      prompt: '猫',
      options: { ...OPTIONS, model: '' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(generate.mock.calls[0][2].modelId).toBe('gpt-image-1');
    expect(result.value.turns[0].options.model).toBe('gpt-image-1');
  });

  it('provider 没有可用模型时在写 running 前拒绝', async () => {
    const { service, generate } = await fixture({
      providerConfig: () => provider({ models: [] }),
    });
    const created = await service.create();
    if (!created.ok) throw new Error('create failed');
    expect(
      (
        await service.generate({
          sessionId: created.value.id,
          prompt: '猫',
          options: { ...OPTIONS, model: '' },
        })
      ).ok
    ).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    const after = await service.read(created.value.id);
    expect(after.ok && after.value.turns).toEqual([]);
  });
});
