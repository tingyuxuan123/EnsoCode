import { useState } from 'react';
import { DangerConfirm, MenuItem, MenuPanel, MenuSeparator, Spinner, useDismiss } from '../Controls';
import { useWorkbench } from '../Workbench';
import { contentHits, fileIcon, flatFiles, sources, tree, type TreeNode } from './fileData';
import { DashedState, IconButton, ModeTabs } from './PanelUI';
import { useReadPanelPreset } from './preset';

export type FilesPreset = {
  open: string[];
  active: string;
  expanded: string[];
  dirty: string[];
  diskChanged: string;
  search: boolean;
  searchMode: 'name' | 'content';
  query: string;
  menu: string;
  markdownPreview: boolean;
  loading: boolean;
};

const tooLarge = 'pnpm-lock.yaml';
const isImage = (rel: string) => /\.(png|jpe?g)$/.test(rel);
const baseName = (rel: string) => rel.split('/').at(-1) ?? rel;

/** 右键菜单（sidepanel/fileTreeMenu.tsx） */
function TreeMenu({ node, onClose, onAction }: { node: TreeNode | null; onClose: () => void; onAction: (action: string) => void }) {
  const ref = useDismiss<HTMLDivElement>(true, onClose);
  const file = node && !node.dir;
  return (
    <div ref={ref}>
      <MenuPanel label="文件操作" className="left-16 top-0 w-48">
        <MenuItem icon="icon-[lucide--file-plus]" label="新文件" onClick={() => onAction('new-file')} />
        <MenuItem icon="icon-[lucide--folder-plus]" label="新建文件夹" onClick={() => onAction('new-folder')} />
        {node && (
          <>
            <MenuSeparator />
            {file && node.name.endsWith('.md') && <MenuItem icon="icon-[lucide--eye]" label="打开 Markdown 预览" onClick={() => onAction('preview')} />}
            {file && /\.(html|md|png|jpg)$/.test(node.name) && <MenuItem icon="icon-[lucide--globe]" label="在浏览器中打开" onClick={() => onAction('browser')} />}
            <MenuItem icon="icon-[lucide--copy]" label="复制路径" onClick={() => onAction('copy-path')} />
            <MenuItem icon="icon-[lucide--copy]" label="复制相对路径" onClick={() => onAction('copy-rel')} />
            {file && <MenuItem icon="icon-[lucide--files]" label="复制" onClick={() => onAction('copy-file')} />}
            <MenuItem icon="icon-[lucide--folder-search]" label="在访达中显示" onClick={() => onAction('reveal')} />
            <MenuSeparator />
            <MenuItem icon="icon-[lucide--pencil]" label="重命名" onClick={() => onAction('rename')} />
            <MenuItem icon="icon-[lucide--message-square-plus]" label="发送到对话" onClick={() => onAction('send')} />
            <MenuSeparator />
            <MenuItem icon="icon-[lucide--trash-2]" label="删除" danger onClick={() => onAction('delete')} />
          </>
        )}
      </MenuPanel>
    </div>
  );
}

function ImagePreview({ name }: { name: string }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2 text-[11px] text-muted">
        <span className="icon-[lucide--image] size-3.5" />
        图片预览 · {name} · 1440 × 900
        <span className="ml-auto" />
        <IconButton icon="icon-[lucide--zoom-out]" label="缩小" onClick={() => setZoom(Math.max(0.25, zoom / 1.25))} />
        <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <IconButton icon="icon-[lucide--zoom-in]" label="放大" onClick={() => setZoom(Math.min(4, zoom * 1.25))} />
        <IconButton icon="icon-[lucide--scan]" label="适应面板" onClick={() => setZoom(1)} />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--color-control)_0%_25%,var(--color-surface)_0%_50%)] bg-[length:16px_16px] p-4">
        <svg viewBox="0 0 288 180" style={{ width: 240 * zoom }} className="shrink-0 rounded-[4px] border border-border bg-surface" aria-label={name}>
          <rect width="288" height="180" fill="var(--color-panel)" />
          <rect x="0" y="0" width="14" height="180" fill="var(--color-control)" />
          <rect x="14" y="0" width="56" height="180" fill="var(--color-sidebar)" />
          <rect x="22" y="12" width="40" height="6" rx="2" fill="var(--color-border)" />
          <rect x="22" y="26" width="34" height="4" rx="2" fill="var(--color-border)" />
          <rect x="22" y="36" width="30" height="4" rx="2" fill="var(--color-border)" />
          <rect x="70" y="0" width="150" height="180" fill="var(--color-surface)" />
          <rect x="88" y="18" width="96" height="10" rx="3" fill="var(--color-control)" />
          <rect x="88" y="38" width="112" height="4" rx="2" fill="var(--color-border)" />
          <rect x="88" y="48" width="100" height="4" rx="2" fill="var(--color-border)" />
          <rect x="88" y="150" width="116" height="18" rx="3" fill="var(--color-input)" stroke="var(--color-border)" />
          <rect x="220" y="0" width="68" height="180" fill="var(--color-panel)" />
          <rect x="228" y="14" width="44" height="4" rx="2" fill="var(--color-primary)" />
        </svg>
      </div>
    </div>
  );
}

