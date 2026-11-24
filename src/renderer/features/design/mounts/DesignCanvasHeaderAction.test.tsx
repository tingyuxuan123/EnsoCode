import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishDesignListing } from '../vetta/src/vetd/design-listing';
import { DesignCanvasHeaderAction } from './DesignCanvasHeaderAction';

const h = vi.hoisted(() => ({
  enabled: true,
  selected: 'current',
  open: vi.fn(async () => {}),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: { designEnabled: boolean }) => unknown) =>
    select({ designEnabled: h.enabled }),
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: (select: (s: { activeId: string; conversations: object }) => unknown) =>
    select({ activeId: h.selected, conversations: {} }),
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../host/preview-files', () => ({ openDesignDirectory: h.open }));

const cwd = '/canonical/project';
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  h.enabled = true;
  h.selected = 'current';
  h.open.mockClear();
  publishDesignListing(null);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<DesignCanvasHeaderAction />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function publish(sessionId: string, paths: string[]) {
  act(() => publishDesignListing({ sessionId, cwd, paths }));
}

describe('会话顶栏打开画布', () => {
  it('仅展示当前会话发现的设计，单份直接打开且绑定扫描时的根', async () => {
    expect(container.querySelector('button')).toBeNull();
    publish('previous', [`${cwd}/old.vetd`]);
    expect(container.querySelector('button')).toBeNull();
    publish('current', [`${cwd}/nested/screen.vetd`]);
    const button = container.querySelector('button');
    expect(button?.textContent).toBe('Open canvas');
    await act(async () => button?.click());
    expect(h.open).toHaveBeenCalledExactlyOnceWith('current', 'nested/screen.vetd', cwd);
  });

  it('有多份时由菜单打开指定稿件，同名项可用目录区分', async () => {
    publish('current', [`${cwd}/a/app.vetd`, `${cwd}/b/app.vetd`]);
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    expect(trigger?.textContent).toContain('Open canvas');
    await act(async () => trigger?.click());
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(['a/app', 'b/app']);
    await act(async () => items[1]?.click());
    expect(h.open).toHaveBeenCalledExactlyOnceWith('current', 'b/app.vetd', cwd);
  });

  it('切走或关闭设计功能后不继续展示原会话选择项', () => {
    publish('current', [`${cwd}/screen.vetd`]);
    expect(container.querySelector('button')).not.toBeNull();
    h.selected = 'new';
    act(() => root.render(<DesignCanvasHeaderAction />));
    expect(container.querySelector('button')).toBeNull();
    h.enabled = false;
    publish('new', [`${cwd}/other.vetd`]);
    act(() => root.render(<DesignCanvasHeaderAction />));
    expect(container.querySelector('button')).toBeNull();
  });
});
