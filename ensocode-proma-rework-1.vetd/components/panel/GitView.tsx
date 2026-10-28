import { useState } from 'react';
import { DangerConfirm, Spinner } from '../Controls';
import { useWorkbench } from '../Workbench';
import { DashedState, DiffBlock, IconButton, ModeTabs, sampleDiffs, type DiffLine } from './PanelUI';

type GitFile = { path: string; status: 'modified' | 'added' | 'deleted' | 'untracked' | 'conflicted' | 'renamed' };
type Group = { id: 'staged' | 'unstaged' | 'untracked'; title: string; staged: boolean; files: GitFile[] };
export type GitState = 'ready' | 'loading' | 'unavailable' | 'migrating' | 'clean' | 'no-upstream' | 'error';

const initialStaged: GitFile[] = [{ path: 'src/renderer/styles/globals.css', status: 'modified' }];
const initialUnstaged: GitFile[] = [
  { path: 'src/renderer/App.tsx', status: 'modified' },
  { path: 'src/renderer/components/chat/Sidebar.tsx', status: 'modified' },
  { path: 'src/renderer/components/chat/LegacyTabs.tsx', status: 'deleted' },
];
const initialUntracked: GitFile[] = [{ path: 'src/renderer/components/chat/GroupChips.tsx', status: 'untracked' }];

const statusLetter: Record<GitFile['status'], { letter: string; tone: string }> = {
  modified: { letter: 'M', tone: 'text-warning' },
  added: { letter: 'A', tone: 'text-success' },
  deleted: { letter: 'D', tone: 'text-danger' },
  untracked: { letter: 'U', tone: 'text-success' },
  conflicted: { letter: '!', tone: 'text-danger' },
  renamed: { letter: 'R', tone: 'text-primary' },
};

const newFileDiff: DiffLine[] = [
  { kind: 'hunk', text: '@@ -0,0 +1,6 @@' },
  { kind: 'add', new: 1, text: "import { useState } from 'react';" },
  { kind: 'add', new: 2, text: '' },
  { kind: 'add', new: 3, text: '/** 侧栏分组标签条：横滑、拖动排序、接收项目拖入 */' },
  { kind: 'add', new: 4, text: 'export function GroupChips({ groups }: GroupChipsProps) {' },
  { kind: 'add', new: 5, text: '  const [searchOpen, setSearchOpen] = useState(false);' },
  { kind: 'add', new: 6, text: '}' },
];

const commits = [
  { sha: '9f3c2a1', subject: 'feat(sidebar): 分组标签条支持拖入项目', author: 'yfdl', time: '2 小时前', files: [{ path: 'src/renderer/components/chat/GroupChips.tsx', added: 86, removed: 12 }, { path: 'src/renderer/components/chat/Sidebar.tsx', added: 14, removed: 6 }] },
  { sha: '4b7e0d8', subject: 'fix(composer): 审批挂起时锁定输入框', author: 'yfdl', time: '昨天', files: [{ path: 'src/renderer/components/chat/Composer.tsx', added: 9, removed: 3 }] },
  { sha: 'c21a9fe', subject: 'chore: 状态栏 usage 段不进默认预设', author: 'enso-bot', time: '3 天前', files: [{ path: 'src/shared/statusLine.ts', added: 4, removed: 1 }] },
  { sha: '7d08b33', subject: 'refactor(settings): 抽出 settingsCategories 显隐', author: 'yfdl', time: '5 天前', files: [] },
];

const fileName = (path: string) => path.split('/').at(-1) ?? path;
const dirName = (path: string) => path.split('/').slice(0, -1).join('/');

