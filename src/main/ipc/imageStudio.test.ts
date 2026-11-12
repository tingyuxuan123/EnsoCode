import type { GeneratedImage } from '@shared/imageGeneration';
import type {
  ImageStudioResult,
  ImageStudioSession,
  ImageStudioSummary,
} from '@shared/imageStudio';
import { IPC_CHANNELS } from '@shared/types/ipc';
import { describe, expect, it, vi } from 'vitest';
import type { ImageStudioService } from '../services/imageGeneration/studio';
import { createImageStudioHandlers } from './imageStudio';

vi.mock('../windows/MainWindow', () => ({ isMainWebContents: () => false }));
vi.mock('../windows/createAppWindow', () => ({ sendToAllWindows: vi.fn() }));
vi.mock('../services/imageGeneration/providerHost', () => ({ getImageProviderStore: vi.fn() }));

const frame = {};
const event = {
  sender: { id: 1, mainFrame: frame, getURL: () => 'http://localhost/index.html' },
  senderFrame: frame,
};

const session: ImageStudioSession = {
  id: '8f38ea6e-7f0f-4a47-9e57-2a5f8a24b0a1',
  title: '',
  createdAt: 1,
  updatedAt: 1,
  imageCount: 0,
  turns: [],
  references: [],
};

function fixture() {
  const service = {
    list: vi.fn(
      async (): Promise<ImageStudioResult<ImageStudioSummary[]>> => ({ ok: true, value: [] })
    ),
    create: vi.fn(async (): Promise<ImageStudioResult<ImageStudioSession>> => sessionResult()),
    read: vi.fn(
      async (_id?: unknown): Promise<ImageStudioResult<ImageStudioSession>> => sessionResult()
    ),
    generate: vi.fn(
      async (_request?: unknown): Promise<ImageStudioResult<ImageStudioSession>> => sessionResult()
    ),
    cancel: vi.fn(async (_id?: unknown): Promise<ImageStudioResult<null>> => ok(null)),
    importReference: vi.fn(
      async (
        _id?: unknown,
        _file?: string | null
      ): Promise<ImageStudioResult<GeneratedImage | null>> => ok(null)
    ),
    image: vi.fn(
      async (
        _id?: unknown,
        _imageId?: unknown,
        _variant?: unknown
      ): Promise<ImageStudioResult<{ dataUrl: string }>> =>
        ok({ dataUrl: 'data:image/png;base64,AA' })
    ),
    remove: vi.fn(async (_id?: unknown): Promise<ImageStudioResult<null>> => ok(null)),
  };
  const deps = {
    trusted: vi.fn(() => true),
    service: vi.fn(() => service as unknown as ImageStudioService),
    pickReference: vi.fn(async () => '/tmp/pick.png' as string | null),
  };
  return { service, deps, handlers: createImageStudioHandlers(deps) };
}

const ok = <T>(value: T): ImageStudioResult<T> => ({ ok: true, value });
const sessionResult = (): ImageStudioResult<ImageStudioSession> => ok(session);

