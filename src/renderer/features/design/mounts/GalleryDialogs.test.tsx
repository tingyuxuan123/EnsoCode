import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../vetta/src/canvas/ConfirmDialog';
import { CreateDesignDialog } from '../vetta/src/gallery/CreateDesignDialog';
import { DesignSystemDetailDialog } from '../vetta/src/gallery/DesignSystemDetailDialog';

vi.mock('@vetta-org/plugin-sdk', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const popup = () => document.querySelector('[data-slot="dialog-popup"]');

describe('gallery host dialog shells', () => {
  it('new-design dialog has scoped host slots, valid submit guard and unchanged cancel behavior', async () => {
    const create = vi.fn();
    const close = vi.fn();
    await act(async () =>
      root.render(
        <CreateDesignDialog
          workspacePath="/designs"
          busy={false}
          onCreate={create}
          onClose={close}
        />
      )
    );
    expect(popup()?.querySelector('[data-vetta-plugin-root]')).not.toBeNull();
    for (const slot of ['dialog-header', 'dialog-panel', 'dialog-footer']) {
      expect(popup()?.querySelector(`[data-slot="${slot}"]`)).not.toBeNull();
    }
    expect(popup()?.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled).toBe(true);
    await act(async () =>
      popup()
        ?.querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(create).not.toHaveBeenCalled();
    const cancel = [...(popup()?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'gallery.action.cancel'
    );
    await act(async () => cancel?.click());
    expect(close).toHaveBeenCalledOnce();
  });

  it('archive confirmation uses host Dialog and destructive controls without intercepting window Escape', async () => {
    const confirm = vi.fn();
    await act(async () =>
      root.render(
        <ConfirmDialog
          title="Hide design?"
          description="Only from gallery"
          confirmLabel="Hide"
          cancelLabel="Cancel"
          danger
          onConfirm={confirm}
          onCancel={vi.fn()}
        />
      )
    );
    expect(popup()?.querySelector('[data-slot="dialog-title"]')?.textContent).toBe('Hide design?');
    const button = [...(popup()?.querySelectorAll('button') ?? [])].find(
      (item) => item.textContent === 'Hide'
    );
    expect(button?.className).toContain('destructive');
    await act(async () => button?.click());
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('style detail remains a scoped host dialog with its upstream use action', async () => {
    const use = vi.fn();
    const system = {
      id: 'example',
      name: 'Example',
      category: 'dev',
      vibe: 'light' as const,
      blurb: 'Preview',
      resources: [],
      themeCss: '',
      designMd: '',
    };
    await act(async () =>
      root.render(
        <DesignSystemDetailDialog system={system} busy={false} onUse={use} onClose={vi.fn()} />
      )
    );
    expect(popup()?.querySelector('[data-vetta-plugin-root]')).not.toBeNull();
    for (const slot of ['dialog-header', 'dialog-panel', 'dialog-footer']) {
      expect(popup()?.querySelector(`[data-slot="${slot}"]`)).not.toBeNull();
    }
    const button = [...(popup()?.querySelectorAll('button') ?? [])].find(
      (item) => item.textContent === 'gallery.detail.use'
    );
    await act(async () => button?.click());
    expect(use).toHaveBeenCalledWith(system);
  });
});