/** Git 视图（GitChangesView + GitHistoryView）：分支 / 上游 / 获取·拉取·推送·刷新，改动 | 历史 */
export function GitView({ initialView = 'changes', initialState = 'ready', wide = false }: { initialView?: 'changes' | 'history'; initialState?: GitState; wide?: boolean }) {
  const { setNotice } = useWorkbench();
  const [view, setView] = useState<'changes' | 'history'>(initialView);
  const [state, setState] = useState<GitState>(initialState);
  const [staged, setStaged] = useState(initialState === 'clean' ? [] : initialStaged);
  const [unstaged, setUnstaged] = useState(initialState === 'clean' ? [] : initialUnstaged);
  const [untracked, setUntracked] = useState(initialState === 'clean' ? [] : initialUntracked);
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(initialState === 'ready' ? { path: 'src/renderer/App.tsx', staged: false } : null);
  const [query, setQuery] = useState('');
  const [treeMode, setTreeMode] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [discard, setDiscard] = useState<GitFile | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [commit, setCommit] = useState(commits[0].sha);
  const [commitFile, setCommitFile] = useState(commits[0].files[0].path);
  const [shown, setShown] = useState(3);
  const [ahead, setAhead] = useState(1);

  const run = (label: string, done: () => void) => {
    setBusy(label);
    window.setTimeout(() => { setBusy(''); done(); }, 700);
  };
  const move = (file: GitFile, toStaged: boolean) => {
    if (toStaged) {
      setUnstaged(unstaged.filter((item) => item.path !== file.path));
      setUntracked(untracked.filter((item) => item.path !== file.path));
      setStaged([...staged, file.status === 'untracked' ? { ...file, status: 'added' } : file]);
    } else {
      setStaged(staged.filter((item) => item.path !== file.path));
      if (file.status === 'added') setUntracked([...untracked, { ...file, status: 'untracked' }]);
      else setUnstaged([...unstaged, file]);
    }
    if (selected?.path === file.path) setSelected({ path: file.path, staged: toStaged });
  };
  const groups: Group[] = [
    { id: 'staged', title: '已暂存', staged: true, files: staged },
    { id: 'unstaged', title: '未暂存', staged: false, files: unstaged },
    { id: 'untracked', title: '未跟踪', staged: false, files: untracked },
  ];
  const visible = groups.map((group) => ({ ...group, files: group.files.filter((file) => !query || file.path.toLowerCase().includes(query.toLowerCase())) }));
  const visibleCount = visible.reduce((n, group) => n + group.files.length, 0);
  const canCommit = staged.length > 0 && message.trim().length > 0 && !busy;
  const blocked = Boolean(busy);
  const noUpstream = state === 'no-upstream';
  const branchRow = (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2 text-[12px]">
      <span className="icon-[lucide--git-branch] size-3.5 shrink-0 text-muted" />
      <span className="min-w-0 truncate font-mono">{noUpstream ? 'feat/status-line' : 'main'}</span>
      {noUpstream ? (
        <span title="当前分支未关联上游分支。" className="max-w-20 truncate text-[11px] text-muted">未关联上游</span>
      ) : (
        <span className="shrink-0 font-mono text-[11px] text-muted" title="origin/main">origin/main{ahead ? ` ↑${ahead}` : ''}</span>
      )}
      <span className="flex-1" />
      <IconButton icon="icon-[lucide--download]" label="获取远程更新" disabled={blocked || noUpstream} onClick={() => run('获取', () => setNotice('已获取远程更新（设计预览）。'))} />
      <IconButton icon="icon-[lucide--arrow-down]" label="拉取" disabled={blocked || noUpstream} onClick={() => run('拉取', () => undefined)} />
      <IconButton icon="icon-[lucide--arrow-up]" label="推送" disabled={blocked || noUpstream} onClick={() => run('推送', () => setAhead(0))} />
      <IconButton icon={state === 'loading' ? 'icon-[lucide--refresh-cw] vetd-spin' : 'icon-[lucide--refresh-cw]'} label="刷新" onClick={() => { setState('loading'); window.setTimeout(() => setState('ready'), 900); }} />
    </div>
  );
  const unavailableText = state === 'unavailable' ? '当前工作区不支持 Git diff。' : state === 'migrating' ? '工作区正在切换，请稍候。' : state === 'error' ? '不是 git 仓库。' : '加载中...';

  const activeCommit = commits.find((item) => item.sha === commit) ?? commits[0];
  const selectedDiff = selected ? (sampleDiffs[selected.path] ?? (selected.path.endsWith('GroupChips.tsx') ? newFileDiff : [{ kind: 'hunk' as const, text: '@@ -1,4 +0,0 @@' }, { kind: 'del' as const, old: 1, text: 'export function LegacyTabs() {' }, { kind: 'del' as const, old: 2, text: '  return null;' }, { kind: 'del' as const, old: 3, text: '}' }])) : [];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <ModeTabs label="Git 视图" value={view} onChange={setView} options={[{ value: 'changes', label: '改动', icon: 'icon-[lucide--file-diff]' }, { value: 'history', label: '历史', icon: 'icon-[lucide--history]' }]} />
      </div>
      {branchRow}
      {busy && <div className="flex shrink-0 items-center gap-2 px-3 py-1 text-[12px] text-muted"><Spinner className="size-3" />{busy}…</div>}
      {state === 'error' && <p role="alert" className="shrink-0 border-b border-line px-3 py-2 text-[12px] text-danger">fatal: not a git repository (or any of the parent directories): .git</p>}
      {state === 'unavailable' || state === 'migrating' || state === 'loading' || state === 'error' ? (
        <DashedState>{unavailableText}</DashedState>
      ) : view === 'history' ? (
        <div className={`flex min-h-0 flex-1 ${wide ? 'flex-row' : 'flex-col'}`}>
          <div className={`flex min-h-0 flex-col overflow-hidden ${wide ? 'w-[340px] border-r' : 'max-h-[48%] border-b'} border-line`}>
            <div className="flex h-7 shrink-0 items-center px-2 text-[11px] font-medium text-muted">历史</div>
            <div className="min-h-0 flex-1 overflow-auto px-1 pb-1">
              {commits.slice(0, shown).map((item) => (
                <button key={item.sha} onClick={() => { setCommit(item.sha); setCommitFile(item.files[0]?.path ?? ''); }} className={`block w-full rounded-control px-2 py-1.5 text-left ${commit === item.sha ? 'bg-selected' : 'hover:bg-hover'}`}>
                  <span className="block truncate text-[12px]">{item.subject}</span>
                  <span className="mt-0.5 flex gap-2 text-[11px] text-faint"><span className="font-mono">{item.sha}</span><span>{item.author}</span><span>{item.time}</span></span>
                </button>
              ))}
              {shown < commits.length ? (
                <button onClick={() => setShown(commits.length)} className="mt-1 w-full rounded-control py-1.5 text-[12px] text-muted hover:bg-hover">加载更多提交</button>
              ) : <p className="py-2 text-center text-[11px] text-faint">已到最早的提交</p>}
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {activeCommit.files.length ? (
              <>
                <div className="shrink-0 border-b border-line px-2 py-1">
                  {activeCommit.files.map((file) => (
                    <button key={file.path} onClick={() => setCommitFile(file.path)} className={`flex w-full items-center gap-1.5 rounded-control px-1.5 py-1 text-left text-[12px] ${commitFile === file.path ? 'bg-selected' : 'hover:bg-hover'}`}>
                      <span className="icon-[lucide--file-code-2] size-3.5 shrink-0 text-primary" />
                      <span className="truncate">{fileName(file.path)}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-success">+{file.added}</span>
                      <span className="shrink-0 text-[11px] text-danger">−{file.removed}</span>
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1 overflow-auto"><DiffBlock split={wide} lines={sampleDiffs['src/renderer/components/chat/Sidebar.tsx']} /></div>
              </>
            ) : <DashedState>该提交没有文件改动。</DashedState>}
          </div>
        </div>
      ) : (
        <div className={`flex min-h-0 flex-1 ${wide ? 'flex-row' : 'flex-col'}`}>
          <div className={`flex min-h-0 min-w-0 flex-col overflow-hidden border-line ${wide ? 'w-[300px] border-r' : selected && listOpen ? 'max-h-[52%] shrink-0 border-b' : listOpen ? 'flex-1' : 'shrink-0 border-b'}`}>
            <div className="flex shrink-0 items-center">
              <button aria-expanded={listOpen} disabled={!selected} onClick={() => setListOpen(!listOpen)} className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-[11px] font-medium text-muted hover:bg-hover disabled:hover:bg-transparent">
                <span className={`icon-[lucide--chevron-down] size-3.5 shrink-0 ${listOpen ? '' : '-rotate-90'}`} />
                改动文件
              </button>
              <IconButton icon={treeMode ? 'icon-[lucide--list]' : 'icon-[lucide--list-tree]'} label={treeMode ? '列表视图' : '树状视图'} onClick={() => setTreeMode(!treeMode)} />
            </div>
            {listOpen && (
              <>
                <div className="shrink-0 px-2 pb-1.5">
                  <label className="flex h-7 items-center gap-1.5 rounded-control border border-border bg-input px-2 text-muted focus-within:border-primary/60">
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选改动文件…" aria-label="筛选改动文件…" className="min-w-0 flex-1 bg-transparent text-[12px] text-surface-foreground outline-none" />
                    {query && <button title="清除" aria-label="清除" onClick={() => setQuery('')}><span className="icon-[lucide--x] size-3" /></button>}
                  </label>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
                  {visible.map((group) => group.files.length === 0 ? null : (
                    <section key={group.id} className="mb-2 last:mb-0">
                      <div className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-muted">
                        <span className="min-w-0 flex-1 truncate">{group.title}<span className="ml-1 font-normal">{group.files.length}</span></span>
                        <IconButton icon={group.staged ? 'icon-[lucide--minus]' : 'icon-[lucide--plus]'} label={group.staged ? '取消全部暂存' : '暂存全部'} disabled={blocked} onClick={() => run(group.staged ? '取消暂存' : '暂存', () => group.files.forEach((file) => move(file, !group.staged)))} />
                      </div>
                      {treeMode && <div className="flex items-center gap-1 px-2 text-[11px] text-faint"><span className="icon-[lucide--folder] size-3" />{dirName(group.files[0].path)}</div>}
                      {group.files.map((file) => {
                        const isSelected = selected?.path === file.path && selected.staged === group.staged;
                        return (
                          <div key={file.path} onClick={() => setSelected({ path: file.path, staged: group.staged })} className={`group flex h-7 cursor-pointer items-center gap-1.5 rounded-control pr-1 text-[12px] ${treeMode ? 'pl-5' : 'pl-2'} ${isSelected ? 'bg-selected' : 'hover:bg-hover'}`}>
                            <span className={`w-3 shrink-0 text-center font-mono text-[11px] ${statusLetter[file.status].tone}`}>{statusLetter[file.status].letter}</span>
                            <span className={`min-w-0 truncate ${file.status === 'deleted' ? 'text-muted line-through' : ''}`}>{fileName(file.path)}</span>
                            {!treeMode && <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{dirName(file.path)}</span>}
                            {treeMode && <span className="flex-1" />}
                            <span className="hidden shrink-0 items-center group-hover:flex" onClick={(event) => event.stopPropagation()}>
                              {!group.staged && <IconButton icon="icon-[lucide--undo-2]" label={file.status === 'untracked' ? '删除未跟踪文件' : '丢弃修改'} disabled={blocked || file.status === 'conflicted'} onClick={() => setDiscard(file)} />}
                              <IconButton icon={group.staged ? 'icon-[lucide--minus]' : 'icon-[lucide--plus]'} label={group.staged ? '取消暂存' : '暂存'} disabled={blocked} onClick={() => run(group.staged ? '取消暂存' : '暂存', () => move(file, !group.staged))} />
                            </span>
                          </div>
                        );
                      })}
                    </section>
                  ))}
                  {visibleCount === 0 && <p className="m-1 rounded-control border border-dashed border-border px-2 py-5 text-center text-[12px] text-muted">{staged.length + unstaged.length + untracked.length === 0 ? '工作区没有改动。' : '没有匹配的文件。'}</p>}
                </div>
                <div className="flex shrink-0 items-end gap-1.5 border-t border-line p-2">
                  <textarea rows={3} value={message} disabled={blocked} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canCommit) run('提交', () => { setStaged([]); setMessage(''); setAhead(ahead + 1); setNotice('已提交（设计预览）。'); }); }} aria-label="提交信息" placeholder="输入提交信息…" className="min-h-[60px] min-w-0 flex-1 rounded-control border border-border bg-input px-2 py-1.5 text-[12px] outline-none focus:border-primary/60" />
                  <button title={`已暂存 ${staged.length} 个文件`} disabled={!canCommit} onClick={() => run('提交', () => { setStaged([]); setMessage(''); setAhead(ahead + 1); setNotice('已提交（设计预览，不会写入真实仓库）。'); })} className="mb-0.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-control bg-primary px-2.5 text-[12px] text-primary-foreground disabled:opacity-45">
                    <span className="icon-[lucide--git-commit-horizontal] size-3.5" />
                    提交
                    {staged.length > 0 && <span className="font-mono text-[11px]">{staged.length}</span>}
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {selected ? (
              <>
                <div className="shrink-0 truncate border-b border-line px-3 py-1 text-[11px] text-muted" title={selected.path}>{selected.staged ? '已暂存' : '未暂存'} · {selected.path}</div>
                <div className="min-h-0 flex-1 overflow-auto"><DiffBlock split={wide} lines={selectedDiff} /></div>
              </>
            ) : <DashedState>选择文件查看差异。</DashedState>}
          </div>
        </div>
      )}
      {discard && <DangerConfirm title={discard.status === 'untracked' ? '删除未跟踪文件' : '丢弃修改'} description={discard.status === 'untracked' ? `永久删除未跟踪文件 ${discard.path}？` : `将 ${discard.path} 恢复为暂存版本？未暂存的修改将丢失。`} confirmLabel={discard.status === 'untracked' ? '删除' : '丢弃'} requireCheck={false} onClose={() => setDiscard(null)} onConfirm={() => { const file = discard; setDiscard(null); run('丢弃', () => { setUnstaged(unstaged.filter((item) => item.path !== file.path)); setUntracked(untracked.filter((item) => item.path !== file.path)); if (selected?.path === file.path) setSelected(null); }); }} />}
    </div>
  );
}
