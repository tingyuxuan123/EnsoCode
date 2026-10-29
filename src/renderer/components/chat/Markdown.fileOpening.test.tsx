import type { ContextMenuOpen } from '@shared/fileOpening';
import { parseHTML } from 'linkedom';
import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalFileTrigger, Markdown, MarkdownLinkContext } from './Markdown';

const harness = vi.hoisted(() => ({
  open: vi.fn(),
  openContext: vi.fn(),
  reveal: vi.fn(),
  readImage: vi.fn(),
  openSidePanelFile: vi.fn(),
  toast: vi.fn(),
  contextMenuOpen: [] as ContextMenuOpen,
  projects: [] as { id: string; kind: string }[],
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/sidePanelDock', () => ({ openSidePanelFile: harness.openSidePanelFile }));
vi.mock('@/components/ui/toast', () => ({ addToast: harness.toast }));
vi.mock('./CodeBlock', () => ({ CodeBlock: () => null }));
vi.mock('./MermaidRenderer', () => ({ MermaidRenderer: () => null }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (
    selector: (state: {
      contextMenuOpen: ContextMenuOpen;
      projects: typeof harness.projects;
    }) => unknown
  ) => selector({ contextMenuOpen: harness.contextMenuOpen, projects: harness.projects }),
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
  };
});
vi.mock('@/components/ui/dialog', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <span role="dialog">{children}</span> : null,
    DialogContent: Wrap,
    DialogHeader: Wrap,
    DialogTitle: Wrap,
    DialogDescription: Wrap,
    DialogPanel: Wrap,
    DialogFooter: Wrap,
  };
});

let root: Root;
let container: HTMLElement;
const context = { conversationId: 'child', projectId: 'project', cwd: 'C:/workspace' };

async function render(text: string, authorized = true) {
  await act(async () =>
    root.render(
      <MarkdownLinkContext.Provider value={authorized ? context : null}>
        <Markdown text={text} />
      </MarkdownLinkContext.Provider>
    )
  );
}

async function click(selector: string, type = 'click') {
  const element = container.querySelector(selector);
  expect(element).not.toBeNull();
  let prevented = false;
  await act(async () => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    element?.dispatchEvent(event);
    prevented = event.defaultPrevented;
  });
  return prevented;
}

beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', {
    userAgent: 'Windows',
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(dom.window, {
    electronAPI: {
      workspaceFiles: {
        open: harness.open,
        openContext: harness.openContext,
        reveal: harness.reveal,
        readImage: harness.readImage,
      },
    },
  });
  container = dom.document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
  vi.clearAllMocks();
  harness.open.mockResolvedValue({ ok: true, target: 'internal', viewer: 'text', rel: 'src/a.ts' });
  harness.reveal.mockResolvedValue({ ok: true });
  harness.openContext.mockResolvedValue({ ok: true });
  harness.contextMenuOpen = [
    { id: 'reveal', target: 'reveal', enabled: true },
    { id: 'vscode', target: 'vscode', enabled: true },
  ];
  harness.readImage.mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,AAAA' });
  harness.projects = [];
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('聊天文件链接的打开方式', () => {
  it.each(['[source](src/a.ts)', '`src/a.ts`'])(
    'SSH 隐藏全部 reveal 菜单和按钮：%s',
    async (text) => {
      harness.projects = [{ id: 'project', kind: 'ssh' }];
      await render(text);
      expect(container.querySelector('button[aria-label="Reveal in File Explorer"]')).toBeNull();
      await click(text.startsWith('[') ? 'a' : 'button', 'contextmenu');
      expect(
        [...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
      ).toEqual(['Open in {{app}}']);
    }
  );
  it.each([
    ['[source](src/a.ts:12)', 'a'],
    ['`src/a.ts:12`', 'button'],
  ])('右键文件链接先展示列表，点击后只发送条目标识：%s', async (text, selector) => {
    await render(text);
    expect(await click(selector, 'contextmenu')).toBe(true);
    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    expect(harness.openContext).not.toHaveBeenCalled();
    await click('[role="menuitem"]:last-child');
    expect(harness.openContext).toHaveBeenCalledWith({
      conversationId: 'child',
      projectId: 'project',
      rel: 'src/a.ts',
      itemId: 'vscode',
    });
    expect(harness.open).not.toHaveBeenCalled();
    expect(harness.reveal).not.toHaveBeenCalled();
    expect(harness.openSidePanelFile).not.toHaveBeenCalled();
  });

  it('菜单只显示启用项，允许多应用并仅传所选应用的标识', async () => {
    harness.contextMenuOpen = [
      { id: 'reveal', target: 'reveal', enabled: false },
      { id: 'vscode', target: 'vscode', enabled: true },
      { id: 'custom', target: 'application', enabled: true, applicationPath: 'C:/Apps/Editor.exe' },
      { id: 'off', target: 'application', enabled: false, applicationPath: 'C:/Apps/Other.exe' },
    ];
    await render('[source](src/a.ts)');
    await click('a', 'contextmenu');
    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    await click('[role="menuitem"]:last-child');
    expect(harness.openContext).toHaveBeenCalledWith({
      conversationId: 'child',
      projectId: 'project',
      rel: 'src/a.ts',
      itemId: 'custom',
    });
  });

  it('右键不接管外链或无权限链接，越界链接拒绝调用 IPC', async () => {
    await render('[web](https://example.com)');
    expect(await click('a', 'contextmenu')).toBe(false);
    await render('[local](src/a.ts)', false);
    expect(await click('a', 'contextmenu')).toBe(false);
    await render('[escape](../secret.txt)');
    await click('a', 'contextmenu');
    await click('[role="menuitem"]');
    expect(harness.openContext).not.toHaveBeenCalled();
    expect(harness.toast).toHaveBeenCalled();
  });

  it('正文文本调用 open，以原会话 owner 打开内部 Files 而不是 reveal', async () => {
    await render('[source](src/a.ts)');
    expect(await click('a')).toBe(true);
    expect(harness.open).toHaveBeenCalledWith({
      conversationId: 'child',
      projectId: 'project',
      rel: 'src/a.ts',
    });
    expect(harness.openSidePanelFile).toHaveBeenCalledWith('child', 'src/a.ts');
    expect(harness.reveal).not.toHaveBeenCalled();
  });

  it('Markdown 正文指定预览，handled 可执行文件不再打开内部面板', async () => {
    harness.open.mockResolvedValueOnce({
      ok: true,
      target: 'internal',
      viewer: 'markdown',
      rel: 'README.md',
    });
    await render('[doc](README.md)');
    await click('a');
    expect(harness.openSidePanelFile).toHaveBeenCalledWith(
      'child',
      'README.md',
      undefined,
      'markdown'
    );
    harness.openSidePanelFile.mockClear();
    harness.open.mockResolvedValueOnce({ ok: true, target: 'handled' });
    await render('[exe](app.exe)');
    await click('a');
    expect(harness.openSidePanelFile).not.toHaveBeenCalled();
  });

  it('文件管理器图标是链接的独立兄弟按钮，始终只 reveal', async () => {
    await render('[doc](README.md)');
    const button = container.querySelector('button[aria-label="Reveal in File Explorer"]');
    expect(button).not.toBeNull();
    expect(button?.closest('a')).toBeNull();
    expect(button?.getAttribute('title')).toBe('Reveal in File Explorer');
    await click('button[aria-label="Reveal in File Explorer"]');
    expect(harness.reveal).toHaveBeenCalledWith({
      conversationId: 'child',
      projectId: 'project',
      rel: 'README.md',
    });
    expect(harness.open).not.toHaveBeenCalled();
  });

  it('AI 生成的 Windows 安装包表格链接与定位按钮使用相同的工作区相对路径', async () => {
    harness.open.mockResolvedValueOnce({ ok: true, target: 'handled' });
    await render(
      '| 安装包 | 大小 |\n| --- | --- |\n| [国内版：馆长](/C:/workspace/dist/%E9%A6%86%E9%95%BF-1.0.11.exe) | 273.35 MiB |'
    );
    await click('td a');
    expect(harness.open).toHaveBeenCalledWith({
      conversationId: 'child',
      projectId: 'project',
      rel: 'dist/馆长-1.0.11.exe',
    });
    await click('button[aria-label="Reveal in File Explorer"]');
    expect(harness.reveal).toHaveBeenCalledWith({
      conversationId: 'child',
      projectId: 'project',
      rel: 'dist/馆长-1.0.11.exe',
    });
    expect(harness.openSidePanelFile).not.toHaveBeenCalled();
    expect(harness.toast).not.toHaveBeenCalled();
  });

  it('带前导斜杠的 Windows 文档链接保留源码跳行', async () => {
    await render('[source](/C:/workspace/src/a.ts:12)');
    await click('a');
    expect(harness.openSidePanelFile).toHaveBeenCalledWith('child', 'src/a.ts', 12);
    expect(harness.open).not.toHaveBeenCalled();
    expect(harness.toast).not.toHaveBeenCalled();
  });

  it('图片通过有权限的 readImage 显示 dataUrl，不导航到磁盘 URL', async () => {
    harness.open.mockResolvedValueOnce({
      ok: true,
      target: 'internal',
      viewer: 'image',
      rel: 'image.png',
    });
    await render('[image](image.png)');
    await click('a');
    expect(harness.readImage).toHaveBeenCalledWith({
      conversationId: 'child',
      projectId: 'project',
      rel: 'image.png',
    });
    expect(container.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe(
      'data:image/png;base64,AAAA'
    );
    expect(harness.openSidePanelFile).not.toHaveBeenCalled();
  });

  it('Markdown 行号与行内路径保留源码跳行，绕过用户打开规则', async () => {
    await render('[line](src/README.md:12) and `src/a.ts:7`');
    await click('a');
    expect(harness.openSidePanelFile).toHaveBeenCalledWith('child', 'src/README.md', 12);
    await click('button:not([aria-label])');
    expect(harness.openSidePanelFile).toHaveBeenCalledWith('child', 'src/a.ts', 7);
    expect(harness.open).not.toHaveBeenCalled();
  });

  it('http 链接维持外链，无上下文本地链接不导航且不展示 reveal 按钮', async () => {
    await render('[web](https://example.com)');
    expect(container.querySelector('a')?.getAttribute('target')).toBe('_blank');
    expect(await click('a')).toBe(false);
    expect(container.querySelector('button')).toBeNull();
    await render('[local](src/a.ts)', false);
    expect(await click('a')).toBe(true);
    expect(container.querySelector('a')?.getAttribute('href')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(harness.open).not.toHaveBeenCalled();
  });

  it('越界与危险协议被拒绝，后端不可预览错误仍 toast', async () => {
    await render('[escape](../secret.txt)');
    await click('a');
    expect(harness.open).not.toHaveBeenCalled();
    expect(harness.toast).toHaveBeenCalled();
    await render('[danger](javascript:alert(1))');
    await click('a');
    expect(harness.open).not.toHaveBeenCalled();
    harness.open.mockResolvedValueOnce({ ok: false, error: 'unsupported-viewer' });
    await render('[binary](data.xyz)');
    await click('a');
    expect(harness.toast).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('有上下文本地链接可聚焦并用 Enter 打开，无上下文链接不可操作', async () => {
    await render('[source](src/a.ts)');
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('role')).toBe('link');
    expect(anchor?.getAttribute('tabindex')).toBe('0');
    await act(async () => {
      const event = new window.Event('keydown', { bubbles: true, cancelable: true });
      Object.assign(event, { key: 'Enter' });
      anchor?.dispatchEvent(event);
    });
    expect(harness.openSidePanelFile).toHaveBeenCalledWith('child', 'src/a.ts');
    await render('[source](src/a.ts)', false);
    expect(container.querySelector('a')?.getAttribute('tabindex')).toBeNull();
  });

  it('ICO 和 SVG 遵循真实 readImage MIME，SVG 只作为 img 显示', async () => {
    harness.open.mockResolvedValueOnce({
      ok: true,
      target: 'internal',
      viewer: 'image',
      rel: 'icon.ico',
    });
    harness.readImage.mockResolvedValueOnce({ ok: true, dataUrl: 'data:image/x-icon;base64,AAAA' });
    await render('[icon](icon.ico)');
    await click('a');
    expect(container.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe(
      'data:image/x-icon;base64,AAAA'
    );
    harness.readImage.mockClear();
    harness.open.mockResolvedValueOnce({
      ok: true,
      target: 'internal',
      viewer: 'image',
      rel: 'vector.svg',
    });
    harness.readImage.mockResolvedValueOnce({
      ok: true,
      dataUrl: 'data:image/svg+xml;base64,AAAA',
    });
    await render('[svg](vector.svg)');
    await click('a');
    expect(container.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe(
      'data:image/svg+xml;base64,AAAA'
    );
    expect(container.querySelector('iframe, object, embed')).toBeNull();
  });
});

describe('气泡文件卡片', () => {
  async function chip(path: string, authorized = true) {
    expect(LocalFileTrigger).toBeTypeOf('function');
    await act(async () =>
      root.render(
        <MarkdownLinkContext.Provider value={authorized ? context : null}>
          <LocalFileTrigger path={path}>
            <span data-chip="">file</span>
          </LocalFileTrigger>
        </MarkdownLinkContext.Provider>
      )
    );
  }
  const labels = () =>
    [...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);

  it.each(['src/100%.txt', 'src/a%20b.txt', 'src/report#draft.txt', 'src/what?.txt'])(
    '文件 mention 保留原始文件名而不作 URL 解码或截断：%s',
    async (path) => {
      await chip(path);
      await click('[data-chip]');
      expect(harness.open).toHaveBeenCalledWith({
        conversationId: 'child',
        projectId: 'project',
        rel: path,
      });
      await click('[data-chip]', 'contextmenu');
      await click('[role="menuitem"]:last-child');
      expect(harness.openContext).toHaveBeenCalledWith({
        conversationId: 'child',
        projectId: 'project',
        rel: path,
        itemId: 'vscode',
      });
    }
  );

  it('mention 的 #L 行号后缀只定位行，不把其他 # 当 URL 片段', async () => {
    await chip('src/a#draft.ts#L6-L11');
    await click('[data-chip]');
    expect(harness.openSidePanelFile).toHaveBeenCalledWith('child', 'src/a#draft.ts', 6);
    expect(harness.open).not.toHaveBeenCalled();
  });

  it('Windows 卡片点击和 Enter 共用现有 open 链路，只传工作区相对路径', async () => {
    await chip('C:\\workspace\\src\\a.ts');
    await click('[data-chip]');
    expect(harness.open).toHaveBeenCalledWith({
      conversationId: 'child',
      projectId: 'project',
      rel: 'src/a.ts',
    });
    expect(harness.openSidePanelFile).toHaveBeenCalledWith('child', 'src/a.ts');
    await act(async () => {
      const event = new window.Event('keydown', { bubbles: true, cancelable: true });
      Object.assign(event, { key: 'Enter' });
      container.querySelector('[role="link"]')?.dispatchEvent(event);
    });
    expect(harness.open).toHaveBeenCalledTimes(2);
  });

  it('固定复制路径、补充 reveal，并且启用设置时不重复', async () => {
    harness.contextMenuOpen = [];
    await chip('src/a.ts');
    await click('[data-chip]', 'contextmenu');
    expect(labels()).toEqual(['Reveal in File Explorer', 'Copy Path']);
    await click('[role="menuitem"]');
    expect(harness.reveal).toHaveBeenCalledWith({
      conversationId: 'child',
      projectId: 'project',
      rel: 'src/a.ts',
    });
    harness.contextMenuOpen = [{ id: 'reveal', enabled: true, target: 'reveal' }];
    await chip('src/a.ts');
    expect(labels()).toEqual(['Copy Path', 'Reveal in File Explorer']);
  });

  it('SSH 即便启用 reveal 设置也只显示复制与应用项', async () => {
    harness.projects = [{ id: 'project', kind: 'ssh' }];
    await chip('src/a.ts');
    await click('[data-chip]', 'contextmenu');
    expect(labels()).toEqual(['Copy Path', 'Open in {{app}}']);
  });

  it('卡片配置项仍只传条目标识与相对路径，图片复用 readImage 预览', async () => {
    await chip('C:\\workspace\\src\\a.ts');
    await click('[data-chip]', 'contextmenu');
    await click('[role="menuitem"]:last-child');
    expect(harness.openContext).toHaveBeenCalledWith({
      conversationId: 'child',
      projectId: 'project',
      rel: 'src/a.ts',
      itemId: 'vscode',
    });
    harness.open.mockResolvedValueOnce({
      ok: true,
      target: 'internal',
      viewer: 'image',
      rel: 'image.png',
    });
    await chip('image.png');
    await click('[data-chip]');
    expect(harness.readImage).toHaveBeenCalledWith({
      conversationId: 'child',
      projectId: 'project',
      rel: 'image.png',
    });
    expect(container.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe(
      'data:image/png;base64,AAAA'
    );
    expect(container.querySelector('iframe,object,embed')).toBeNull();
  });

  it.each([
    ['C:\\outside\\file.pdf', true],
    ['../secret.txt', true],
    ['src/a.ts', false],
    ['javascript:alert(1)', true],
  ] as const)('越界/无上下文/危险路径只复制原文且不发 Main：%s %s', async (path, authorized) => {
    await chip(path, authorized);
    await click('[data-chip]');
    await click('[data-chip]', 'contextmenu');
    expect(labels()).toEqual(['Copy Path']);
    await click('[role="menuitem"]');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(path);
    expect(harness.open).not.toHaveBeenCalled();
    expect(harness.reveal).not.toHaveBeenCalled();
    expect(harness.openContext).not.toHaveBeenCalled();
    expect(harness.openSidePanelFile).not.toHaveBeenCalled();
  });

  it('复制失败只提示错误', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
    await chip('src/a.ts');
    await click('[data-chip]', 'contextmenu');
    const item = [...container.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === 'Copy Path'
    );
    await act(async () => item?.dispatchEvent(new window.Event('click', { bubbles: true })));
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', description: 'denied' })
    );
  });
});
