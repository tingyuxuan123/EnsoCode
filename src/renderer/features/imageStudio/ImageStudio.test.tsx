// @vitest-environment happy-dom

import { DEFAULT_IMAGE_STUDIO_OPTIONS, type ImageStudioTurn } from '@shared/imageStudio';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageStudio } from './ImageStudio';
import { useImageStudioStore } from './store';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: object) => unknown) => select({ keybindings: {} }),
}));
const provider = vi.hoisted(() => ({
  view: { hasApiKey: true, config: { models: ['actual-image-model'], imageToImage: true } },
  error: '',
}));
vi.mock('@/components/settings/useImageProviderSettings', () => ({
  useImageProviderSettings: () => provider,
}));
vi.mock('./StudioImage', () => ({
  StudioImage: () => <figure data-testid="result" />,
  StudioThumbnail: () => <span />,
}));
vi.mock('./StudioSettings', () => ({
  StudioSettings: ({ open }: { open: boolean }) =>
    open ? <div data-testid="drawing-settings" /> : null,
}));
const api = {
  list: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  generate: vi.fn(),
  onChanged: vi.fn((_callback: () => void) => () => {}),
  cancel: vi.fn(),
};
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const onResize = vi.fn();
const onHistoryResize = vi.fn();
const onHistoryResizingChange = vi.fn();
const workspaceRef = createRef<HTMLDivElement>();
const measurements = new Set<() => void>();
beforeEach(async () => {
  vi.clearAllMocks();
  measurements.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private measure: () => void) {
        measurements.add(measure);
      }
      observe() {}
      disconnect() {
        measurements.delete(this.measure);
      }
    }
  );
  api.list.mockResolvedValue({ ok: true, value: [] });
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { imageStudio: api, window: { setTrafficLightsVisible: vi.fn() } },
  });
  Element.prototype.scrollIntoView = vi.fn();
  provider.view.hasApiKey = true;
  useImageStudioStore.setState({
    activeId: null,
    sessions: {},
    summaries: [],
    drafts: {},
    sources: {},
    pending: {},
    error: '',
    historyOpen: false,
    historyWidth: 360,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <ImageStudio
        collapsed={false}
        sidebarWidth={296}
        onResize={onResize}
        onHistoryResize={onHistoryResize}
        onHistoryResizingChange={onHistoryResizingChange}
        workspaceRef={workspaceRef}
      />
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
describe('图片工作台交互', () => {
  it.each([false, true])(
    '生图/改图直接使用聊天现有黑白蓝动画，完成、失败或取消后移除，editing=%s',
    async (editing) => {
      const turn: ImageStudioTurn = {
        id: 'turn',
        prompt: '画一只猫',
        createdAt: 1,
        options: { ...DEFAULT_IMAGE_STUDIO_OPTIONS, model: 'actual-image-model' },
        status: 'running',
        ...(editing ? { sourceImageId: 'reference' } : {}),
      };
      const setTurn = (value: ImageStudioTurn) =>
        useImageStudioStore.setState({
          activeId: 'animation',
          sessions: {
            animation: {
              id: 'animation',
              title: '动画',
              createdAt: 1,
              updatedAt: 1,
              imageCount: 0,
              references: [],
              turns: [value],
            },
          },
        });
      await act(async () => setTurn(turn));
      const loading = container.querySelector('[data-slot=image-generation-loading]');
      expect(loading).not.toBeNull();
      expect(loading?.getAttribute('aria-label')).toBe(
        editing ? 'Editing image…' : 'Generating image…'
      );
      expect(loading?.querySelectorAll('.imagegen-blob-ripple')).toHaveLength(5);
      expect(loading?.querySelector('.imagegen-blob-spin')).not.toBeNull();
      expect(loading?.querySelector('.imagegen-pulse')).not.toBeNull();
      for (const status of ['completed', 'failed', 'cancelled'] as const) {
        await act(async () => setTurn({ ...turn, status }));
        expect(container.querySelector('[data-slot=image-generation-loading]')).toBeNull();
      }
    }
  );
  it('多图逐张生成时保留已出图，只给当前未完成的一张展示同款动画', async () => {
    const image = { id: 'generated', path: '.xiaoman/images/generated.png', mimeType: 'image/png' };
    const turn: ImageStudioTurn = {
      id: 'turn',
      prompt: '三张猫咪',
      createdAt: 1,
      options: { ...DEFAULT_IMAGE_STUDIO_OPTIONS, model: 'actual-image-model', count: 3 },
      status: 'running',
      images: [image],
    };
    await act(async () =>
      useImageStudioStore.setState({
        activeId: 'batch',
        sessions: {
          batch: {
            id: 'batch',
            title: '三张猫咪',
            createdAt: 1,
            updatedAt: 1,
            imageCount: 1,
            references: [],
            turns: [turn],
          },
        },
      })
    );
    expect(container.querySelectorAll('[data-testid=result]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot=image-generation-loading]')).toHaveLength(1);
  });
  it('发送被 Main 接受后输入框在生成期间即清空，下一份草稿不被完成回包清掉', async () => {
    const options = {
      count: 1,
      model: 'actual-image-model',
      ratio: 'auto',
      resolution: 'auto',
      quality: 'auto',
      format: 'auto',
    } as const;
    const base = {
      id: 'send-session',
      title: '',
      createdAt: 1,
      updatedAt: 1,
      imageCount: 0,
      turns: [],
      references: [],
    };
    const confirmed = {
      ...base,
      title: '已发送',
      updatedAt: 2,
      turns: [
        { id: 'accepted', prompt: '第一张', createdAt: 2, options, status: 'running' as const },
      ],
    };
    let finish!: (value: unknown) => void;
    api.generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    api.list.mockResolvedValue({ ok: true, value: [confirmed] });
    api.read.mockResolvedValue({ ok: true, value: confirmed });
    await act(async () => {
      useImageStudioStore.setState({ activeId: base.id, sessions: { [base.id]: base } });
      useImageStudioStore.getState().setDraft(base.id, '第一张');
    });
    await act(async () => button('Generate image').click());
    expect(container.querySelector('textarea')?.value).toBe('第一张');
    await act(async () => {
      api.onChanged.mock.calls[0][0]();
    });
    expect(container.querySelector('textarea')?.value).toBe('');
    expect(button('Stop generating')).not.toBeNull();
    await act(async () => {
      useImageStudioStore.getState().setDraft(base.id, '下一张');
      finish({
        ok: true,
        value: { ...confirmed, turns: [{ ...confirmed.turns[0], status: 'completed' }] },
      });
    });
    expect(container.querySelector('textarea')?.value).toBe('下一张');
  });
  it('输入框不显示字数计数，仍保留最大输入长度限制', async () => {
    await act(async () => useImageStudioStore.getState().setDraft('', 'abc'));
    const composer = container.querySelector('[data-slot=composer]')!;
    expect(composer.textContent).not.toContain('3 / 16000');
    expect(composer.querySelector('textarea')?.maxLength).toBe(16000);
  });
  it('窗口变窄按 Code 的最小聊天宽度限制历史显示，不抹掉用户偏好', async () => {
    const workspace = workspaceRef.current!;
    await act(async () => {
      useImageStudioStore.setState({ historyOpen: true, historyWidth: 460 });
      Object.defineProperty(workspace, 'clientWidth', { configurable: true, value: 700 });
      measurements.forEach((measure) => {
        measure();
      });
    });
    const history = container.querySelector<HTMLElement>('[data-slot=image-studio-history]')!;
    expect(history.style.width).toBe('339px');
    expect(useImageStudioStore.getState().historyWidth).toBe(460);
    await act(async () => {
      Object.defineProperty(workspace, 'clientWidth', { configurable: true, value: 1200 });
      measurements.forEach((measure) => {
        measure();
      });
    });
    expect(history.style.width).toBe('460px');
  });
  it('与 Code 同款手柄连接左右两侧：拖动报告实际增量，关闭历史不残留右手柄', async () => {
    await act(async () => useImageStudioStore.setState({ historyOpen: true }));
    const hits = container.querySelectorAll('[data-slot=resize-hit]');
    expect(hits).toHaveLength(2);
    await act(async () => {
      hits[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 296 }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 346 }));
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(onResize).toHaveBeenCalledWith(50);
    await act(async () => {
      hits[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 900 }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 830 }));
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(onHistoryResize).toHaveBeenCalledWith(-70);
    expect(onHistoryResizingChange.mock.calls.map(([value]) => value)).toEqual([true, false]);
    await act(async () => useImageStudioStore.setState({ historyOpen: false }));
    expect(container.querySelectorAll('[data-slot=resize-hit]')).toHaveLength(1);
  });
  it('折叠左侧时移除其拖拽手柄，历史面板仍可单独拖动', async () => {
    await act(async () => {
      useImageStudioStore.setState({ historyOpen: true });
      root.render(
        <ImageStudio
          collapsed
          sidebarWidth={346}
          onResize={onResize}
          onHistoryResize={onHistoryResize}
          onHistoryResizingChange={onHistoryResizingChange}
          workspaceRef={workspaceRef}
        />
      );
    });
    expect(container.querySelector('[data-slot=image-studio-sidebar]')).toBeNull();
    expect(container.querySelectorAll('[data-slot=resize-hit]')).toHaveLength(1);
  });
  it('示例仅填入提示词，不能因为点击建议就发起收费请求', async () => {
    const suggestion = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('A watercolor cat')
    )!;
    await act(async () => suggestion.click());
    expect(container.querySelector('textarea')?.value).toBe('A watercolor cat in the afternoon');
    expect(api.create).not.toHaveBeenCalled();
    expect(api.generate).not.toHaveBeenCalled();
    expect(button('Generate image').disabled).toBe(false);
  });
  it('多图批次只显示一条提示词，全部成图进入时间线和历史，并显示真实进度', async () => {
    const image = (id: string) => ({
      id,
      path: `.xiaoman/images/${id}.png`,
      mimeType: 'image/png',
    });
    await act(async () =>
      useImageStudioStore.setState({
        activeId: 'batch',
        sessions: {
          batch: {
            id: 'batch',
            title: 'cats',
            createdAt: 1,
            updatedAt: 2,
            imageCount: 2,
            references: [],
            turns: [
              {
                id: 'turn',
                prompt: 'cats',
                createdAt: 1,
                options: {
                  count: 3,
                  model: 'actual-image-model',
                  ratio: 'auto',
                  resolution: 'auto',
                  quality: 'auto',
                  format: 'auto',
                },
                status: 'running',
                images: [image('a'), image('b')],
              },
            ],
          },
        },
      })
    );
    expect(container.querySelectorAll('[data-testid=result]')).toHaveLength(2);
    expect(container.querySelector('[data-slot=studio-timeline]')?.textContent).toContain('2 / 3');
    expect(
      container.querySelector('[data-slot=studio-timeline]')?.textContent?.match(/cats/g)
    ).toHaveLength(1);
  });
  it('未配置图片服务时不能提交，不借用聊天模型凭证', async () => {
    provider.view.hasApiKey = false;
    await act(async () => useImageStudioStore.getState().setDraft('', 'test'));
    expect(button('Generate image').disabled).toBe(true);
    await act(async () => button('Generate image').click());
    expect(api.generate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Configure image service');
  });
  it('画图与模型、档位都进入同一个参数浮层', async () => {
    const draw = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'Draw'
    )!;
    await act(async () => draw.click());
    expect(container.querySelector('[data-testid=drawing-settings]')).not.toBeNull();
    expect(container.textContent).toContain('actual-image-model');
  });
  it('输入框回车创建独立会话并传递真实模型，Shift+Enter不发送', async () => {
    const value = {
      id: 'new-session',
      title: '',
      createdAt: 1,
      updatedAt: 1,
      imageCount: 0,
      turns: [],
      references: [],
    };
    api.create.mockResolvedValue({ ok: true, value });
    api.generate.mockResolvedValue({ ok: true, value });
    await act(async () => useImageStudioStore.getState().setDraft('', '小猫'));
    const input = container.querySelector('textarea')!;
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
      );
    });
    expect(api.generate).not.toHaveBeenCalled();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(api.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'new-session',
        prompt: '小猫',
        options: expect.objectContaining({ model: 'actual-image-model' }),
      })
    );
    expect(api.generate).toHaveBeenCalledOnce();
  });
});

