// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesignRegistry } from '@/features/design/host/registry';
import { GALLERY_VIEW_ID } from '@/features/design/vetta/src/tab-ids';
import { useImageStudioStore } from '@/features/imageStudio/store';
import { useAppModeStore } from '@/stores/bots/mode';
import { useRemoteNodesStore } from '@/stores/remoteNodes';
import { useSettingsStore } from '@/stores/settings';
import { useSidebarStore } from '@/stores/sidebar';
import App from './App';

/**
 * Code / Bot 是工作模式，入口固定在主标题栏右上角，左侧图标轨只留功能导航。
 * 这里挂真实 App + 真实 TitleBar / AppRail / ModeSwitch，其余重型子页面换成标记，
 * 验证入口位置、两种模式切换、从设计画廊 / 生图回到 Code 对话以及既有门控。
 */
const shell = vi.hoisted(() => {
  const placeholder: unknown = new Proxy(() => {}, {
    get: (_target, key) => {
      if (key === 'then')
        return (resolve: (value: unknown) => void) => {
          resolve?.(undefined);
          return placeholder;
        };
      if (key === 'catch' || key === 'finally') return () => placeholder;
      return placeholder;
    },
    apply: () => placeholder,
  });
  const withFallback = (target: object): unknown =>
    new Proxy(target, {
      get: (inner, key) => {
        if (key === 'then') return undefined;
        const own = Reflect.get(inner, key);
        if (own === undefined) return placeholder;
        return typeof own === 'object' && own !== null && !Array.isArray(own)
          ? withFallback(own)
          : own;
      },
    });
  const api = withFallback({
    env: { platform: 'darwin' },
    settings: { read: async () => ({}), writeKey: async () => {} },
    sourceAuthority: {
      read: async () => ({ projects: [], conversations: [] }),
      onChanged: () => () => {},
    },
    nodes: { list: async () => ({ nodes: shell.remoteNodes, secureStorage: true }) },
    memory: { pendingWrites: async () => [], onChanged: () => () => {} },
    // Bot 模式开启后 App 会订阅 Bot store；空回包足够，别让真实请求落到主进程。
    bots: {
      list: async () => ({ ok: false }),
      chats: async () => ({ ok: false }),
      delegations: async () => ({ ok: false }),
      usage: async () => ({ ok: false }),
      inbox: { list: async () => ({ ok: false }) },
      routines: { list: async () => ({ ok: false }) },
      onEvent: () => () => {},
    },
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return {
    /** 远程节点用例按需填入；空数组时刷新会保持本机。 */
    remoteNodes: [] as { nodeId: string; hostOnline: boolean }[],
    sidebar: { width: undefined as number | undefined, collapsed: false, mounts: 0 },
    botView: null as { sidebarWidth?: number; collapsed?: boolean } | null,
    mark: (slot: string) => () => <div data-slot={slot} />,
  };
});

vi.mock('framer-motion', () => {
  const passthrough = (tag: string) => (props: Record<string, unknown>) => {
    const { children, layoutId, initial, animate, exit, transition, ...rest } = props;
    void layoutId;
    void initial;
    void animate;
    void exit;
    void transition;
    return createElement(tag, rest, children as ReactNode);
  };
  const tags = new Proxy({} as Record<string, ReturnType<typeof passthrough>>, {
    get: (_target, tag: string) => passthrough(tag),
  });
  return {
    motion: tags,
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    useReducedMotion: () => true,
  };
});
vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, tNode: (key: string) => key, locale: 'en' }),
}));
vi.mock('@/components/chat/Sidebar', () => ({
  Sidebar: (props: { width?: number; collapsed: boolean }) => {
    shell.sidebar = {
      width: props.width,
      collapsed: props.collapsed,
      mounts: shell.sidebar.mounts + 1,
    };
    return <div data-slot="project-sidebar" />;
  },
}));
vi.mock('@/components/chat/ChatView', () => ({ ChatView: shell.mark('chat-view') }));
vi.mock('@/components/chat/ChatFindBar', () => ({ requestOpenChatFind: vi.fn() }));
vi.mock('@/components/sidepanel/SidePanel', () => ({
  SidePanel: shell.mark('side-panel'),
}));
vi.mock('@/components/app/StatusBar', () => ({ StatusBar: shell.mark('status-bar') }));
vi.mock('@/components/app/BackgroundLayer', () => ({ BackgroundLayer: () => null }));
vi.mock('@/components/app/UpdateBanner', () => ({ UpdateBanner: () => null }));
vi.mock('@/components/app/WorkbenchTitle', () => ({ WorkbenchTitle: () => null }));
vi.mock('@/components/extensions/ExtensionsPage', () => ({ ExtensionsPage: () => null }));
vi.mock('@/components/nodes/RemoteNodeView', () => ({
  RemoteNodeView: shell.mark('remote-node'),
}));
vi.mock('@/components/oauth/OauthCredentialBootstrap', () => ({
  OauthCredentialBootstrap: () => null,
}));
vi.mock('@/components/onboarding/Onboarding', () => ({ Onboarding: () => null }));
vi.mock('@/components/search/WorkspaceSearchDialog', () => ({
  WorkspaceSearchDialog: () => null,
}));
vi.mock('@/components/bots/BotView', () => ({
  BotView: (props: { sidebarWidth?: number; collapsed?: boolean }) => {
    shell.botView = props;
    return <div data-slot="bot-view" />;
  },
}));
vi.mock('@/components/bots/globalBoard', () => ({
  rootBoardGroups: () => [],
  globalBoard: () => ({ attention: 0 }),
}));
/** 记忆审批订阅会异步回写 store；本用例只关心模式入口，固定空列表避免 act 警告。 */
vi.mock('@/stores/memoryReview', () => ({ usePendingMemoryWrites: () => [] }));
vi.mock('@/features/imageStudio/ImageStudio', () => ({
  ImageStudio: shell.mark('image-studio'),
}));
vi.mock('@/features/design/DesignRuntimeHost', () => ({ DesignRuntimeHost: () => null }));
vi.mock('@/features/design/DesignWindowRelay', () => ({ DesignWindowRelay: () => null }));
vi.mock('@/features/design/mounts/DesignGlobalSlots', () => ({ DesignGlobalSlots: () => null }));
vi.mock('@/features/design/mounts/DesignGallery', () => ({
  DesignGallery: shell.mark('design-gallery'),
  DesignGalleryHeader: shell.mark('gallery-header'),
}));
vi.mock('@/plugins/PluginNotices', () => ({ PluginNotices: () => null }));
vi.mock('@/plugins/PluginThemeHost', () => ({ PluginThemeHost: () => null }));
vi.mock('@/plugins/PluginUiHost', () => ({ PluginUiHost: () => null }));
vi.mock('@/components/ui/toast', () => ({ ToastProvider: () => null, addToast: vi.fn() }));
vi.mock('@/components/ui/alert-dialog', () => {
  const Pass = () => null;
  return {
    AlertDialog: Pass,
    AlertDialogPopup: Pass,
    AlertDialogHeader: Pass,
    AlertDialogTitle: Pass,
    AlertDialogDescription: Pass,
    AlertDialogFooter: Pass,
    AlertDialogClose: Pass,
  };
});