function MarkdownPreview() {
  return (
    <div className="h-full overflow-auto px-5 py-4 text-[13px] leading-6">
      <h1 className="mb-3 text-[18px] font-semibold">EnsoCode 开发约定</h1>
      <p className="text-muted">本文件是项目对人类和 AI 贡献者都适用的长期约定。</p>
      <h2 className="mb-1 mt-4 text-[14px] font-semibold">开发原则</h2>
      <ul className="list-disc pl-5 text-muted">
        <li>变更范围保持最小，不做无关重构或功能扩展。</li>
        <li>优先复用现有实现模式。</li>
      </ul>
      <h2 className="mb-1 mt-4 text-[14px] font-semibold">提交前检查</h2>
      <pre className="rounded-control bg-code px-3 py-2 font-mono text-[12px]">pnpm typecheck && pnpm lint && pnpm test</pre>
    </div>
  );
}

function CodeEditor({ rel, dirty, onEdit }: { rel: string; dirty: boolean; onEdit: () => void }) {
  const text = sources[rel] ?? `// ${rel}\n`;
  const lines = text.split('\n');
  return (
    <div className="flex h-full min-h-0 overflow-auto bg-surface font-mono text-[12px] leading-[20px]" onKeyDown={onEdit} tabIndex={0} aria-label={`编辑 ${baseName(rel)}`}>
      <div className="sticky left-0 shrink-0 select-none bg-surface py-2 pl-2 pr-3 text-right text-faint">
        {lines.map((_, index) => <div key={index}>{index + 1}</div>)}
      </div>
      <pre className="min-w-0 flex-1 py-2 pr-4">
        {lines.map((line, index) => (
          <div key={index} className={dirty && index === 11 ? 'bg-primary-soft/60' : ''}>{line || ' '}</div>
        ))}
      </pre>
    </div>
  );
}

/**
 * 文件面板（sidepanel/FilesView.tsx）：左 w-56 文件树（搜索 / 刷新）+ 右侧多标签编辑器。
 * 编辑器支持未保存圆点、磁盘已更改→重新加载、文件太大、Markdown 预览/查看源码、图片预览缩放。
 */
