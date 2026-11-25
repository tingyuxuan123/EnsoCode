// @vitest-environment happy-dom

import type { SettingsDeepLink } from '@shared/settingsDeepLink';
import { act, createElement, type ReactNode, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesignRegistry } from '@/features/design/host/registry';
import { GALLERY_VIEW_ID } from '@/features/design/vetta/src/tab-ids';
import { useImageStudioStore } from '@/features/imageStudio/store';
import { setPluginViews } from '@/plugins/viewBridge';
import { closePluginWorkspace, getPluginWorkspace } from '@/plugins/workspaceViews';
import { useRemoteNodesStore } from '@/stores/remoteNodes';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import { useSidebarStore } from '@/stores/sidebar';
import App from './App';

/** Exercise the real App, TitleBar, and AppRail with lightweight workspace views. */
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
    settings: { read: async () => ({}), writeKey: async () => true },
    sourceAuthority: {
      read: async () => ({ projects: [], conversations: [] }),
      onChanged: () => () => {},
    },
    nodes: { list: async () => ({ nodes: shell.remoteNodes, secureStorage: true }) },
    window: {
      onExtensionsDeepLink: (callback: () => void) => {
        shell.extensionsListener = callback;
        return () => {
          shell.extensionsListener = null;
        };
      },
      consumeExtensionsDeepLink: async () => {
        const link = shell.extensionsPending;
        shell.extensionsPending = null;
        return link;
      },
    },
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return {
    /** 远程节点用例按需填入；空数组时刷新会保持本机。 */
    remoteNodes: [] as { nodeId: string; hostOnline: boolean }[],
    sidebar: { width: undefined as number | undefined, collapsed: false, mounts: 0 },
    extensionsListener: null as (() => void) | null,
    extensionsPending: null as SettingsDeepLink | null,
    extensionRequest: undefined as { pluginId?: string } | undefined,
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
/**
 * Code 视图只要真实页签条：这样“图片工作台不渲染通用页签条、切回 Code 恢复”
 * 才是可观察事实，而不是只断言一个占位槽。CoworkerTabs 在空 store 下只画主会话页签。
 */
vi.mock('@/components/chat/ChatView', async () => {
  const { CoworkerTabs } = await import('@/components/chat/CoworkerTabs');
  return {
    ChatView: () => (
      <div data-slot="chat-view">
        <CoworkerTabs parentId="parent" displayedId="parent" />
      </div>
    ),
  };
});
vi.mock('@/components/chat/ChatFindBar', () => ({ requestOpenChatFind: vi.fn() }));
vi.mock('@/components/sidepanel/SidePanel', () => ({
  SidePanel: shell.mark('side-panel'),
}));
vi.mock('@/components/app/StatusBar', () => ({ StatusBar: shell.mark('status-bar') }));
vi.mock('@/components/app/BackgroundLayer', () => ({ BackgroundLayer: () => null }));
vi.mock('@/components/app/UpdateRailItem', () => ({ UpdateRailItem: () => null }));
vi.mock('@/components/extensions/ExtensionsPage', () => ({
  ExtensionsPage: ({ request }: { request?: { pluginId?: string } }) => {
    shell.extensionRequest = request;
    return <div data-slot="extensions-page" />;
  },
}));
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
vi.mock('@/plugins/PluginView', () => ({
  PluginView: ({ sessionId }: { sessionId: string | null }) => (
    <div data-slot="plugin-frame" data-session={sessionId ?? 'global'} />
  ),
}));
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
const railEntry = (view: string) => rail()?.querySelector(`[data-rail-view="${view}"]`) ?? null;
const present = (slot: string) => container.querySelector(`[data-slot="${slot}"]`);
const openGallery = (open: boolean) =>
  act(() => {
    useDesignRegistry.setState({ ui: { workspaceView: open ? GALLERY_VIEW_ID : null } });
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
  shell.remoteNodes = [];
  shell.extensionsListener = null;
  shell.extensionsPending = null;
  shell.extensionRequest = undefined;
  localStorage.setItem('enso-sidebar-width', '264');
  useSidebarStore.setState({ collapsed: false, auto: false });
  useRemoteNodesStore.setState({ activeNodeId: 'local' });
  useSessionsStore.setState({ activeId: null });
  setPluginViews([]);
  closePluginWorkspace();
  useSettingsStore.setState({ designEnabled: true });
  useImageStudioStore.setState({ open: false, historyOpen: false });
  useDesignRegistry.setState({ contributions: [], ui: {}, canvasSessionId: null });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  setPluginViews([]);
  closePluginWorkspace();
  useDesignRegistry.setState({ contributions: [], ui: {}, canvasSessionId: null });
  useImageStudioStore.setState({ open: false, historyOpen: false });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountApp(): Promise<void> {
  await act(() => root.render(<App />));
}

it('keeps the design and image workspaces without a built-in Wiki entry', async () => {
  await mountApp();
  expect(railEntry('images')).not.toBeNull();
  expect(railEntry('design')).not.toBeNull();
  expect(railEntry('wiki')).toBeNull();
});

it('插件记忆从最左侧打开独立工作区，不创建聊天或右侧标签，停用即撤销', async () => {
  setPluginViews([
    {
      pluginId: 'codekiln.memory',
      pluginName: 'Memory',
      id: 'memory',
      title: 'Memory',
      entry: 'memory.html',
      location: 'activitybar',
    },
  ]);
  await mountApp();
  const memory = railEntry('plugin:codekiln.memory:memory');
  expect(memory).not.toBeNull();
  await click(memory);
  expect(memory?.getAttribute('aria-pressed')).toBe('true');
  expect(railEntry('code')?.getAttribute('aria-pressed')).toBe('false');
  expect(present('plugin-workspace')).not.toBeNull();
  expect(present('plugin-frame')?.getAttribute('data-session')).toBe('global');
  expect(present('project-sidebar')).toBeNull();
  expect(present('chat-view')?.parentElement?.classList.contains('hidden')).toBe(true);
  expect(useSessionsStore.getState().activeId).toBeNull();
  await click(railEntry('code'));
  expect(present('plugin-workspace')).toBeNull();
  expect(present('chat-view')?.parentElement?.classList.contains('hidden')).toBe(false);
  await click(memory);
  act(() => setPluginViews([]));
  expect(present('plugin-workspace')).toBeNull();
  expect(railEntry('plugin:codekiln.memory:memory')).toBeNull();
  expect(getPluginWorkspace()).toBeNull();
});

it('冷启动待处理插件深链在 StrictMode 重订阅后不丢失', async () => {
  shell.extensionsPending = { category: 'plugins', rowId: 'plugins.enso' };
  await act(async () =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  );
  expect(present('extensions-page')).not.toBeNull();
});

it('原生插件通知从图片工作台切回本机扩展页，保留详情定位', async () => {
  await mountApp();
  act(() => useImageStudioStore.getState().setOpen(true));
  expect(present('image-studio')).not.toBeNull();
  shell.extensionsPending = {
    category: 'plugins',
    rowId: 'plugins.enso',
    pluginId: 'enso.example.notes',
  };
  await act(async () => shell.extensionsListener?.());
  expect(present('extensions-page')).not.toBeNull();
  expect(shell.extensionRequest?.pluginId).toBe('enso.example.notes');
});

describe('本机工作区导航', () => {
  it('Code 入口在图标轨并位于图片工作台上方', async () => {
    await mountApp();
    expect(titleBar()?.querySelector('[data-slot="mode-switch"]')).toBeNull();
    expect(railEntry('bot')).toBeNull();
    expect(railEntry('code')?.getAttribute('aria-pressed')).toBe('true');
    expect(rail()?.querySelector('button[aria-label="Collapse sidebar"]')).not.toBeNull();
    expect(railEntry('images')).not.toBeNull();
    expect(railEntry('design')).not.toBeNull();
    expect(railEntry('board')).toBeNull();
    const labels = Array.from(rail()?.querySelectorAll('button[aria-label]') ?? []).map((button) =>
      button.getAttribute('aria-label')
    );
    expect(labels.indexOf('Code')).toBeLessThan(labels.indexOf('Image studio'));
  });

  it('有活动会话时标题栏右侧只留侧栏开关，不再挂载移动设备或聊天宽度入口', async () => {
    act(() => useSessionsStore.setState({ activeId: 'conv-1' }));
    await mountApp();
    const actions = titleBar()?.querySelector('[data-slot="title-bar-actions"]');
    expect(actions?.querySelector('button[aria-label="Toggle side panel"]')).not.toBeNull();
    expect(actions?.querySelector('button[aria-label="Use full chat width"]')).toBeNull();
    expect(actions?.querySelector('button[aria-label="Mobile devices"]')).toBeNull();
  });

  it('远程节点让位给对方的目录时标题栏不重复品牌字', async () => {
    shell.remoteNodes = [{ nodeId: 'node-remote', hostOnline: true }];
    act(() => useRemoteNodesStore.setState({ activeNodeId: 'node-remote' }));
    await mountApp();
    await act(async () => {});
    expect(present('remote-node')).not.toBeNull();
    expect(titleBar()?.querySelector('[data-slot="mode-switch"]')).toBeNull();
    // 顶栏左侧不再显示品牌字与「工作台」标签
    expect(titleBar()?.querySelector('[data-slot="title-bar-heading"]')).toBeNull();
    expect(titleBar()?.textContent ?? '').not.toContain('Workbench');
  });

  it('从设计画廊点 Code 回到 Code 对话', async () => {
    await mountApp();
    await openGallery(true);
    expect(present('design-gallery')).not.toBeNull();
    expect(railEntry('code')?.getAttribute('aria-pressed')).toBe('false');

    await click(railEntry('code'));
    expect(present('design-gallery')).toBeNull();
    expect(present('chat-view')).not.toBeNull();
    expect(present('project-sidebar')).not.toBeNull();
    expect(railEntry('code')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('从图片工作台点 Code 回到 Code 对话', async () => {
    await mountApp();
    act(() => useImageStudioStore.getState().setOpen(true));
    expect(present('image-studio')).not.toBeNull();
    expect(railEntry('code')?.getAttribute('aria-pressed')).toBe('false');

    await click(railEntry('code'));
    expect(present('image-studio')).toBeNull();
    expect(present('chat-view')).not.toBeNull();
    expect(useImageStudioStore.getState().open).toBe(false);
  });

  it('图片工作台的生图历史入口留在标题栏，不靠关掉工作台才能打开', async () => {
    await mountApp();
    act(() => useImageStudioStore.getState().setOpen(true));
    expect(present('image-studio')).not.toBeNull();
    const actions = titleBar()?.querySelector('[data-slot="title-bar-actions"]');
    const history = actions?.querySelector<HTMLButtonElement>('button[aria-label="Image history"]');
    expect(history).not.toBeNull();
    await click(history ?? null);
    expect(useImageStudioStore.getState().historyOpen).toBe(true);
  });

  it('图片工作台里没有 Code 的会话页签条，切回 Code 恢复', async () => {
    await mountApp();
    expect(present('conversation-tabs')).not.toBeNull();

    act(() => useImageStudioStore.getState().setOpen(true));
    expect(present('image-studio')).not.toBeNull();
    expect(present('conversation-tabs')).toBeNull();

    await click(railEntry('code'));
    expect(present('image-studio')).toBeNull();
    expect(present('chat-view')).not.toBeNull();
    expect(present('conversation-tabs')).not.toBeNull();
  });

  it('远程节点接管时不提供本机工作区入口', async () => {
    shell.remoteNodes = [{ nodeId: 'node-remote', hostOnline: true }];
    act(() => useRemoteNodesStore.setState({ activeNodeId: 'node-remote' }));
    await mountApp();
    // 目录刷新完成后仍停在该节点，不会被误切回本机
    await act(async () => {});
    expect(present('remote-node')).not.toBeNull();
    expect(titleBar()?.querySelector('[data-slot="mode-switch"]')).toBeNull();
    expect(railEntry('code')).toBeNull();
    expect(railEntry('bot')).toBeNull();
  });
});
