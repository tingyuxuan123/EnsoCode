import { useState } from 'react';
import { changes } from '../data';
import { useWorkbench } from '../Workbench';
import { GitView, type GitState } from './GitView';
import { DashedState, DiffBlock, IconButton, ModeTabs, sampleDiffs } from './PanelUI';
import { useReadPanelPreset } from './preset';

export type ChangesPreset = {
  mode: 'all' | 'git';
  sessionState: 'ready' | 'loading' | 'empty' | 'truncated';
  gitView: 'changes' | 'history';
  gitState: GitState;
};

const truncatedPath = 'src/renderer/i18n/zh-CN.generated.json';

/**
 * 改动面板（sidepanel/ChangesView.tsx）：会话 | Git。
 * 会话模式是本会话所有 edit/write/apply_patch 的累计 diff（并排，可逐文件折叠、全部折叠/展开）；
 * 原始快照被截断的文件给虚线提示；无改动时空态。Git 模式见 GitView。
 * `wide` 用于全屏 / 改动审查：diff 区足够宽时并排，窄面板时统一。
 */
export function ChangesView({ wide = false, initial }: { wide?: boolean; initial?: Partial<ChangesPreset> }) {
  const preset = { ...useReadPanelPreset<ChangesPreset>('changes'), ...initial };
  const { sideFullscreen, openSideTab } = useWorkbench();
  const [mode, setMode] = useState<'all' | 'git'>(preset.mode ?? 'all');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const sessionState = preset.sessionState ?? 'ready';
  const split = wide || sideFullscreen;
  const files = sessionState === 'empty' ? [] : changes;
  const allCollapsed = files.length > 0 && files.every((file) => collapsed.includes(file.name));
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <ModeTabs label="改动来源" value={mode} onChange={setMode} options={[{ value: 'all', label: '会话' }, { value: 'git', label: 'Git' }]} />
        {mode === 'all' && files.length > 0 && sessionState !== 'loading' && (
          <>
            <span className="ml-2 text-[11px] text-muted">{files.length} 个文件</span>
            <span className="ml-auto" />
            <IconButton icon={allCollapsed ? 'icon-[lucide--chevrons-up-down]' : 'icon-[lucide--chevrons-down-up]'} label={allCollapsed ? '全部展开' : '全部折叠'} onClick={() => setCollapsed(allCollapsed ? [] : files.map((file) => file.name))} />
            {!wide && <IconButton icon={sideFullscreen ? 'icon-[lucide--minimize-2]' : 'icon-[lucide--maximize-2]'} label={sideFullscreen ? '退出右侧面板全屏' : '全屏右侧面板'} onClick={() => openSideTab('changes')} />}
          </>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'git' ? (
          <GitView wide={split} initialView={preset.gitView} initialState={preset.gitState} />
        ) : sessionState === 'loading' ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-[13px] text-muted">加载中...</div>
        ) : files.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[13px] text-muted">
            <span className="icon-[lucide--file-diff] size-5 text-faint" />
            本会话还没有文件改动。
          </div>
        ) : (
          <div className="h-full overflow-auto">
            {sessionState === 'truncated' && (
              <div className="m-2 flex items-start gap-2 rounded-control border border-dashed border-border px-3 py-2 text-[12px] text-muted">
                <span className="icon-[lucide--circle-alert] mt-0.5 size-3.5 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate font-mono text-surface-foreground" title={truncatedPath}>{truncatedPath}</div>
                  <div>原始快照已截断，无法显示完整差异。</div>
                </div>
              </div>
            )}
            {files.map((file) => {
              const path = `${file.folder}/${file.name}`;
              const isCollapsed = collapsed.includes(file.name);
              return (
                <section key={file.name} className="border-b border-line">
                  <button aria-expanded={!isCollapsed} onClick={() => setCollapsed(isCollapsed ? collapsed.filter((name) => name !== file.name) : [...collapsed, file.name])} className="sticky top-0 z-10 flex h-8 w-full items-center gap-1.5 border-b border-line bg-panel px-2 text-left text-[12px] hover:bg-hover">
                    <span className={`icon-[lucide--chevron-down] size-3.5 shrink-0 text-muted ${isCollapsed ? '-rotate-90' : ''}`} />
                    <span className="icon-[lucide--file-code-2] size-3.5 shrink-0 text-primary" />
                    <span className="font-medium">{file.name}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{file.folder}</span>
                    <span className="shrink-0 text-[11px] text-success">+{file.added}</span>
                    <span className="shrink-0 text-[11px] text-danger">−{file.removed}</span>
                  </button>
                  {!isCollapsed && <div className="overflow-x-auto"><DiffBlock split={split} lines={sampleDiffs[path] ?? []} /></div>}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
