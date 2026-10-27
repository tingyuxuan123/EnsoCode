import { parseHTML } from 'linkedom';
import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FilesSearchFileActions, FilesSearchPane } from './FilesSearchPane';

const search = vi.hoisted(() => vi.fn());

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui/button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: React.ComponentProps<'button'> & { variant?: string; size?: string }) => <button {...props} />,
}));
vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}));
vi.mock('@/components/ui/context-menu', async () => {
  const { cloneElement, createContext, useContext, useState } = await import('react');
  const State = createContext({ open: false, show: () => {} });
  return {
    ContextMenu: ({ children }: { children: ReactNode }) => {
      const [open, setOpen] = useState(false);
      return (
        <State.Provider value={{ open, show: () => setOpen(true) }}>{children}</State.Provider>
      );
    },
    ContextMenuTrigger: ({ render }: { render: ReactElement }) => {
      const { show } = useContext(State);
      return cloneElement(render as ReactElement<{ onContextMenu: (event: Event) => void }>, {
        onContextMenu: (event: Event) => {
          event.preventDefault();
          show();
        },
      });
    },
    ContextMenuPopup: ({ children }: { children: ReactNode }) =>
      useContext(State).open ? <span role="menu">{children}</span> : null,
    ContextMenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
      <button type="button" role="menuitem" onClick={onClick}>
        {children}
      </button>
    ),
    ContextMenuSeparator: () => null,
  };
});

let root: Root;
let container: HTMLElement;

function actions(local = true) {
  return {
    local,
    onOpenFile: vi.fn<(rel: string) => void>(),
    onPreview: vi.fn<(rel: string) => void>(),
    onBrowser: vi.fn<(rel: string) => void>(),
    onCopyPath: vi.fn<(rel: string) => void>(),
    onCopyRel: vi.fn<(rel: string) => void>(),
    onCopyFile: vi.fn<(rel: string) => void>(),
    onReveal: vi.fn<(rel: string) => void>(),
    onNewFile: vi.fn<(parent: string) => void>(),
    onNewFolder: vi.fn<(parent: string) => void>(),
    onRename: vi.fn<(rel: string, name: string) => void>(),
    onDelete: vi.fn<(rel: string, name: string) => void>(),
    onSend: vi.fn<(rel: string, name: string) => void>(),
  };
}

async function render(props: { menu: FilesSearchFileActions; onOpenFile: (rel: string) => void }) {
  await act(async () => {
    root.render(
      <FilesSearchPane
        conversationId="conv"
        projectId="project"
        onOpenFile={props.onOpenFile}
        onClose={() => undefined}
        menu={props.menu}
      />
    );
  });
}

async function searchFor(query: string) {
  await act(async () => {
    const input = container.querySelector('input');
    if (!input) throw new Error('missing search input');
    const propKey = Object.keys(input).find((name) => name.startsWith('__reactProps'));
    const props = propKey
      ? (
          input as unknown as Record<
            string,
            { onChange?: (event: { target: { value: string } }) => void }
          >
        )[propKey]
      : undefined;
    props?.onChange?.({ target: { value: query } });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
}

function hit(name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(name)
  );
  if (!button) throw new Error(`missing search result: ${name}`);
  return button as HTMLButtonElement;
}

async function openMenu(name: string) {
  await act(async () => {
    hit(name).dispatchEvent(new window.Event('contextmenu', { bubbles: true, cancelable: true }));
  });
}

function item(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('[role="menuitem"]')].find(
    (node) => node.textContent === label
  ) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', { userAgent: 'Windows' });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(dom.window, { electronAPI: { workspaceFiles: { search } } });
  container = dom.document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
  search.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('FilesSearchPane context menu', () => {
  it('文件名结果右键给出与文件树相同的文件操作，左键仍打开文件', async () => {
    search.mockResolvedValue({
      ok: true,
      mode: 'names',
      hits: [{ relativePath: 'src/app.ts', name: 'app.ts' }],
    });
    const menu = actions();
    await render({ menu, onOpenFile: menu.onOpenFile });
    await searchFor('app');
    await act(async () => hit('app.ts').click());
    expect(menu.onOpenFile).toHaveBeenCalledWith('src/app.ts');

    await openMenu('app.ts');
    expect(item('Copy Path')).toBeTruthy();
    expect(item('Copy')).toBeTruthy();
    expect(item('Open in Browser')).toBeTruthy();
    expect(item('Reveal in File Explorer')).toBeTruthy();
    expect(item('Rename')).toBeTruthy();
    expect(item('Send to conversation')).toBeTruthy();
    expect(item('Open Markdown Preview')).toBeUndefined();

    await act(async () => item('Copy Path')?.click());
    expect(menu.onCopyPath).toHaveBeenCalledWith('src/app.ts');
    await act(async () => item('New File')?.click());
    expect(menu.onNewFile).toHaveBeenCalledWith('src');
    await act(async () => item('Rename')?.click());
    expect(menu.onRename).toHaveBeenCalledWith('src/app.ts', 'app.ts');
    await act(async () => item('Send to conversation')?.click());
    expect(menu.onSend).toHaveBeenCalledWith('src/app.ts', 'app.ts');
  });

  it('内容结果右键作用在所在文件，远程工作区隐藏本地操作', async () => {
    search.mockResolvedValue({
      ok: true,
      mode: 'content',
      hits: [
        { relativePath: 'docs/readme.md', line: 4, column: 1, matchLength: 3, content: 'hello' },
      ],
      truncated: false,
    });
    const menu = actions(false);
    await render({ menu, onOpenFile: menu.onOpenFile });
    await act(async () => hit('Content').click());
    await searchFor('hello');
    expect(search).toHaveBeenCalledWith({
      conversationId: 'conv',
      projectId: 'project',
      query: 'hello',
      mode: 'content',
    });

    await openMenu('readme.md');
    expect(item('Copy')).toBeUndefined();
    expect(item('Open in Browser')).toBeUndefined();
    expect(item('Reveal in File Explorer')).toBeUndefined();
    expect(item('Open Markdown Preview')).toBeTruthy();

    await act(async () => item('Delete')?.click());
    expect(menu.onDelete).toHaveBeenCalledWith('docs/readme.md', 'readme.md');
    await act(async () => item('View File')?.click());
    expect(menu.onOpenFile).toHaveBeenCalledWith('docs/readme.md');
  });
});
