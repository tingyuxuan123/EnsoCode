import type { ReactNode } from 'react';

/** 右侧面板视图内共用的小部件：工具条图标按钮、模式胶囊、虚线状态框 */
export function IconButton({ icon, label, onClick, active, disabled, danger }: { icon: string; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} className={`flex size-7 shrink-0 items-center justify-center rounded-control hover:bg-hover disabled:pointer-events-none disabled:opacity-40 ${active ? 'bg-control text-surface-foreground' : danger ? 'text-muted hover:text-danger' : 'text-muted hover:text-surface-foreground'}`}>
      <span className={`${icon} size-3.5`} />
    </button>
  );
}

export function ModeTabs<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; icon?: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex h-7 items-center rounded-control bg-control/55 p-[2px]">
      {options.map((option) => (
        <button key={option.value} role="tab" aria-selected={value === option.value} onClick={() => onChange(option.value)} className={`flex h-full items-center gap-1 whitespace-nowrap rounded-[4px] px-2.5 text-[12px] ${value === option.value ? 'bg-surface font-medium text-surface-foreground' : 'text-muted hover:text-surface-foreground'}`}>
          {option.icon && <span className={`${option.icon} size-3.5`} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function DashedState({ children, icon }: { children: ReactNode; icon?: string }) {
  return (
    <div role="status" className="m-3 flex min-h-[120px] flex-1 flex-col items-center justify-center gap-2 rounded-control border border-dashed border-border p-4 text-center text-[12px] leading-5 text-muted">
      {icon && <span className={`${icon} size-5 text-faint`} />}
      {children}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">{children}</div>;
}

/** 演示状态切换条：仅设计预览用，放在视图底部，用于在一帧内切换真实存在的分支状态 */
export function PreviewStates<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-dashed border-border bg-panel/50 px-2 py-1.5 text-[11px] text-faint">
      <span className="mr-1">预览状态</span>
      {options.map((option) => (
        <button key={option.value} onClick={() => onChange(option.value)} className={`rounded-[4px] px-1.5 py-0.5 ${value === option.value ? 'bg-surface text-surface-foreground' : 'hover:text-surface-foreground'}`}>{option.label}</button>
      ))}
    </div>
  );
}

/** 并排 diff 行渲染（会话改动、Git diff、提交 diff 共用） */
export type DiffLine = { kind: 'ctx' | 'add' | 'del' | 'hunk'; old?: number; new?: number; text: string };
export function DiffBlock({ lines, split }: { lines: DiffLine[]; split: boolean }) {
  if (!split) {
    return (
      <div className="min-w-max py-1 font-mono text-[11px] leading-[20px]">
        {lines.map((line, index) => line.kind === 'hunk' ? (
          <div key={index} className="bg-primary-soft/60 px-3 text-faint">{line.text}</div>
        ) : (
          <div key={index} className={`flex ${line.kind === 'add' ? 'bg-success-soft' : line.kind === 'del' ? 'bg-danger-soft' : ''}`}>
            <span className="w-8 shrink-0 pr-1 text-right text-faint">{line.old ?? ''}</span>
            <span className="w-8 shrink-0 pr-1 text-right text-faint">{line.new ?? ''}</span>
            <span className={`w-4 shrink-0 text-center ${line.kind === 'add' ? 'text-success' : 'text-danger'}`}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
            <span className="whitespace-pre pr-3">{line.text}</span>
          </div>
        ))}
      </div>
    );
  }
  // 并排：删除行放左、新增行放右，上下文两侧都显示
  const rows: { left?: DiffLine; right?: DiffLine; hunk?: string }[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i += 1) rows.push({ left: dels[i], right: adds[i] });
    dels = []; adds = [];
  };
  for (const line of lines) {
    if (line.kind === 'del') dels.push(line);
    else if (line.kind === 'add') adds.push(line);
    else { flush(); rows.push(line.kind === 'hunk' ? { hunk: line.text } : { left: line, right: line }); }
  }
  flush();
  const cell = (line: DiffLine | undefined, side: 'left' | 'right') => {
    const tone = line?.kind === 'del' ? 'bg-danger-soft' : line?.kind === 'add' ? 'bg-success-soft' : line ? '' : 'bg-panel/60';
    return (
      <div className={`flex min-w-0 ${tone} ${side === 'left' ? 'border-r border-line' : ''}`}>
        <span className="w-8 shrink-0 pr-1 text-right text-faint">{line ? (side === 'left' ? line.old : line.new) : ''}</span>
        <span className={`w-4 shrink-0 text-center ${line?.kind === 'add' ? 'text-success' : 'text-danger'}`}>{line?.kind === 'add' ? '+' : line?.kind === 'del' ? '−' : ''}</span>
        <span className="overflow-hidden whitespace-pre pr-2">{line?.text ?? ''}</span>
      </div>
    );
  };
  return (
    <div className="py-1 font-mono text-[11px] leading-[20px]">
      {rows.map((row, index) => row.hunk ? (
        <div key={index} className="bg-primary-soft/60 px-3 text-faint">{row.hunk}</div>
      ) : (
        <div key={index} className="grid grid-cols-2">
          {cell(row.left, 'left')}
          {cell(row.right, 'right')}
        </div>
      ))}
    </div>
  );
}

export const sampleDiffs: Record<string, DiffLine[]> = {
  'src/renderer/App.tsx': [
    { kind: 'hunk', text: '@@ -388,12 +388,14 @@ export default function App() {' },
    { kind: 'ctx', old: 388, new: 388, text: '      <UpdateBanner />' },
    { kind: 'del', old: 389, text: '      <div className="flex min-h-0 flex-1 gap-2 p-2">' },
    { kind: 'add', new: 389, text: '      {/* 平铺外壳：图标轨 + 侧栏 + 工作区 */}' },
    { kind: 'add', new: 390, text: '      <div className="flex min-h-0 flex-1">' },
    { kind: 'ctx', old: 390, new: 391, text: '        <AppRail' },
    { kind: 'ctx', old: 391, new: 392, text: '          sidebarCollapsed={collapsed}' },
    { kind: 'del', old: 392, text: '          className="rounded-xl shadow-sm"' },
    { kind: 'ctx', old: 393, new: 393, text: '        />' },
    { kind: 'del', old: 394, text: '        <Sidebar width={width} />' },
    { kind: 'add', new: 394, text: '        <Sidebar width={collapsed ? undefined : width} collapsed={collapsed} />' },
    { kind: 'add', new: 395, text: '        {!collapsed && <ResizeHandle onResize={handleResize} />}' },
    { kind: 'ctx', old: 395, new: 396, text: '        <div ref={workspaceRef} className="relative flex min-h-0 flex-1">' },
  ],
  'src/renderer/components/chat/Sidebar.tsx': [
    { kind: 'hunk', text: '@@ -737,9 +737,12 @@ export function Sidebar() {' },
    { kind: 'ctx', old: 737, new: 737, text: '        <div className="flex shrink-0 items-center gap-2 px-3 pt-3">' },
    { kind: 'del', old: 738, text: '          <Tabs value={section} onValueChange={setSection}>' },
    { kind: 'add', new: 738, text: '          {botModeEnabled ? (' },
    { kind: 'add', new: 739, text: '            <ModeSwitch className="h-9 flex-1" />' },
    { kind: 'add', new: 740, text: '          ) : (' },
    { kind: 'ctx', old: 739, new: 741, text: '            <SearchButton onClick={onOpenSearch} />' },
    { kind: 'del', old: 740, text: '          </Tabs>' },
    { kind: 'add', new: 742, text: '          )}' },
    { kind: 'ctx', old: 741, new: 743, text: '        </div>' },
  ],
  'src/renderer/styles/globals.css': [
    { kind: 'hunk', text: '@@ -189,8 +189,9 @@ .ocean-light {' },
    { kind: 'ctx', old: 189, new: 189, text: '  --background: 205 35% 94%;' },
    { kind: 'del', old: 190, text: '  --radius: 12px;' },
    { kind: 'add', new: 190, text: '  --radius: 6px;' },
    { kind: 'ctx', old: 191, new: 191, text: '  --content-area: 205 30% 97%;' },
    { kind: 'add', new: 192, text: '  --input: 205 32% 96%;' },
    { kind: 'ctx', old: 192, new: 193, text: '}' },
  ],
};
