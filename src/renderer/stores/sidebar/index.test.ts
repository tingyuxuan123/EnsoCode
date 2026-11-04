import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

const { readSidebarCollapsed, useSidebarStore } = await import('./index');

beforeEach(() => {
  storage.clear();
  useSidebarStore.setState({ collapsed: false, auto: false });
});

describe('项目栏收起状态', () => {
  it('启动时读用户上次的选择', () => {
    storage.set('enso-sidebar-collapsed', '1');
    expect(readSidebarCollapsed()).toBe(true);
    storage.set('enso-sidebar-collapsed', '0');
    expect(readSidebarCollapsed()).toBe(false);
  });

  it('自动收起后可自动恢复，且不写入用户偏好', () => {
    const store = useSidebarStore.getState();
    store.autoCollapse();
    expect(useSidebarStore.getState()).toMatchObject({ collapsed: true, auto: true });
    expect(storage.get('enso-sidebar-collapsed')).not.toBe('1');
    useSidebarStore.getState().autoRestore();
    expect(useSidebarStore.getState()).toMatchObject({ collapsed: false, auto: false });
  });

  it('用户自己收起的不会被自动恢复，也不会被标成自动', () => {
    useSidebarStore.getState().toggle();
    expect(useSidebarStore.getState()).toMatchObject({ collapsed: true, auto: false });
    expect(storage.get('enso-sidebar-collapsed')).toBe('1');
    useSidebarStore.getState().autoCollapse();
    useSidebarStore.getState().autoRestore();
    expect(useSidebarStore.getState().collapsed).toBe(true);
  });

  it('自动收起后用户手动展开，归还给用户', () => {
    useSidebarStore.getState().autoCollapse();
    useSidebarStore.getState().toggle();
    expect(useSidebarStore.getState()).toMatchObject({ collapsed: false, auto: false });
    expect(storage.get('enso-sidebar-collapsed')).toBe('0');
  });
});
