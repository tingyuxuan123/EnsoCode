import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type SideTab = { id: string; kind: string; title: string };
export type ProjectDialog = null | 'add' | 'settings' | 'group' | 'group-edit' | 'import' | 'archive' | 'remove';
export type ModelChoice = { vendor: string; entry: string; model: string; virtual?: boolean };

type WorkbenchState = {
  dark: boolean; setDark: (value: boolean) => void;
  compact: boolean; setCompact: (value: boolean) => void;
  chatWide: boolean; setChatWide: (value: boolean) => void;
  botModeEnabled: boolean; setBotModeEnabled: (value: boolean) => void;
  inspectorOpen: boolean; setInspectorOpen: (value: boolean) => void;
  sideFullscreen: boolean; setSideFullscreen: (value: boolean) => void;
  sideTabs: SideTab[]; setSideTabs: (tabs: SideTab[]) => void;
  inspectorTab: string; setInspectorTab: (value: string) => void;
  openSideTab: (kind: string, title?: string) => void;
  approval: string; setApproval: (value: string) => void;
  model: string; setModel: (value: string) => void;
  modelChoice: ModelChoice; setModelChoice: (value: ModelChoice) => void;
  reasoning: boolean; setReasoning: (value: boolean) => void;
  thinking: string; setThinking: (value: string) => void;
  preset: string; setPreset: (value: string) => void;
  worktree: string; setWorktree: (value: string) => void;
  planMode: boolean; setPlanMode: (value: boolean) => void;
  notice: string; setNotice: (value: string) => void;
  activeFile: string; setActiveFile: (value: string) => void;
  task: string; setTask: (value: string) => void;
  projectDialog: ProjectDialog; setProjectDialog: (value: ProjectDialog) => void;
  dialogProject: string; setDialogProject: (value: string) => void;
  searchOpen: boolean; setSearchOpen: (value: boolean) => void;
  overlayEl: HTMLDivElement | null;
  /** 面板视图的初始状态：帧挂载时注入，用于让同一视图展示不同状态 */
  panelPreset: { kind: string; value: Record<string, unknown>; rev: number } | null;
  setPanelPreset: (value: { kind: string; value: Record<string, unknown>; rev: number } | null) => void;
};

const WorkbenchContext = createContext<WorkbenchState | null>(null);
export function useWorkbench() {
  const state = useContext(WorkbenchContext);
  if (!state) throw new Error('工作台尚未初始化');
  return state;
}

const defaultTabs: SideTab[] = [
  { id: 'files', kind: 'files', title: '文件' },
  { id: 'changes', kind: 'changes', title: '改动' },
  { id: 'terminal-1', kind: 'terminal', title: '终端' },
];

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);
  const [compact, setCompact] = useState(false);
  const [chatWide, setChatWide] = useState(false);
  const [botModeEnabled, setBotModeEnabled] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [sideFullscreen, setSideFullscreen] = useState(false);
  const [sideTabs, setSideTabs] = useState<SideTab[]>(defaultTabs);
  const [inspectorTab, setInspectorTab] = useState('files');
  const [approval, setApproval] = useState('auto-edits');
  const [modelChoice, setModelChoice] = useState<ModelChoice>({ vendor: 'anthropic', entry: 'claude-max', model: 'Claude Sonnet 4.5' });
  const [reasoning, setReasoning] = useState(true);
  const [thinking, setThinking] = useState('中');
  const [preset, setPreset] = useState('default');
  const [worktree, setWorktree] = useState('');
  const [planMode, setPlanMode] = useState(false);
  const [notice, setNotice] = useState('');
  const [activeFile, setActiveFile] = useState('');
  const [task, setTask] = useState('');
  const [projectDialog, setProjectDialog] = useState<ProjectDialog>(null);
  const [dialogProject, setDialogProject] = useState('enso');
  const [searchOpen, setSearchOpen] = useState(false);
  const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null);
  const [panelPreset, setPanelPreset] = useState<WorkbenchState['panelPreset']>(null);

  /** 与 lib/sidePanelDock 一致：文件 / 改动 / 工作流单例，终端 / 浏览器 / 旁路可多开 */
  const openSideTab = (kind: string, title?: string) => {
    setInspectorOpen(true);
    const single = ['files', 'changes', 'workflow', 'agents'].includes(kind);
    const existing = single ? sideTabs.find((tab) => tab.kind === kind) : undefined;
    if (existing) { setInspectorTab(existing.id); return; }
    const count = sideTabs.filter((tab) => tab.kind === kind).length;
    const base = title ?? ({ files: '文件', changes: '改动', terminal: '终端', browser: '浏览器', btw: '旁路', workflow: '工作流', agents: '代理' } as Record<string, string>)[kind] ?? kind;
    const id = single ? kind : `${kind}-${Date.now()}`;
    setSideTabs([...sideTabs, { id, kind, title: count && !single ? `${base} ${count + 1}` : base }]);
    setInspectorTab(id);
  };

  const value: WorkbenchState = {
    dark, setDark, compact, setCompact, chatWide, setChatWide, botModeEnabled, setBotModeEnabled,
    inspectorOpen, setInspectorOpen, sideFullscreen, setSideFullscreen, sideTabs, setSideTabs,
    inspectorTab, setInspectorTab, openSideTab, approval, setApproval,
    model: modelChoice.model, setModel: (model) => setModelChoice({ ...modelChoice, model }),
    modelChoice, setModelChoice, reasoning, setReasoning, thinking, setThinking, preset, setPreset,
    worktree, setWorktree, planMode, setPlanMode, notice, setNotice, activeFile, setActiveFile, task, setTask,
    projectDialog, setProjectDialog, dialogProject, setDialogProject, searchOpen, setSearchOpen, overlayEl, panelPreset, setPanelPreset,
  };
  return (
    <WorkbenchContext.Provider value={value}>
      <div className={`${dark ? 'design-dark' : ''} relative flex h-full flex-col overflow-hidden bg-panel font-sans text-[14px] text-surface-foreground`}>
        {children}
        <div ref={setOverlayEl} className="contents" />
      </div>
    </WorkbenchContext.Provider>
  );
}

/** 覆盖整个窗口的弹层出口（对话框、全局搜索、首启引导） */
export function Overlay({ children }: { children: ReactNode }) {
  const { overlayEl } = useWorkbench();
  return overlayEl ? createPortal(children, overlayEl) : null;
}

export { AppRail, Notice, StatusBar, TitleBar, WindowBar } from './Shell';
export { CodeSidebar, Navigation } from './Sidebar';
export { Inspector, SidePanel } from './SidePanel';
