// @vitest-environment happy-dom
import type { ImageStudioSession } from '@shared/imageStudio';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_MIN_WIDTH,
  SIDE_PANEL_HANDLE_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
} from '@/stores/sidePanel/width';
import { useImageStudioStore } from './store';

const options = {
  count: 1,
  model: 'gpt-image-1',
  ratio: 'auto',
  resolution: 'auto',
  quality: 'auto',
  format: 'auto',
} as const;
const session = (id: string) => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  imageCount: 0,
  turns: [],
  references: [],
});
const acceptedSession = (
  id: string,
  status: 'running' | 'completed' | 'failed' = 'running'
): ImageStudioSession => ({
  ...session(id),
  updatedAt: 2,
  turns: [{ id: 'accepted-turn', prompt: '一只猫', createdAt: 2, options, status }],
});
const api = {
  list: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  generate: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  importReference: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { imageStudio: api } });
  useImageStudioStore.setState({
    summaries: [],
    sessions: { a: session('a') },
    activeId: null,
    loading: false,
    error: '',
    pending: {},
    drafts: {},
    sources: {},
  });
});
describe('独立生图会话投影', () => {
  it('尚未读到会话历史时不发送，也不把同文旧历史当作接受', async () => {
    useImageStudioStore.setState({ sessions: {} });
    const store = useImageStudioStore.getState();
    store.setDraft('a', '一只猫');
    await store.generate('a', options);
    expect(api.generate).not.toHaveBeenCalled();
    expect(useImageStudioStore.getState().drafts.a).toBe('一只猫');
  });
  it('主进程确认 running 后立即清空，不等生图完成；后续回包不清新草稿', async () => {
    let finish!: (value: unknown) => void;
    api.generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    useImageStudioStore.setState({ activeId: 'a', sessions: { a: session('a') } });
    const store = useImageStudioStore.getState();
    store.setDraft('a', '一只猫');
    const pending = store.generate('a', options);
    expect(useImageStudioStore.getState().drafts.a).toBe('一只猫');
    api.read.mockResolvedValue({ ok: true, value: acceptedSession('a') });
    await store.select('a');
    expect(useImageStudioStore.getState().pending.a).toBe(true);
    expect(useImageStudioStore.getState().drafts.a).toBe('');
    store.setDraft('a', '一只猫'); // 用户重新输入同样文字，也属于一份新草稿。
    await store.select('a');
    finish({ ok: true, value: acceptedSession('a', 'completed') });
    await pending;
    expect(useImageStudioStore.getState().drafts.a).toBe('一只猫');
  });
  it('接受确认之前用户重写草稿或换参考图，不被迟到确认清空', async () => {
    let finish!: (value: unknown) => void;
    api.generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    useImageStudioStore.setState({ sessions: { a: session('a') } });
    const store = useImageStudioStore.getState();
    store.setDraft('a', '一只猫');
    store.setSource('a', 'source-old');
    const pending = store.generate('a', options);
    store.setDraft('a', '一只猫');
    store.setSource('a', 'source-new');
    const confirmed = acceptedSession('a');
    confirmed.turns[0] = { ...confirmed.turns[0], sourceImageId: 'source-old' };
    api.read.mockResolvedValue({ ok: true, value: confirmed });
    await store.select('a');
    expect(useImageStudioStore.getState().drafts.a).toBe('一只猫');
    expect(useImageStudioStore.getState().sources.a).toBe('source-new');
    finish({
      ok: true,
      value: { ...confirmed, turns: [{ ...confirmed.turns[0], status: 'completed' }] },
    });
    await pending;
    expect(useImageStudioStore.getState().sources.a).toBe('source-new');
  });
  it('切换到其他会话仍按原会话接受确认清理，不能清掉当前会话草稿', async () => {
    let finish!: (value: unknown) => void;
    api.generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    useImageStudioStore.setState({ sessions: { a: session('a'), b: session('b') } });
    const store = useImageStudioStore.getState();
    store.setDraft('a', '一只猫');
    store.setDraft('b', '另一份草稿');
    store.setSource('a', 'source-old');
    const pending = store.generate('a', options);
    api.read.mockResolvedValueOnce({ ok: true, value: session('b') });
    await store.select('b');
    const confirmed = acceptedSession('a', 'failed');
    confirmed.turns[0] = { ...confirmed.turns[0], sourceImageId: 'source-old' };
    finish({ ok: true, value: confirmed });
    await pending;
    expect(useImageStudioStore.getState().activeId).toBe('b');
    expect(useImageStudioStore.getState().drafts.a).toBe('');
    expect(useImageStudioStore.getState().sources.a).toBeUndefined();
    expect(useImageStudioStore.getState().drafts.b).toBe('另一份草稿');
  });
  it('旧历史中相同提示词不是本次接受确认', async () => {
    const old = acceptedSession('a', 'completed');
    let finish!: (value: unknown) => void;
    api.generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    useImageStudioStore.setState({ sessions: { a: old } });
    const store = useImageStudioStore.getState();
    store.setDraft('a', '一只猫');
    const pending = store.generate('a', options);
    api.read.mockResolvedValue({ ok: true, value: old });
    await store.select('a');
    expect(useImageStudioStore.getState().drafts.a).toBe('一只猫');
    finish({ ok: false, error: '拒绝' });
    await pending;
    expect(useImageStudioStore.getState().drafts.a).toBe('一只猫');
  });
  it('历史宽度复用 Code 约束，从可见宽度拖拽并记住用户偏好', () => {
    useImageStudioStore.setState({ historyWidth: 380 });
    useImageStudioStore.getState().nudgeHistoryWidth(80, 1000);
    expect(useImageStudioStore.getState().historyWidth).toBe(460);
    expect(localStorage.getItem('enso-image-studio-history-width')).toBe('460');
    const narrow = 700;
    // 不是从不可见的 460 开始反向拉，而是从窗口能容纳的 339 开始。
    useImageStudioStore.getState().nudgeHistoryWidth(-10, narrow);
    expect(useImageStudioStore.getState().historyWidth).toBe(
      narrow - CHAT_MIN_WIDTH - SIDE_PANEL_HANDLE_WIDTH - 10
    );
    useImageStudioStore.getState().nudgeHistoryWidth(-1000, 1000);
    expect(useImageStudioStore.getState().historyWidth).toBe(SIDE_PANEL_MIN_WIDTH);
  });
  it('迟到的旧读取不能覆盖刚完成的成图结果', async () => {
    let resolve!: (value: unknown) => void;
    api.read.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const selecting = useImageStudioStore.getState().select('a');
    const completed = { ...session('a'), title: '已生成', updatedAt: 2 };
    api.generate.mockResolvedValue({ ok: true, value: completed });
    useImageStudioStore.getState().setDraft('a', '一只猫');
    await useImageStudioStore.getState().generate('a', options);
    resolve({ ok: true, value: session('a') });
    await selecting;
    expect(useImageStudioStore.getState().sessions.a.title).toBe('已生成');
  });
  it('切换会话时迟到的读取不会抢回当前选择', async () => {
    let resolve!: (value: unknown) => void;
    api.read.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    api.read.mockResolvedValueOnce({ ok: true, value: session('b') });
    const first = useImageStudioStore.getState().select('a');
    await useImageStudioStore.getState().select('b');
    resolve({ ok: true, value: session('a') });
    await first;
    expect(useImageStudioStore.getState().activeId).toBe('b');
    expect(useImageStudioStore.getState().sessions.a.id).toBe('a');
  });
  it('未选模型/空提示词在调用前拒绝，不清空草稿或制造消息', async () => {
    const store = useImageStudioStore.getState();
    store.setDraft('a', '保留草稿');
    await store.generate('a', { ...options, model: '' });
    expect(api.generate).not.toHaveBeenCalled();
    expect(useImageStudioStore.getState().drafts.a).toBe('保留草稿');
    store.setDraft('a', '  ');
    await store.generate('a', options);
    expect(api.generate).not.toHaveBeenCalled();
    expect(useImageStudioStore.getState().sessions.a.turns).toEqual([]);
  });
  it('同一会话在途拒绝重复收费，失败保留原草稿且不会自动重试', async () => {
    let resolve!: (value: unknown) => void;
    api.generate.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const store = useImageStudioStore.getState();
    store.setDraft('a', '一只猫');
    const first = store.generate('a', options);
    await store.generate('a', options);
    expect(api.generate).toHaveBeenCalledTimes(1);
    resolve({ ok: false, error: '未配置图片服务' });
    await first;
    expect(useImageStudioStore.getState().drafts.a).toBe('一只猫');
    expect(useImageStudioStore.getState().pending.a).toBeUndefined();
    expect(useImageStudioStore.getState().error).toBe('未配置图片服务');
    expect(api.generate).toHaveBeenCalledTimes(1);
  });
  it('生成完成后不覆盖在途期间用户新写的草稿', async () => {
    let resolve!: (value: unknown) => void;
    api.generate.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const store = useImageStudioStore.getState();
    store.setDraft('a', '第一张');
    const first = store.generate('a', options);
    store.setDraft('a', '下一张');
    resolve({ ok: true, value: session('a') });
    await first;
    expect(useImageStudioStore.getState().drafts.a).toBe('下一张');
    expect(useImageStudioStore.getState().sessions.a).toEqual(session('a'));
  });
  it('参考图只传已授权图片 id，切换会话不串引用', async () => {
    api.generate.mockResolvedValue({ ok: true, value: session('a') });
    const store = useImageStudioStore.getState();
    store.setDraft('a', '改成水彩');
    store.setSource('a', 'image-id');
    await store.generate('a', options);
    expect(api.generate).toHaveBeenCalledWith({
      sessionId: 'a',
      prompt: '改成水彩',
      options,
      sourceImageId: 'image-id',
    });
    expect(useImageStudioStore.getState().sources.b).toBeUndefined();
  });
});