/**
 * 图片工作台是独立路由（App 按 studioActive 整块替换工作区），不该在绘图区上方再复制一份
 * Code 的通用工作区行：那行「主会话 / 图片工作台 / 新建 + 就绪胶囊」会白占 44px 高度和一条边框。
 * 这里只断言可观察结构：通用行元素不存在、绘图区第一块就是空态或时间线、生图自己的侧栏仍在。
 */
describe('图片工作台不再复制 Code 的通用工作区行', () => {
  const existing = {
    id: 'existing',
    title: '既有图片会话',
    createdAt: 1,
    updatedAt: 2,
    imageCount: 1,
    references: [],
    turns: [
      {
        id: 'turn',
        prompt: '既有的猫',
        createdAt: 1,
        options: { ...DEFAULT_IMAGE_STUDIO_OPTIONS, model: 'actual-image-model' },
        status: 'completed' as const,
        images: [{ id: 'image', path: '.xiaoman/images/image.png', mimeType: 'image/png' }],
      },
    ],
  };

  it('空态下没有 主会话 / 图片工作台 / 就绪 整行，绘图区直接从顶栏下方开始', () => {
    expect(container.textContent).not.toContain('Main session');
    expect(container.querySelector('button[aria-label="Close image studio"]')).toBeNull();
    // provider.view 已配置：旧实现这里一定是 Ready 胶囊，现在不该再出现。
    expect(container.textContent).not.toContain('Ready');
    const main = container.querySelector('main')!;
    expect(main.firstElementChild?.textContent).toContain('What would you like to draw today?');
  });

  it('已有图片会话时第一块就是时间线，生图自己的侧栏头部 / 搜索 / 新建仍在', async () => {
    await act(async () =>
      useImageStudioStore.setState({
        activeId: existing.id,
        sessions: { [existing.id]: existing },
        summaries: [
          {
            id: existing.id,
            title: existing.title,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
            imageCount: existing.imageCount,
          },
        ],
      })
    );
    const main = container.querySelector('main')!;
    expect(main.firstElementChild?.getAttribute('data-slot')).toBe('studio-timeline');
    expect(container.textContent).not.toContain('Main session');
    expect(container.textContent).not.toContain('Ready');
    const sidebar = container.querySelector('[data-slot=image-studio-sidebar]')!;
    expect(sidebar.textContent).toContain('Conversations');
    expect(sidebar.textContent).toContain('Recent');
    expect(sidebar.querySelector('button[aria-label="Search conversations"]')).not.toBeNull();
    expect(
      [...sidebar.querySelectorAll('button')].some((item) =>
        item.textContent?.includes('New conversation')
      )
    ).toBe(true);
  });

  it('既有会话仍能从左侧列表选中，新建会话仍走 Main 创建', async () => {
    api.read.mockResolvedValue({ ok: true, value: existing });
    await act(async () =>
      useImageStudioStore.setState({
        summaries: [
          {
            id: existing.id,
            title: existing.title,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
            imageCount: existing.imageCount,
          },
        ],
      })
    );
    const row = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
      item.textContent?.includes('既有图片会话')
    )!;
    await act(async () => row.click());
    expect(api.read).toHaveBeenCalledWith('existing');
    expect(container.querySelector('[data-slot=studio-timeline]')?.textContent).toContain(
      '既有的猫'
    );
    expect(container.querySelector('button[aria-label="Close image studio"]')).toBeNull();

    api.create.mockResolvedValue({
      ok: true,
      value: { ...existing, id: 'fresh', title: '', turns: [], imageCount: 0 },
    });
    const create = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.includes('New conversation') && item !== row
    )!;
    await act(async () => create.click());
    expect(api.create).toHaveBeenCalledOnce();
    expect(useImageStudioStore.getState().activeId).toBe('fresh');
  });
});
