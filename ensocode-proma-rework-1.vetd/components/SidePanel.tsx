import { useState } from 'react';
import { MenuItem, MenuPanel, MenuSeparator, useDismiss } from './Controls';
import { sideTabKinds } from './data';
import { AgentsView } from './panel/AgentsView';
import { BrowserView } from './panel/BrowserView';
import { BtwView } from './panel/BtwView';
import { ChangesView } from './panel/ChangesView';
import { FilesView } from './panel/FilesView';
import { TerminalView } from './panel/TerminalView';
import { WorkflowView } from './panel/WorkflowView';
import { useWorkbench, type SideTab } from './Workbench';

function View({ tab }: { tab: SideTab }) {
  if (tab.kind === 'files') return <FilesView />;
  if (tab.kind === 'changes') return <ChangesView />;
  if (tab.kind === 'terminal') return <TerminalView title={tab.title} />;
  if (tab.kind === 'browser') return <BrowserView />;
  if (tab.kind === 'btw') return <BtwView />;
  if (tab.kind === 'agents') return <AgentsView />;
  return <WorkflowView />;
}

/**
 * 右侧停靠面板（sidepanel/SidePanel.tsx，dockview）：可新建/关闭标签、全屏。
 * 默认宽 360，最小 280；对话区至少保留 360。
 */
export function SidePanel({ width = 360 }: { width?: number }) {
  const { inspectorOpen, sideTabs, setSideTabs, inspectorTab, setInspectorTab, openSideTab, sideFullscreen, setSideFullscreen, panelPreset } = useWorkbench();
  const [addMenu, setAddMenu] = useState(false);
  const [tabMenu, setTabMenu] = useState('');
  const addRef = useDismiss<HTMLDivElement>(addMenu, () => setAddMenu(false));
  const tabRef = useDismiss<HTMLDivElement>(Boolean(tabMenu), () => setTabMenu(''));
  if (!inspectorOpen) return null;
  const active = sideTabs.find((tab) => tab.id === inspectorTab) ?? sideTabs[0];
  const close = (ids: string[]) => {
    const next = sideTabs.filter((tab) => !ids.includes(tab.id));
    setSideTabs(next);
    if (active && ids.includes(active.id)) setInspectorTab(next.at(-1)?.id ?? '');
    setTabMenu('');
  };
  const icon = (kind: string) => sideTabKinds.find((item) => item.id === kind)?.icon ?? 'icon-[lucide--square]';
  return (
    <aside data-slot="side-panel" aria-label="右侧面板" style={sideFullscreen ? undefined : { width }} className={`flex min-h-0 shrink-0 flex-col bg-surface ${sideFullscreen ? 'absolute inset-0 z-30' : 'border-l border-line'}`}>
      <div className="flex h-10 shrink-0 items-stretch border-b border-line bg-panel">
        <div ref={tabRef} className="relative flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]">
          {sideTabs.map((tab) => {
            const selected = tab.id === active?.id;
            return (
              <div key={tab.id} onContextMenu={(event) => { event.preventDefault(); setTabMenu(tab.id); }} className={`group relative flex shrink-0 items-center gap-1.5 border-r border-line pl-3 pr-1.5 text-[12px] ${selected ? 'bg-surface text-surface-foreground' : 'text-muted hover:bg-hover'}`}>
                <button onClick={() => setInspectorTab(tab.id)} className="flex items-center gap-1.5">
                  <span className={`${icon(tab.kind)} size-3.5`} />
                  <span className="max-w-[96px] truncate">{tab.title}</span>
                </button>
                <button aria-label={`关闭 ${tab.title}`} title="关闭" onClick={() => close([tab.id])} className={`flex size-5 items-center justify-center rounded-[4px] hover:bg-control ${selected ? '' : 'opacity-0 group-hover:opacity-100'}`}>
                  <span className="icon-[lucide--x] size-3" />
                </button>
                {tabMenu === tab.id && (
                  <MenuPanel label="标签操作" className="left-2 top-9 w-44">
                    <MenuItem label="关闭" onClick={() => close([tab.id])} />
                    <MenuItem label="关闭其他" onClick={() => close(sideTabs.filter((item) => item.id !== tab.id).map((item) => item.id))} />
                    <MenuItem label="关闭右侧标签页" onClick={() => close(sideTabs.slice(sideTabs.findIndex((item) => item.id === tab.id) + 1).map((item) => item.id))} />
                    <MenuSeparator />
                    <MenuItem label="关闭所有" danger onClick={() => close(sideTabs.map((item) => item.id))} />
                  </MenuPanel>
                )}
              </div>
            );
          })}
        </div>
        <div ref={addRef} className="relative flex shrink-0 items-center gap-0.5 px-1.5">
          <button title="新建标签页" aria-label="新建标签页" aria-expanded={addMenu} onClick={() => setAddMenu(!addMenu)} className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover hover:text-surface-foreground">
            <span className="icon-[lucide--plus] size-4" />
          </button>
          <button title={sideFullscreen ? '退出右侧面板全屏 (Esc)' : '全屏右侧面板'} aria-label={sideFullscreen ? '退出右侧面板全屏' : '全屏右侧面板'} onClick={() => setSideFullscreen(!sideFullscreen)} className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover hover:text-surface-foreground">
            <span className={`${sideFullscreen ? 'icon-[lucide--minimize-2]' : 'icon-[lucide--maximize-2]'} size-3.5`} />
          </button>
          {addMenu && (
            <MenuPanel label="新建标签页" className="right-1 top-9 w-44">
              {sideTabKinds.map((kind) => (
                <MenuItem key={kind.id} icon={kind.icon} label={kind.label} hint={kind.id === 'btw' ? '旁路提问，不会发给主 agent' : kind.id === 'workflow' ? '内置工具「工作流」开启时可用' : undefined} onClick={() => { setAddMenu(false); openSideTab(kind.id); }} />
              ))}
            </MenuPanel>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {active ? (
          <View key={`${active.id}:${panelPreset?.rev ?? 0}`} tab={active} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[13px] text-muted">
            <span className="icon-[lucide--panel-right] size-6 text-faint" />
            还没有标签页，新建一个开始使用。
            <button onClick={() => openSideTab('files')} className="rounded-control border border-border px-3 py-1.5 text-[12px] text-surface-foreground hover:bg-hover">打开文件</button>
          </div>
        )}
      </div>
    </aside>
  );
}
/** 兼容旧名称 */
export const Inspector = SidePanel;