export function FilesView() {
  const preset = useReadPanelPreset<FilesPreset>('files');
  const { setNotice } = useWorkbench();
  const [open, setOpen] = useState<string[]>(preset.open ?? ['src/renderer/App.tsx']);
  const [active, setActive] = useState(preset.active ?? preset.open?.[0] ?? 'src/renderer/App.tsx');
  const [expanded, setExpanded] = useState<string[]>(preset.expanded ?? ['src', 'src/renderer', 'src/renderer/components', 'src/renderer/components/chat']);
  const [dirty, setDirty] = useState<string[]>(preset.dirty ?? []);
  const [diskChanged, setDiskChanged] = useState(preset.diskChanged ?? '');
  const [search, setSearch] = useState(preset.search ?? false);
  const [searchMode, setSearchMode] = useState<'name' | 'content'>(preset.searchMode ?? 'name');
  const [query, setQuery] = useState(preset.query ?? '');
  const [menu, setMenu] = useState<string | null>(preset.menu ?? null);
  const [mdPreview, setMdPreview] = useState<string[]>(preset.markdownPreview ? ['AGENTS.md'] : []);
  const [refreshing, setRefreshing] = useState(preset.loading ?? false);
  const [renaming, setRenaming] = useState('');
  const [deleting, setDeleting] = useState('');
  const [closing, setClosing] = useState('');
  const [tabMenu, setTabMenu] = useState('');
  const tabRef = useDismiss<HTMLDivElement>(Boolean(tabMenu), () => setTabMenu(''));

  const openFile = (rel: string) => {
    if (!open.includes(rel)) setOpen([...open, rel]);
    setActive(rel);
  };
  const closeTab = (rel: string, force = false) => {
    if (dirty.includes(rel) && !force) { setClosing(rel); return; }
    const next = open.filter((item) => item !== rel);
    setOpen(next);
    setDirty(dirty.filter((item) => item !== rel));
    if (active === rel) setActive(next.at(-1) ?? '');
    setClosing('');
  };
  const refresh = () => { setRefreshing(true); window.setTimeout(() => setRefreshing(false), 900); };
  const nodeOf = (rel: string, nodes: TreeNode[] = tree): TreeNode | null => {
    for (const node of nodes) {
      if (node.rel === rel) return node;
      const hit = node.children && nodeOf(rel, node.children);
      if (hit) return hit;
    }
    return null;
  };
  const action = (name: string) => {
    const target = menu ?? '';
    setMenu(null);
    if (name === 'delete') setDeleting(target);
    else if (name === 'rename') setRenaming(target);
    else if (name === 'preview') { openFile(target); setMdPreview([...mdPreview, target]); }
    else if (name === 'send') setNotice(`已把 @${baseName(target)} 插入主输入框（设计预览）。`);
    else if (name === 'browser') setNotice(`在内嵌浏览器中打开 ${baseName(target)}（设计预览）。`);
    else if (name.startsWith('new')) setNotice(name === 'new-file' ? '在所选目录下出现可编辑的新文件行（设计预览）。' : '在所选目录下出现可编辑的新文件夹行（设计预览）。');
    else setNotice('已复制到剪贴板（设计预览）。');
  };

  const renderNodes = (nodes: TreeNode[], depth: number) => nodes.map((node) => {
    const isOpen = expanded.includes(node.rel);
    return (
      <div key={node.rel} className="relative">
        <div
          role="treeitem"
          aria-expanded={node.dir ? isOpen : undefined}
          tabIndex={0}
          onClick={() => (node.dir ? setExpanded(isOpen ? expanded.filter((rel) => rel !== node.rel) : [...expanded, node.rel]) : openFile(node.rel))}
          onContextMenu={(event) => { event.preventDefault(); setMenu(node.rel); }}
          style={{ paddingLeft: 6 + depth * 12 }}
          className={`flex h-[26px] cursor-pointer items-center gap-1 pr-2 text-[12px] ${active === node.rel ? 'bg-selected text-surface-foreground' : 'hover:bg-hover'}`}
        >
          {node.dir ? <span className={`${isOpen ? 'icon-[lucide--chevron-down]' : 'icon-[lucide--chevron-right]'} size-3 shrink-0 text-faint`} /> : <span className="w-3 shrink-0" />}
          <span className={`${node.dir ? (isOpen ? 'icon-[lucide--folder-open]' : 'icon-[lucide--folder]') + ' text-faint' : fileIcon(node.name)} size-3.5 shrink-0`} />
          {renaming === node.rel ? (
            <input autoFocus defaultValue={node.name} aria-label="重命名" onBlur={() => setRenaming('')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') setRenaming(''); }} onClick={(event) => event.stopPropagation()} className="h-5 min-w-0 flex-1 rounded-[3px] border border-primary/60 bg-surface px-1 text-[12px] outline-none" />
          ) : (
            <span className={`min-w-0 flex-1 truncate ${node.status === 'U' ? 'text-success' : node.status ? 'text-warning' : ''}`}>{node.name}</span>
          )}
          {node.status && <span className={`shrink-0 font-mono text-[11px] ${node.status === 'U' || node.status === 'A' ? 'text-success' : 'text-warning'}`}>{node.status}</span>}
        </div>
        {menu === node.rel && <TreeMenu node={node} onClose={() => setMenu(null)} onAction={action} />}
        {node.dir && isOpen && node.children && renderNodes(node.children, depth + 1)}
      </div>
    );
  });

  const nameHits = flatFiles().filter((file) => query && file.rel.toLowerCase().includes(query.toLowerCase()));
  const textHits = contentHits.filter((hit) => query && hit.text.toLowerCase().includes(query.toLowerCase()));
  const activeName = baseName(active);
  const showMd = mdPreview.includes(active);

  return (
    <div className="flex h-full min-h-0 bg-panel">
      <div className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-line bg-surface text-[12px]">
        <div className="flex h-8 shrink-0 items-center justify-end gap-0.5 px-1">
          <span className="mr-auto truncate pl-2 text-[11px] font-medium text-muted">EnsoCode</span>
          <IconButton icon="icon-[lucide--search]" label="搜索" active={search} onClick={() => setSearch(!search)} />
          <IconButton icon={refreshing ? 'icon-[lucide--refresh-cw] vetd-spin' : 'icon-[lucide--refresh-cw]'} label="刷新" onClick={refresh} />
        </div>
        {search ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 space-y-1.5 px-2 pb-2">
              <label className="flex h-7 items-center gap-1.5 rounded-control border border-border bg-input px-2 text-muted focus-within:border-primary/60">
                <span className="icon-[lucide--search] size-3.5" />
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setSearch(false); } }} placeholder={searchMode === 'name' ? '搜索文件名' : '搜索文件内容'} aria-label="搜索" className="min-w-0 flex-1 bg-transparent text-[12px] text-surface-foreground outline-none" />
                {query && <button aria-label="清除" onClick={() => setQuery('')}><span className="icon-[lucide--x] size-3" /></button>}
              </label>
              <ModeTabs label="搜索范围" value={searchMode} onChange={setSearchMode} options={[{ value: 'name', label: '文件名' }, { value: 'content', label: '内容' }]} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {!query ? (
                <p className="px-3 py-6 text-center text-[11px] text-faint">输入关键词搜索此工作区。</p>
              ) : searchMode === 'name' ? (
                nameHits.length ? nameHits.map((hit) => (
                  <button key={hit.rel} onClick={() => openFile(hit.rel)} onContextMenu={(event) => { event.preventDefault(); setMenu(hit.rel); }} className="flex w-full items-start gap-1.5 px-2 py-1 text-left hover:bg-hover">
                    <span className={`${fileIcon(hit.name)} mt-0.5 size-3.5 shrink-0`} />
                    <span className="min-w-0">
                      <span className="block truncate">{hit.name}</span>
                      <span className="block truncate font-mono text-[11px] text-faint">{hit.rel}</span>
                    </span>
                  </button>
                )) : <p className="px-3 py-6 text-center text-[11px] text-muted">无匹配结果</p>
              ) : textHits.length ? (
                <>
                  <p className="px-2 pb-1 text-[11px] text-faint">{textHits.length} 处匹配 · {new Set(textHits.map((hit) => hit.rel)).size} 个文件</p>
                  {textHits.map((hit) => (
                    <button key={`${hit.rel}:${hit.line}`} onClick={() => openFile(hit.rel)} className="block w-full px-2 py-1 text-left hover:bg-hover">
                      <span className="flex items-center gap-1 text-[11px]"><span className="truncate font-medium">{baseName(hit.rel)}</span><span className="text-faint">:{hit.line}</span></span>
                      <span className="block truncate font-mono text-[11px] text-muted">{hit.text}</span>
                    </button>
                  ))}
                </>
              ) : <p className="px-3 py-6 text-center text-[11px] text-muted">无匹配结果</p>}
            </div>
          </div>
        ) : (
          <div role="tree" aria-label="文件树" className="relative min-h-0 flex-1 overflow-auto pb-2" onContextMenu={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); setMenu(''); } }}>
            {refreshing && <div className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-faint"><Spinner className="size-3" />加载中...</div>}
            {renderNodes(tree, 0)}
            {menu === '' && <TreeMenu node={null} onClose={() => setMenu(null)} onAction={action} />}
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        {open.length > 0 && (
          <div ref={tabRef} className="relative flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-line bg-panel [scrollbar-width:none]">
            {open.map((rel) => (
              <div key={rel} onContextMenu={(event) => { event.preventDefault(); setTabMenu(rel); }} className={`group flex shrink-0 items-center gap-1 border-r border-line pl-2.5 pr-1 text-[12px] ${active === rel ? 'bg-surface' : 'text-muted hover:bg-hover'}`}>
                <button onClick={() => setActive(rel)} className="flex items-center gap-1.5">
                  <span className={`${fileIcon(rel)} size-3.5`} />
                  <span className={mdPreview.includes(rel) ? 'italic' : ''}>{baseName(rel)}</span>
                </button>
                <button aria-label={dirty.includes(rel) ? '未保存的更改' : '关闭'} title={dirty.includes(rel) ? '未保存的更改' : '关闭'} onClick={() => closeTab(rel)} className="flex size-5 items-center justify-center rounded-[3px] hover:bg-control">
                  {dirty.includes(rel) ? <span className="size-2 rounded-full bg-surface-foreground group-hover:hidden" /> : null}
                  <span className={`icon-[lucide--x] size-3 ${dirty.includes(rel) ? 'hidden group-hover:block' : active === rel ? '' : 'opacity-0 group-hover:opacity-100'}`} />
                </button>
                {tabMenu === rel && (
                  <MenuPanel label="标签操作" className="left-2 top-8 w-40">
                    <MenuItem label="关闭" onClick={() => { setTabMenu(''); closeTab(rel); }} />
                    <MenuItem label="关闭其他" onClick={() => { setTabMenu(''); setOpen(open.filter((item) => item === rel || dirty.includes(item))); setActive(rel); }} />
                    <MenuItem label="关闭右侧标签页" onClick={() => { setTabMenu(''); setOpen(open.slice(0, open.indexOf(rel) + 1)); }} />
                    <MenuItem label="关闭已保存" onClick={() => { setTabMenu(''); setOpen(open.filter((item) => dirty.includes(item))); }} />
                    <MenuItem label="关闭所有" onClick={() => { setTabMenu(''); setOpen(open.filter((item) => dirty.includes(item))); }} />
                    {dirty.length > 0 && <MenuItem label="强制关闭所有" danger onClick={() => { setTabMenu(''); setOpen([]); setDirty([]); setActive(''); }} />}
                  </MenuPanel>
                )}
              </div>
            ))}
          </div>
        )}
        {active && (
          <div className="flex h-7 shrink-0 items-center gap-1 border-b border-line px-2 text-[11px] text-muted">
            <span className="min-w-0 flex-1 truncate font-mono">{active}</span>
            {activeName.endsWith('.md') && (
              <button onClick={() => setMdPreview(showMd ? mdPreview.filter((rel) => rel !== active) : [...mdPreview, active])} className="flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 hover:bg-hover hover:text-surface-foreground">
                <span className={`${showMd ? 'icon-[lucide--code]' : 'icon-[lucide--eye]'} size-3`} />
                {showMd ? '查看源码' : '预览'}
              </button>
            )}
            {dirty.includes(active) && <span className="text-surface-foreground">未保存的更改 · ⌘S 保存</span>}
          </div>
        )}
        {active && diskChanged === active && (
          <div className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning-soft px-3 py-1.5 text-[12px]">
            <span className="icon-[lucide--triangle-alert] size-3.5 shrink-0 text-warning" />
            <span className="min-w-0 flex-1">磁盘上的文件已更改。</span>
            <button onClick={() => { setDiskChanged(''); setDirty(dirty.filter((rel) => rel !== active)); }} className="rounded-control border border-border bg-surface px-2 py-0.5 hover:bg-hover">重新加载</button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {!active ? (
            <div className="flex h-full items-center justify-center text-[12px] text-muted">从左侧树打开文件。</div>
          ) : activeName === tooLarge ? (
            <DashedState icon="icon-[lucide--file-warning]">
              文件太大，无法在编辑器中打开。
              <button onClick={() => setNotice('已用系统默认应用打开 pnpm-lock.yaml（设计预览）。')} className="text-primary">用系统默认应用打开</button>
            </DashedState>
          ) : isImage(active) ? (
            <ImagePreview name={activeName} />
          ) : showMd ? (
            <MarkdownPreview />
          ) : (
            <CodeEditor rel={active} dirty={dirty.includes(active)} onEdit={() => !dirty.includes(active) && setDirty([...dirty, active])} />
          )}
        </div>
      </div>
      {deleting && <DangerConfirm title={`永久删除 ${baseName(deleting)}？`} description={nodeOf(deleting)?.dir ? '文件夹及其中所有内容将被删除。' : '此文件将从磁盘删除，无法撤销。'} confirmLabel="删除" requireCheck={false} onClose={() => setDeleting('')} onConfirm={() => { setDeleting(''); closeTab(deleting, true); }} />}
      {closing && <DangerConfirm title="未保存的更改" description="此文件有未保存的更改，仍要关闭吗？" confirmLabel="关闭" requireCheck={false} onClose={() => setClosing('')} onConfirm={() => closeTab(closing, true)} />}
    </div>
  );
}