describe('图片工作台 IPC', () => {
  it('非可信窗口在读写、弹窗、生成前被拒绝', async () => {
    const { handlers, deps } = fixture();
    deps.trusted.mockReturnValue(false);
    expect((await handlers.list(event)).ok).toBe(false);
    expect((await handlers.create(event)).ok).toBe(false);
    expect((await handlers.read(event, session.id)).ok).toBe(false);
    expect((await handlers.generate(event, {})).ok).toBe(false);
    expect((await handlers.cancel(event, session.id)).ok).toBe(false);
    expect((await handlers.importReference(event, session.id)).ok).toBe(false);
    expect((await handlers.image(event, session.id, session.id)).ok).toBe(false);
    expect((await handlers.remove(event, session.id)).ok).toBe(false);
    expect(deps.service).not.toHaveBeenCalled();
    expect(deps.pickReference).not.toHaveBeenCalled();
  });

  it('只把 unknown 入参原样交给服务校验，渲染层不能传路径', async () => {
    const { handlers, service } = fixture();
    const request = { sessionId: session.id, prompt: '猫', options: {}, path: '/etc/passwd' };
    await handlers.generate(event, request);
    expect(service.generate).toHaveBeenCalledWith(request);
    await handlers.read(event, '../x');
    expect(service.read).toHaveBeenCalledWith('../x');
    await handlers.image(event, '../x', '../../../etc/passwd');
    expect(service.image).toHaveBeenCalledWith('../x', '../../../etc/passwd', 'original');
    await handlers.cancel(event, session.id);
    expect(service.cancel).toHaveBeenCalledWith(session.id);
    await handlers.remove(event, session.id);
    expect(service.remove).toHaveBeenCalledWith(session.id);
  });

  it('无参方法拒绝多余入参，参考图要求恰好一个会话 id', async () => {
    const { handlers, service } = fixture();
    expect((await handlers.list(event, 'x')).ok).toBe(false);
    expect((await handlers.create(event, 'x')).ok).toBe(false);
    expect((await handlers.importReference(event)).ok).toBe(false);
    expect((await handlers.importReference(event, '../x')).ok).toBe(false);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
    expect(service.importReference).not.toHaveBeenCalled();
  });

  it('参考图只走 Main 弹窗，用户取消时不写记录', async () => {
    const { handlers, service, deps } = fixture();
    deps.pickReference.mockResolvedValueOnce(null);
    expect(await handlers.importReference(event, session.id)).toEqual({ ok: true, value: null });
    expect(service.importReference).not.toHaveBeenCalled();
    expect(deps.pickReference).toHaveBeenCalledTimes(1);
  });

  it('importReference 需要会话 id，成功后原样返回服务结果', async () => {
    const { handlers, service, deps } = fixture();
    const reference: GeneratedImage = {
      id: session.id,
      path: `.xiaoman/images/${session.id}.png`,
      mimeType: 'image/png',
    };
    service.importReference.mockResolvedValueOnce({ ok: true, value: reference });
    expect(await handlers.importReference(event, session.id)).toEqual({
      ok: true,
      value: reference,
    });
    expect(deps.pickReference).toHaveBeenCalledTimes(1);
    expect(service.importReference).toHaveBeenCalledWith(session.id, '/tmp/pick.png');
  });

  it('写操作各调用服务一次，广播由服务在落盘后负责', async () => {
    const { handlers, service } = fixture();
    await handlers.read(event, session.id);
    await handlers.image(event, session.id, session.id);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.generate).not.toHaveBeenCalled();
    await handlers.create(event);
    await handlers.generate(event, {});
    await handlers.cancel(event, session.id);
    await handlers.remove(event, session.id);
    for (const operation of [service.create, service.generate, service.cancel, service.remove]) {
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });

  it('失败结果原样返回，不把异常抛过 IPC 边界', async () => {
    const { handlers, service } = fixture();
    service.generate.mockRejectedValueOnce(new Error('boom'));
    service.create.mockResolvedValueOnce({ ok: false, error: '无法创建图片会话。' });
    expect(await handlers.create(event)).toEqual({ ok: false, error: '无法创建图片会话。' });
    expect((await handlers.generate(event, {})).ok).toBe(false);
  });

  it('通道常量齐全且成对', () => {
    expect(IPC_CHANNELS.IMAGE_STUDIO_LIST).toBe('image-studio:list');
    expect(IPC_CHANNELS.IMAGE_STUDIO_CREATE).toBe('image-studio:create');
    expect(IPC_CHANNELS.IMAGE_STUDIO_READ).toBe('image-studio:read');
    expect(IPC_CHANNELS.IMAGE_STUDIO_GENERATE).toBe('image-studio:generate');
    expect(IPC_CHANNELS.IMAGE_STUDIO_CANCEL).toBe('image-studio:cancel');
    expect(IPC_CHANNELS.IMAGE_STUDIO_IMPORT_REFERENCE).toBe('image-studio:import-reference');
    expect(IPC_CHANNELS.IMAGE_STUDIO_IMAGE).toBe('image-studio:image');
    expect(IPC_CHANNELS.IMAGE_STUDIO_REMOVE).toBe('image-studio:remove');
    expect(IPC_CHANNELS.IMAGE_STUDIO_CHANGED).toBe('image-studio:changed');
  });

  it('image 变体：缺省 original、thumb 透传、非法变体与多余入参拒绝', async () => {
    const { handlers, service } = fixture();
    await handlers.image(event, session.id, session.id);
    expect(service.image).toHaveBeenLastCalledWith(session.id, session.id, 'original');
    await handlers.image(event, session.id, session.id, 'thumb');
    expect(service.image).toHaveBeenLastCalledWith(session.id, session.id, 'thumb');
    await handlers.image(event, session.id, session.id, 'original');
    expect(service.image).toHaveBeenLastCalledWith(session.id, session.id, 'original');
    const calls = service.image.mock.calls.length;
    expect((await handlers.image(event, session.id, session.id, 'large')).ok).toBe(false);
    expect((await handlers.image(event, session.id, session.id, null)).ok).toBe(false);
    expect((await handlers.image(event, session.id, session.id, 'thumb', 'extra')).ok).toBe(false);
    expect((await handlers.image(event, session.id)).ok).toBe(false);
    expect(service.image.mock.calls.length).toBe(calls);
  });
});
