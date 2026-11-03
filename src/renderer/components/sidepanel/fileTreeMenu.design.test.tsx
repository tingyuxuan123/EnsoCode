import { parseHTML } from 'linkedom';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { FileTreeMenu, type FileTreeTarget } from './fileTreeMenu';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/design/host/translation', () => ({ translate: (key: string) => key }));
vi.mock('@/components/ui/context-menu', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ContextMenu: Wrap,
    ContextMenuPopup: Wrap,
    ContextMenuTrigger: () => null,
    ContextMenuSeparator: () => null,
    ContextMenuItem: ({ children, onClick }: { children?: ReactNode; onClick: () => void }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

it('仅本地设计目录且功能提供回调时显示画布操作，并传递目录相对标识', async () => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = dom.document.getElementById('root') as unknown as HTMLElement;
  const root = createRoot(container);
  const onDesign = vi.fn();
  try {
    for (const [target, local, enabled, visible] of [
      [{ kind: 'dir', name: 'app.vetd', rel: 'nested/app.vetd' }, true, true, true],
      [{ kind: 'dir', name: 'app.vetd', rel: 'nested/app.vetd' }, false, true, false],
      [{ kind: 'dir', name: 'app.vetd', rel: 'nested/app.vetd' }, true, false, false],
      [{ kind: 'file', name: 'share.vetd', rel: 'share.vetd' }, true, true, false],
      [{ kind: 'dir', name: 'normal', rel: 'normal' }, true, true, false],
    ] as [FileTreeTarget, boolean, boolean, boolean][]) {
      await act(async () =>
        root.render(
          <FileTreeMenu
            target={target}
            local={local}
            onDesignCanvas={enabled ? onDesign : undefined}
            onNewFile={() => {}}
            onNewFolder={() => {}}
            onCopyPath={() => {}}
            onCopyRel={() => {}}
          >
            <div />
          </FileTreeMenu>
        )
      );
      const open = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'fileExplorer.openCanvas'
      );
      expect(Boolean(open)).toBe(visible);
      if (visible) {
        await act(async () => open?.click());
        expect(onDesign).toHaveBeenLastCalledWith('nested/app.vetd');
      }
    }
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
