import { useEffect, useState, type ReactNode } from 'react';
import { DangerConfirm, Dialog, Empty, Segmented, Spinner, Switch } from '../../Controls';
import { Overlay } from '../../Workbench';
import { Badge, InlineNotice, SettingsHeader, SettingsRow, SettingsSection, outlineButton, primaryButton, selectClass } from '../SettingsUI';
import { Checkbox, SubTabs, ToolGate } from './common';

const tabs = [
  { id: 'settings', label: '设置', to: '/settings-memory' },
  { id: 'library', label: '知识与记忆库', to: '/settings-memory--library' },
];

function Stat({ label, value, action }: { label: string; value: string; action?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-2 text-[18px] font-medium tabular-nums">{value}{action}</p>
    </div>
  );
}

/** MemorySettings：嵌入模型 / 提炼 / 后台处理 / 记忆库统计 / 提炼历史会话 / 后台任务 */
export function MemorySettingsPage() {
  const [backend, setBackend] = useState<'local' | 'remote' | 'openai'>('local');
  const [download, setDownload] = useState<'none' | 'downloading' | 'done'>('none');
  const [progress, setProgress] = useState(0);
  const [autoDownload, setAutoDownload] = useState(false);
  const [autoDistill, setAutoDistill] = useState(true);
  const [entities, setEntities] = useState(true);
  const [distill, setDistill] = useState<'idle' | 'running' | 'done'>('idle');
  const [done, setDone] = useState(0);
  const [backfill, setBackfill] = useState(false);
  const [rerun, setRerun] = useState(false);
  useEffect(() => {
    if (download !== 'downloading') return;
    if (progress >= 100) { setDownload('done'); return; }
    const timer = window.setTimeout(() => setProgress(progress + 20), 400);
    return () => window.clearTimeout(timer);
  }, [download, progress]);
  useEffect(() => {
    if (distill !== 'running') return;
    if (done >= 37) { setDistill('done'); return; }
    const timer = window.setTimeout(() => setDone(Math.min(37, done + 6)), 350);
    return () => window.clearTimeout(timer);
  }, [distill, done]);
  return (
    <>
      <SettingsHeader title="记忆" description="可跨会话检索与写入的持久知识,本地存放在一个 SQLite 库里。" />
      <ToolGate tool="记忆" />
      <SubTabs value="settings" tabs={tabs} />
      <SettingsSection title="嵌入模型" description="用于语义检索与近重复识别。没有它检索仍可用,只是退化为纯全文。">
        <div className="mb-2"><Segmented label="嵌入模型来源" value={backend} onChange={setBackend} options={[{ value: 'local', label: '本地' }, { value: 'remote', label: '远程（API 模型）' }, { value: 'openai', label: '远程（OpenAI 兼容）' }]} /></div>
        {backend === 'local' ? (
          <>
            <SettingsRow label="bge-m3 · Q8 · 610 MB" description={download === 'done' ? '模型已下载' : download === 'downloading' ? '下载中…' : '模型未下载 · 模型落盘前语义检索不会生效。'}>
              {download === 'none' && <button onClick={() => { setDownload('downloading'); setProgress(0); }} className={outlineButton}><span className="icon-[lucide--download] size-3.5" />下载</button>}
              {download === 'downloading' && (
                <>
                  <span className="h-1.5 w-28 overflow-hidden rounded-full bg-control"><span className="block h-full bg-primary" style={{ width: `${progress}%` }} /></span>
                  <span className="w-9 text-right text-[12px] tabular-nums text-muted">{progress}%</span>
                  <button onClick={() => setDownload('none')} className="text-[12px] text-muted">取消</button>
                </>
              )}
              {download === 'done' && <><Badge tone="success">模型已下载</Badge><button onClick={() => setDownload('none')} className="text-[12px] text-muted hover:text-danger">移除</button></>}
            </SettingsRow>
            <SettingsRow label="自动下载模型" description="默认关闭,模型只在你点「下载」时才获取。模型缺失期间检索降级为纯全文,模型就绪后已有记忆会自动补向量。"><Switch label="自动下载模型" checked={autoDownload} onChange={setAutoDownload} /></SettingsRow>
            <SettingsRow label="空闲自动卸载" description="空闲达到此时长后释放本地模型内存，下次需要时会自动加载。"><select className={selectClass} defaultValue="10"><option value="0">永不</option><option value="5">5 分钟</option><option value="10">10 分钟</option><option value="30">30 分钟</option></select></SettingsRow>
          </>
        ) : (
          <SettingsRow label="远程模型" description="凭证只留在主进程,不会下发到渲染层。">
            <select className={`${selectClass} w-60`} defaultValue=""><option value="" disabled>选择模型</option><option>OpenAI API / text-embedding-3-large</option><option>Gemini API / gemini-embedding-001</option></select>
          </SettingsRow>
        )}
      </SettingsSection>
      <SettingsSection title="提炼">
        <SettingsRow label="提炼模型" description="读已结束的会话并写出记忆。"><select className={`${selectClass} w-52`}><option>跟随标题模型</option><option>Claude Haiku 4.5</option><option>Gemini 2.5 Flash</option></select></SettingsRow>
        <SettingsRow label="记忆语言" description="英文能让跨语言的检索与近重复识别更稳。团队只用一种语言时可选「跟随对话」。"><select className={selectClass}><option>英文</option><option>简体中文</option><option>跟随会话</option></select></SettingsRow>
      </SettingsSection>
      <SettingsSection title="后台处理">
        <SettingsRow label="自动提炼会话" description="会话结束、或空闲 30 分钟被回收时,在后台从中提炼 1-3 条值得长期保留的记忆。"><Switch label="自动提炼会话" checked={autoDistill} onChange={setAutoDistill} /></SettingsRow>
        <SettingsRow label="抽取实体" description="建立实体图谱,让正文里没出现该词的记忆也能被这个名字召回。"><Switch label="抽取实体" checked={entities} onChange={setEntities} /></SettingsRow>
      </SettingsSection>
      <SettingsSection title="记忆库">
        {download !== 'done' && backend === 'local' && <InlineNotice tone="warning">无法生成向量：嵌入模型未下载。86 条记忆待补向量。</InlineNotice>}
        <div className="grid grid-cols-4 gap-x-6 gap-y-4 rounded-control border border-line px-4 py-3">
          <Stat label="记忆数" value="412" />
          <Stat label="结晶数" value="18" />
          <Stat label="实体数" value="236" />
          <Stat label="已向量化" value={backfill ? '412/412' : '326/412'} action={!backfill && <button disabled={download !== 'done' && backend === 'local'} onClick={() => setBackfill(true)} className="text-[12px] font-normal text-primary disabled:text-faint">补齐</button>} />
          <Stat label="库体积" value="18.4 MB" />
          <Stat label="空间数" value="5" />
        </div>
      </SettingsSection>
      <SettingsSection title="提炼历史会话" description="自动开关只对从现在开始结束或被回收的会话生效。早于此的会话在这里手动提炼，否则记忆库一直是空的。">
        <div className="divide-y divide-line rounded-control border border-line">
          <div className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
            <span className="icon-[lucide--layers] size-4 text-muted" />
            <span className="flex-1">全部会话<span className="ml-2 text-[12px] text-muted">58 个会话 · 37 个未提炼</span></span>
            {distill === 'running' ? (
              <span className="flex items-center gap-2 text-[12px] text-muted"><Spinner />提炼中… 已完成 {done}/37 · 约剩 1 分钟</span>
            ) : distill === 'done' ? (
              <Badge tone="success">已提炼</Badge>
            ) : (
              <button onClick={() => setRerun(true)} className={primaryButton}>全部提炼（37）</button>
            )}
          </div>
          {[['EnsoCode', '31 个会话 · 12 个未提炼'], ['phone-companion', '9 个会话 · 已全部提炼'], ['relay-service', '18 个会话 · 25 个未提炼']].map(([name, meta], index) => (
            <div key={name} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="icon-[lucide--folder] size-4 text-muted" />
              <span className="flex-1">{name}<span className="ml-2 text-[12px] text-muted">{meta}</span></span>
              <button className="text-[12px] text-primary">{index === 1 ? '重新提炼' : '提炼本项目'}</button>
            </div>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection title="后台任务" actions={<button className="text-[12px] text-muted hover:text-surface-foreground" title="清除已完成和已作废的任务，进行中的保留。">清空历史任务</button>}>
        <div className="divide-y divide-line rounded-control border border-line text-[12px]">
          {[['提炼 · 统一工作台布局与侧栏样式', '进行中', 'running'], ['抽取实体 · 优化文件搜索体验', '已完成', 'done'], ['提炼 · 中继握手超时排查', '失败 · 模型超时', 'failed']].map(([label, status, tone]) => (
            <div key={label} className="flex items-center gap-2 px-3 py-2">
              {tone === 'running' ? <Spinner className="size-3.5 text-primary" /> : <span className={`${tone === 'failed' ? 'icon-[lucide--circle-x] text-danger' : 'icon-[lucide--circle-check] text-success'} size-3.5`} />}
              <span className="flex-1 truncate">{label}</span>
              <span className={tone === 'failed' ? 'text-danger' : 'text-muted'}>{status}</span>
            </div>
          ))}
        </div>
      </SettingsSection>
      {rerun && (
        <Overlay>
          <Dialog title="部分会话已经提炼过" width={460} onClose={() => setRerun(false)} footer={<><button onClick={() => setRerun(false)} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={() => { setRerun(false); setDistill('running'); setDone(0); }} className={outlineButton}>重新提炼全部 58 个</button><button onClick={() => { setRerun(false); setDistill('running'); setDone(0); }} className={primaryButton}>只提炼剩下的 37 个</button></>}>
            <p className="text-[13px] leading-6">全部会话：共 58 个会话，其中 21 个已提炼。重新提炼会再跑一次模型，可能在现有记忆之外新增几条。</p>
          </Dialog>
        </Overlay>
      )}
    </>
  );
}

const entityNodes = [
  { id: 'e1', x: 300, y: 130, r: 22, label: 'EnsoCode', type: 'project' },
  { id: 'e2', x: 160, y: 70, r: 14, label: 'settings store', type: 'module' },
  { id: 'e3', x: 450, y: 70, r: 16, label: 'Sidebar', type: 'module' },
  { id: 'e4', x: 470, y: 200, r: 11, label: 'dockview', type: 'library' },
  { id: 'e5', x: 140, y: 200, r: 12, label: 'IPC 收窄', type: 'decision' },
  { id: 'e6', x: 300, y: 235, r: 10, label: 'worktree', type: 'concept' },
  { id: 'e7', x: 70, y: 130, r: 9, label: 'zustand', type: 'library' },
  { id: 'e8', x: 560, y: 120, r: 9, label: 'GroupChips', type: 'module' },
];
const edges = [['e1', 'e2'], ['e1', 'e3'], ['e1', 'e4'], ['e1', 'e5'], ['e1', 'e6'], ['e2', 'e7'], ['e3', 'e8'], ['e2', 'e5'], ['e3', 'e4']];
const typeColor: Record<string, string> = { project: 'fill-primary', module: 'fill-success', library: 'fill-warning', decision: 'fill-danger', concept: 'fill-muted' };

const memories = [
  { id: 'm1', text: 'IPC 入参一律按 unknown 收窄，不能用类型断言代替校验。', kind: '决策', space: 'EnsoCode', importance: '关键', hits: 14, crystal: false, archived: false },
  { id: 'm2', text: '用户偏好：中文回复，先给结论再给细节；不要无关重构。', kind: '偏好', space: '全局', importance: '重要', hits: 31, crystal: false, archived: false },
  { id: 'm3', text: '设置页隐藏分类时落到「内置工具」而不是「通用」，便于重新打开。', kind: '事实', space: 'EnsoCode', importance: '有用', hits: 4, crystal: false, archived: false },
  { id: 'm4', text: '侧栏与右侧面板交互的结晶：分组、置顶与停靠面板共用一套拖拽与键盘规则。', kind: '结晶', space: 'EnsoCode', importance: '重要', hits: 7, crystal: true, archived: false },
  { id: 'm5', text: '旧约定：设置写进 localStorage（已被 settings.json 取代）。', kind: '事实', space: 'EnsoCode', importance: '次要', hits: 0, crystal: false, archived: true },
];

/** MemoryKnowledge（图谱/知识树、解读、结晶）+ MemoryLibrary（审阅、Bot 写入审批、检索、分页、归档/删除、详情与版本） */
export function MemoryLibraryPage() {
  const [view, setView] = useState<'graph' | 'tree'>('graph');
  const [treeBy, setTreeBy] = useState<'type' | 'entity' | 'month'>('type');
  const [picked, setPicked] = useState<string[]>(['e1', 'e2']);
  const [interpret, setInterpret] = useState<'' | 'loading' | 'done'>('');
  const [mode, setMode] = useState<'exact' | 'fast' | 'deep'>('fast');
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState('');
  const [remove, setRemove] = useState(false);
  const [approvals, setApprovals] = useState(['写入「EnsoCode」项目记忆：发版必须走 personal-v tag，不在本机打包。']);
  const [review, setReview] = useState(true);
  useEffect(() => {
    if (interpret !== 'loading') return;
    const timer = window.setTimeout(() => setInterpret('done'), 900);
    return () => window.clearTimeout(timer);
  }, [interpret]);
  const list = memories.filter((m) => (showArchived || !m.archived) && (!query || m.text.includes(query)));
  const active = memories.find((m) => m.id === detail);
  const node = (id: string) => entityNodes.find((n) => n.id === id)!;
  return (
    <>
      <SettingsHeader title="记忆" description="可跨会话检索与写入的持久知识,本地存放在一个 SQLite 库里。" />
      <SubTabs value="library" tabs={tabs} />
      <SettingsSection title="知识" description="用图谱或树浏览 agent 已知的知识，让它解读，并把相关记忆合成结晶。" actions={<Segmented size="sm" label="知识视图" value={view} onChange={setView} options={[{ value: 'graph', label: '图谱' }, { value: 'tree', label: '知识树' }]} />}>
        <div className="rounded-control border border-line">
          {view === 'graph' ? (
            <div className="relative">
              <svg viewBox="0 0 640 270" className="h-[250px] w-full" role="img" aria-label="实体图谱">
                {edges.map(([a, b]) => <line key={`${a}-${b}`} x1={node(a).x} y1={node(a).y} x2={node(b).x} y2={node(b).y} className="stroke-border" strokeWidth={1} />)}
                {entityNodes.map((n) => (
                  <g key={n.id} onClick={() => setPicked(picked.includes(n.id) ? picked.filter((p) => p !== n.id) : [...picked, n.id])} className="cursor-pointer">
                    <circle cx={n.x} cy={n.y} r={n.r} className={`${typeColor[n.type]} ${picked.includes(n.id) ? 'stroke-surface-foreground' : 'stroke-surface'}`} strokeWidth={picked.includes(n.id) ? 2 : 1.5} fillOpacity={0.75} />
                    <text x={n.x} y={n.y + n.r + 12} textAnchor="middle" className="fill-surface-foreground text-[11px]">{n.label}</text>
                  </g>
                ))}
              </svg>
              <div className="absolute right-2 top-2 flex gap-1">
                {[['icon-[lucide--maximize]', '缩放到全图'], ['icon-[lucide--scan]', '适应窗口'], ['icon-[lucide--refresh-cw]', '重新布局']].map(([icon, label]) => <button key={label} title={label} aria-label={label} className="flex size-7 items-center justify-center text-muted hover:text-surface-foreground"><span className={`${icon} size-3.5`} /></button>)}
              </div>
              <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">颜色 = 实体类型 · 大小 = 被多少条记忆提及 · 236 个实体中的 8 个</p>
            </div>
          ) : (
            <div className="p-3">
              <div className="mb-2"><Segmented size="sm" label="知识树分组" value={treeBy} onChange={setTreeBy} options={[{ value: 'type', label: '按类型' }, { value: 'entity', label: '按实体' }, { value: 'month', label: '按月份' }]} /></div>
              {(treeBy === 'month' ? ['2026-10 · 96', '2026-09 · 188', '2026-08 · 128'] : treeBy === 'entity' ? ['EnsoCode · 141', 'settings store · 38', 'Sidebar · 29'] : ['决策 · 74', '偏好 · 22', '事实 · 298', '结晶 · 18']).map((row, index) => (
                <div key={row}>
                  <div className="flex h-7 items-center gap-1.5 text-[13px]"><span className={`${index === 0 ? 'icon-[lucide--chevron-down]' : 'icon-[lucide--chevron-right]'} size-3.5 text-faint`} />{row}</div>
                  {index === 0 && memories.slice(0, 2).map((m) => <label key={m.id} className="flex h-7 items-center gap-2 pl-6 text-[12px] text-muted"><Checkbox label="选中记忆" checked={picked.includes(m.id)} onChange={(on) => setPicked(on ? [...picked, m.id] : picked.filter((p) => p !== m.id))} /><span className="truncate">{m.text}</span></label>)}
                </div>
              ))}
              <p className="mt-2 text-[11px] text-muted">显示 30 / 412</p>
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[12px]">
            <span className="text-muted">已选 {picked.length} 项</span>
            <button disabled={!picked.length || interpret === 'loading'} onClick={() => setInterpret('loading')} className={`${outlineButton} ml-auto h-7`}>{interpret === 'loading' ? <><Spinner />解读中…</> : '解读'}</button>
            <button disabled={picked.length < 3} title="至少 3 条" className={`${primaryButton} h-7`}>结晶（3 条起）</button>
          </div>
          {interpret === 'done' && (
            <div className="border-t border-line bg-panel/60 px-3 py-2.5 text-[13px] leading-6">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">基于 23 条记忆<button onClick={() => setInterpret('')} className="ml-auto" aria-label="关闭"><span className="icon-[lucide--x] size-3" /></button></div>
              EnsoCode 的设置读写都经由 settings store；IPC 入参在 Main 侧按 unknown 收窄。涉及隐藏分类时优先落到能重新打开它的页面。
            </div>
          )}
        </div>
      </SettingsSection>
      {review && (
        <SettingsSection title="待审阅" description="审阅只记录你的判断,不会删除任何记忆,也不会让任何一条被取代。">
          <div className="rounded-control border border-line px-3 py-2.5 text-[13px]">
            <p>「设置写进 localStorage」与「设置写进 settings.json」可能互相矛盾。</p>
            <div className="mt-2 flex justify-end gap-2"><button onClick={() => setReview(false)} className="text-[12px] text-muted">忽略</button><button onClick={() => setReview(false)} className={`${primaryButton} h-7`}>接受</button></div>
          </div>
        </SettingsSection>
      )}
      <SettingsSection title="待批准的记忆写入" description="Bot 成员写入项目或全局记忆前需要你批准。">
        {approvals.length ? approvals.map((text) => (
          <div key={text} className="flex items-start gap-3 rounded-control border border-line px-3 py-2.5 text-[13px]">
            <span className="icon-[lucide--bot] mt-0.5 size-4 shrink-0 text-muted" />
            <div className="min-w-0 flex-1"><p>{text}</p><p className="mt-0.5 text-[11px] text-muted">发布助手 · 已脱敏密钥 1 处</p></div>
            <button onClick={() => setApprovals([])} className="text-[12px] text-danger">拒绝</button>
            <button onClick={() => setApprovals([])} className={`${primaryButton} h-7`}>批准</button>
          </div>
        )) : <p className="text-[12px] text-muted">没有待批准的写入。</p>}
      </SettingsSection>
      <SettingsSection title="已存记忆" description="agent 存下的全部记忆。归档只是让它不再出现在检索里，内容仍保留。">
        <div className="mb-2 flex items-center gap-2">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-input px-2.5 text-muted"><span className="icon-[lucide--search] size-3.5" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索记忆" aria-label="搜索记忆" className="min-w-0 flex-1 bg-transparent text-[12px] text-surface-foreground outline-none" /></label>
          <select className={selectClass}><option>全部空间</option><option>全局</option><option>EnsoCode</option></select>
          <select className={selectClass}><option>全部类型</option><option>决策</option><option>偏好</option><option>事实</option><option>结晶</option></select>
        </div>
        <div className="mb-2 flex items-center gap-3">
          <Segmented size="sm" label="检索方式" value={mode} onChange={setMode} options={[{ value: 'exact', label: '精确匹配' }, { value: 'fast', label: '快速检索' }, { value: 'deep', label: '深入检索' }]} />
          <label className="flex items-center gap-1.5 text-[12px] text-muted"><Checkbox label="显示已归档" checked={showArchived} onChange={setShowArchived} />显示已归档</label>
          {mode !== 'exact' && <span className="ml-auto text-[11px] text-warning">嵌入模型未就绪，本次跳过了向量通道。</span>}
        </div>
        {selected.length > 0 && (
          <div className="mb-2 flex items-center gap-3 rounded-control bg-panel px-3 py-1.5 text-[12px]">
            已选 {selected.length} 项
            <button onClick={() => setSelected([])} className="text-muted">取消选择</button>
            <button onClick={() => setSelected([])} className="ml-auto text-surface-foreground">归档所选</button>
            <button onClick={() => setRemove(true)} className="text-danger">永久删除</button>
          </div>
        )}
        {list.length ? (
          <div className="divide-y divide-line rounded-control border border-line">
            {list.map((m) => (
              <div key={m.id} onClick={() => setDetail(m.id)} className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-hover ${m.archived ? 'opacity-60' : ''}`}>
                <span className="mt-0.5" onClick={(e) => e.stopPropagation()}><Checkbox label="选中记忆" checked={selected.includes(m.id)} onChange={(on) => setSelected(on ? [...selected, m.id] : selected.filter((s) => s !== m.id))} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-5">{m.text}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <Badge tone={m.crystal ? 'primary' : 'neutral'}>{m.kind}</Badge>
                    {m.space} · 重要度 {m.importance} · 命中 {m.hits} 次
                    {m.archived && <Badge>已归档</Badge>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="rounded-control border border-dashed border-border"><Empty icon="icon-[lucide--search-x]" title="没有符合当前筛选条件的记忆。" /></div>}
        <div className="mt-2 flex items-center justify-end gap-3 text-[12px] text-muted"><button disabled className="disabled:text-faint">上一页</button><span className="tabular-nums">1 / 21</span><button className="text-surface-foreground">下一页</button></div>
      </SettingsSection>
      {active && (
        <Overlay>
          <Dialog title="记忆详情" width={560} onClose={() => setDetail('')} footer={<><button onClick={() => { setDetail(''); setRemove(true); }} className="mr-auto text-[12px] text-danger">永久删除</button><button onClick={() => setDetail('')} className={outlineButton}>{active.archived ? '还原' : '归档'}</button></>}>
            <p className="text-[14px] leading-6">{active.text}</p>
            <dl className="mt-4 grid grid-cols-[88px_1fr] gap-y-1.5 text-[12px]">
              <dt className="text-muted">重要度</dt><dd>{active.importance}</dd>
              <dt className="text-muted">向量模型</dt><dd className="font-mono">bge-m3</dd>
              <dt className="text-muted">事件日期</dt><dd>2026-10-14</dd>
              <dt className="text-muted">实体数</dt><dd>3</dd>
              {active.crystal && <><dt className="text-muted">合成自</dt><dd>5 条记忆</dd></>}
            </dl>
            <p className="mt-4 border-t border-line pt-3 text-[12px] font-medium">相关版本</p>
            <div className="mt-1.5 flex items-center gap-2 text-[12px] text-muted"><span className="flex-1">2026-09-02 · 早期表述：「IPC 参数需要校验」</span><button className="text-primary">还原</button></div>
          </Dialog>
        </Overlay>
      )}
      {remove && <Overlay><DangerConfirm title={`永久删除这 ${Math.max(selected.length, 1)} 条记忆?`} description="此操作不可撤销。归档可以让它不再出现在检索里,同时保留内容。" confirmLabel="永久删除" onClose={() => setRemove(false)} onConfirm={() => { setRemove(false); setSelected([]); }} /></Overlay>}
    </>
  );
}