let container: HTMLDivElement;
let root: Root;

const titleBar = () => container.querySelector('[data-slot="title-bar"]');
const rail = () => container.querySelector('[data-slot="app-rail"]');
/** 标题栏右上角的分段控件；左侧图标轨不该再有同款入口。 */
const modeSwitch = () => titleBar()?.querySelector('[data-slot="mode-switch"]') ?? null;
const segment = (mode: 'code' | 'bot') =>
  modeSwitch()?.querySelector<HTMLButtonElement>(`[data-rail-view="${mode}"]`) ?? null;
const railEntry = (view: string) => rail()?.querySelector(`[data-rail-view="${view}"]`) ?? null;
const present = (slot: string) => container.querySelector(`[data-slot="${slot}"]`);
const mode = () => useAppModeStore.getState().mode;
const openGallery = (open: boolean) =>
  act(() => {
    useDesignRegistry.setState({ ui: { workspaceView: open ? GALLERY_VIEW_ID : null } });
  });
const setBotModeEnabled = (enabled: boolean) =>
  act(() => {
    useSettingsStore.setState({ botModeEnabled: enabled });
  });
const click = async (element: Element | null) => {
  expect(element).not.toBeNull();
  await act(async () => {
    (element as HTMLElement).click();
  });
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  shell.sidebar = { width: undefined, collapsed: false, mounts: 0 };
  shell.botView = null;
  shell.remoteNodes = [];
  localStorage.setItem('enso-sidebar-width', '264');
  localStorage.removeItem('enso-mode');
  useSidebarStore.setState({ collapsed: false, auto: false });
  useAppModeStore.setState({ mode: 'code' });
  useRemoteNodesStore.setState({ activeNodeId: 'local' });
  useSettingsStore.setState({ botModeEnabled: false, designEnabled: true });
  useImageStudioStore.setState({ open: false, historyOpen: false });
  useDesignRegistry.setState({ contributions: [], ui: {}, canvasSessionId: null });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  useDesignRegistry.setState({ contributions: [], ui: {}, canvasSessionId: null });
  useImageStudioStore.setState({ open: false, historyOpen: false });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountApp(): Promise<void> {
  await act(() => root.render(<App />));
}

describe('Code / Bot 模式入口固定在标题栏右上角', () => {
  it('左侧图标轨只留功能导航，不再重复 Code / Bot 入口', async () => {
    await mountApp();
    expect(railEntry('code')).toBeNull();
    expect(railEntry('bot')).toBeNull();
    // 侧栏开关、画图、设计、看板仍留在图标轨
    expect(rail()?.querySelector('button[aria-label="Collapse sidebar"]')).not.toBeNull();
    expect(railEntry('images')).not.toBeNull();
    expect(railEntry('design')).not.toBeNull();
    expect(railEntry('board')).not.toBeNull();
  });

  it('Bot 开启时标题栏有 Code / Bot 分段，位于聊天宽度与右侧面板按钮左侧', async () => {
    await setBotModeEnabled(true);
    await mountApp();
    expect(modeSwitch()).not.toBeNull();
    expect(segment('code')?.getAttribute('aria-pressed')).toBe('true');
    expect(segment('bot')?.getAttribute('aria-pressed')).toBe('false');

    const actions = titleBar()?.querySelector('[data-slot="title-bar-actions"]');
    const children = [...(actions?.children ?? [])];
    const switchIndex = children.findIndex((child) => child.contains(modeSwitch() as Node));
    const widthToggle = titleBar()?.querySelector('button[aria-label="Use full chat width"]');
    const panelToggle = titleBar()?.querySelector('button[aria-label="Toggle side panel"]');
    expect(switchIndex).toBe(0);
    expect(widthToggle).not.toBeNull();
    expect(panelToggle).not.toBeNull();
    // 模式切换与显示控制之间只有分隔线，没有别的可点控件
    const separator = children[1];
    expect(separator?.getAttribute('aria-hidden')).toBe('true');
    expect(separator?.getAttribute('data-slot')).toBe('titlebar-mode-separator');
    expect(separator?.querySelector('button')).toBeNull();
    // 显示控制都在分段控件右侧
    expect(
      (modeSwitch() as Node).compareDocumentPosition(widthToggle as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('Bot、图片工作台、设计画廊里模式分段都在原位', async () => {
    await setBotModeEnabled(true);
    await mountApp();
    await click(segment('bot'));
    expect(present('bot-view')).not.toBeNull();
    expect(modeSwitch()).not.toBeNull();

    await click(segment('code'));
    expect(present('chat-view')).not.toBeNull();
    act(() => useImageStudioStore.getState().setOpen(true));
    expect(present('image-studio')).not.toBeNull();
    expect(modeSwitch()).not.toBeNull();

    await openGallery(true);
    expect(present('design-gallery')).not.toBeNull();
    expect(modeSwitch()).not.toBeNull();
  });

  it('从设计画廊点 Code 回到 Code 对话', async () => {
    await setBotModeEnabled(true);
    await mountApp();
    await openGallery(true);
    expect(present('design-gallery')).not.toBeNull();
    expect(segment('code')?.getAttribute('aria-pressed')).toBe('false');

    await click(segment('code'));
    expect(present('design-gallery')).toBeNull();
    expect(present('chat-view')).not.toBeNull();
    expect(present('project-sidebar')).not.toBeNull();
    expect(mode()).toBe('code');
    expect(segment('code')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('从图片工作台点 Code 回到 Code 对话', async () => {
    await setBotModeEnabled(true);
    await mountApp();
    act(() => useImageStudioStore.getState().setOpen(true));
    expect(present('image-studio')).not.toBeNull();
    expect(segment('code')?.getAttribute('aria-pressed')).toBe('false');

    await click(segment('code'));
    expect(present('image-studio')).toBeNull();
    expect(present('chat-view')).not.toBeNull();
    expect(useImageStudioStore.getState().open).toBe(false);
  });

  it('从设计画廊点 Bot 正常进入 Bot，而不是只关掉画廊', async () => {
    await setBotModeEnabled(true);
    await mountApp();
    await openGallery(true);
    await click(segment('bot'));
    expect(mode()).toBe('bot');
    expect(present('bot-view')).not.toBeNull();
    expect(present('design-gallery')).toBeNull();
    expect(segment('bot')?.getAttribute('aria-pressed')).toBe('true');
    expect(segment('code')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('Bot 与 Code 之间来回切换保留侧栏宽度和折叠状态', async () => {
    await setBotModeEnabled(true);
    await mountApp();
    await click(segment('bot'));
    expect(shell.botView).toMatchObject({ sidebarWidth: 264, collapsed: false });
    await click(segment('code'));
    expect(shell.sidebar).toMatchObject({ width: 264, collapsed: false });
    expect(useSidebarStore.getState()).toMatchObject({ collapsed: false, auto: false });
  });

  it('Bot 实验开关关闭时没有 Bot 分段，Code 入口仍能从画廊回到对话', async () => {
    await mountApp();
    expect(modeSwitch()).not.toBeNull();
    expect(segment('bot')).toBeNull();
    expect(segment('code')?.getAttribute('aria-pressed')).toBe('true');

    await openGallery(true);
    await click(segment('code'));
    expect(present('design-gallery')).toBeNull();
    expect(present('chat-view')).not.toBeNull();
  });

  it('远程节点接管时不提供本机模式切换，也不误报 Bot', async () => {
    await setBotModeEnabled(true);
    shell.remoteNodes = [{ nodeId: 'node-remote', hostOnline: true }];
    act(() => useRemoteNodesStore.setState({ activeNodeId: 'node-remote' }));
    await mountApp();
    // 目录刷新完成后仍停在该节点，不会被误切回本机
    await act(async () => {});
    expect(present('remote-node')).not.toBeNull();
    expect(modeSwitch()).toBeNull();
    expect(railEntry('code')).toBeNull();
    expect(railEntry('bot')).toBeNull();
  });
});
