// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesignRegistry } from '@/features/design/host/registry';
import { GALLERY_VIEW_ID } from '@/features/design/vetta/src/tab-ids';
import { useSidebarStore } from '@/stores/sidebar';
import App from './App';

/**
 * 设计画廊是全屏接管：进入后不能继续占用聊天项目侧栏（约 264px）和它的拖拽手柄，
 * 退出画廊必须回到进入前的侧栏宽度与折叠偏好。只验证 App 的布局路由，
 * 侧栏 / 聊天 / 画廊内部各自被替换成标记，避免把无关的重型 UI 拖进这个测试。
 */
const shell = vi.hoisted(() => {
  /**
   * 只提供水合所需的空设置；其余 IPC 一律是可调用占位，避免副作用真的跑到主进程。
   * settings / sessions store 在 import 阶段就读 sourceAuthority，桩必须先装好。
   */
  const placeholder: unknown = new Proxy(() => {}, {
    get: (_target, key) => {
      // 被当成 Promise 用时立即以 undefined 兑现，.then(...).catch(...) 也能继续链下去。
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
  /** 已知字段用真实回包，其余字段递归落到占位，避免缺一个方法就整棵渲染失败。 */
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
    settings: { read: async () => ({}), writeKey: async () => {} },
    sourceAuthority: {
      read: async () => ({ projects: [], conversations: [] }),
      onChanged: () => () => {},
    },
    nodes: { list: async () => ({ nodes: [], secureStorage: true }) },
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return {
    sidebar: { width: undefined as number | undefined, collapsed: false, mounts: 0 },
    mark: (slot: string) => () => <div data-slot={slot} />,
  };
});

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
vi.mock('@/components/sidepanel/SidePanel', () => ({
  SidePanel: shell.mark('side-panel'),
}));
vi.mock('@/components/app/StatusBar', () => ({ StatusBar: shell.mark('status-bar') }));
vi.mock('@/components/app/TitleBar', () => ({
  TitleBar: () => <div data-slot="title-bar" />,
}));
vi.mock('@/components/app/BackgroundLayer', () => ({ BackgroundLayer: () => null }));
vi.mock('@/components/app/UpdateBanner', () => ({ UpdateBanner: () => null }));
vi.mock('@/components/app/WorkbenchTitle', () => ({ WorkbenchTitle: () => null }));
vi.mock('@/components/extensions/ExtensionsPage', () => ({ ExtensionsPage: () => null }));
vi.mock('@/components/nodes/RemoteNodeView', () => ({ RemoteNodeView: () => null }));
vi.mock('@/components/oauth/OauthCredentialBootstrap', () => ({
  OauthCredentialBootstrap: () => null,
}));
vi.mock('@/components/onboarding/Onboarding', () => ({ Onboarding: () => null }));
vi.mock('@/components/search/WorkspaceSearchDialog', () => ({
  WorkspaceSearchDialog: () => null,
}));
vi.mock('@/components/bots/BotView', () => ({ BotView: () => null }));
vi.mock('@/components/bots/globalBoard', () => ({
  rootBoardGroups: () => [],
  globalBoard: () => ({ attention: 0 }),
}));
vi.mock('@/components/bots/ModeSwitch', () => ({ ModeSwitch: () => null }));
vi.mock('@/features/imageStudio/ImageStudio', () => ({ ImageStudio: () => null }));
vi.mock('@/features/design/DesignRuntimeHost', () => ({ DesignRuntimeHost: () => null }));
vi.mock('@/features/design/DesignWindowRelay', () => ({ DesignWindowRelay: () => null }));
vi.mock('@/features/design/mounts/DesignGlobalSlots', () => ({ DesignGlobalSlots: () => null }));
vi.mock('@/features/design/mounts/DesignGallery', () => ({
  DesignGallery: shell.mark('design-gallery'),
  DesignGalleryHeader: () => null,
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
const sidebarSlot = () => container.querySelector('[data-slot="project-sidebar"]');
/** Code 视图里唯一的分栏拖拽手柄；画廊不该保留它，否则右侧仍留一条可拖的 1px 缝。 */
const sidebarHandle = () => container.querySelector('[data-slot="resize-hit"]');
const gallery = () => container.querySelector('[data-slot="design-gallery"]');
const setGallery = (open: boolean) =>
  act(() => {
    useDesignRegistry.setState({ ui: { workspaceView: open ? GALLERY_VIEW_ID : null } });
  });

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
  localStorage.setItem('enso-sidebar-width', '264');
  useSidebarStore.setState({ collapsed: false, auto: false });
  useDesignRegistry.setState({ contributions: [], ui: {}, canvasSessionId: null });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  useDesignRegistry.setState({ contributions: [], ui: {}, canvasSessionId: null });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountApp(): Promise<void> {
  await act(() => root.render(<App />));
}

describe('设计画廊占用整块工作区', () => {
  it('画廊打开时不渲染聊天项目侧栏，也不留侧栏拖拽手柄和留白', async () => {
    await mountApp();
    expect(sidebarSlot()).not.toBeNull();
    expect(shell.sidebar.width).toBe(264);

    await setGallery(true);
    expect(gallery()).not.toBeNull();
    expect(sidebarSlot()).toBeNull();
    expect(sidebarHandle()).toBeNull();
    // 图标导航轨和底部状态栏仍在，画廊只覆盖侧栏 + 工作区。
    expect(container.querySelector('[data-slot="app-rail"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="status-bar"]')).not.toBeNull();
  });

  it('从画廊切回 Code 恢复原来的侧栏宽度和展开状态', async () => {
    await mountApp();
    const mountsBefore = shell.sidebar.mounts;
    await setGallery(true);
    expect(sidebarSlot()).toBeNull();

    await setGallery(false);
    expect(gallery()).toBeNull();
    expect(sidebarSlot()).not.toBeNull();
    expect(sidebarHandle()).not.toBeNull();
    expect(shell.sidebar.mounts).toBeGreaterThan(mountsBefore);
    expect(shell.sidebar).toMatchObject({ width: 264, collapsed: false });
  });

  it('原本折叠侧栏时，画廊同样不占位，返回后仍是折叠偏好', async () => {
    act(() => useSidebarStore.setState({ collapsed: true, auto: false }));
    await mountApp();
    expect(shell.sidebar.collapsed).toBe(true);
    // 折叠态本来就没有手柄，画廊不能把它“恢复”成展开。
    expect(sidebarHandle()).toBeNull();

    await setGallery(true);
    expect(sidebarSlot()).toBeNull();

    await setGallery(false);
    expect(shell.sidebar.collapsed).toBe(true);
    expect(shell.sidebar.width).toBeUndefined();
    expect(sidebarHandle()).toBeNull();
    expect(useSidebarStore.getState()).toMatchObject({ collapsed: true, auto: false });
  });

  it('画廊状态只由运行时路由决定，不改写持久化的侧栏折叠偏好', async () => {
    await mountApp();
    await setGallery(true);
    expect(useSidebarStore.getState().collapsed).toBe(false);
    await setGallery(false);
    expect(useSidebarStore.getState().collapsed).toBe(false);
    expect(localStorage.getItem('enso-sidebar-collapsed')).not.toBe('1');
  });
});
