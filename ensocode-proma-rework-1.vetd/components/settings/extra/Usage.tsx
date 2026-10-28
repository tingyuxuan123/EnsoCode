import { useEffect, useState } from 'react';
import { DangerConfirm, Empty, Segmented, Spinner, inputClass } from '../../Controls';
import { Overlay, useWorkbench } from '../../Workbench';
import { InlineNotice, SettingsHeader, SettingsSection, outlineButton, primaryButton, selectClass } from '../SettingsUI';
import { Checkbox } from './common';

type Range = '1' | '7' | '30' | '90';
const scale: Record<Range, number> = { '1': 0.16, '7': 1, '30': 3.9, '90': 10.6 };
const base = [
  { label: '预估费用', value: 18.42, fmt: (v: number) => `$${v.toFixed(2)}`, delta: 12 },
  { label: '总 Token', value: 9.8, fmt: (v: number) => `${v.toFixed(1)}M`, delta: 8 },
  { label: '输入 Token', value: 2.1, fmt: (v: number) => `${v.toFixed(1)}M`, delta: -4 },
  { label: '输出 Token', value: 0.62, fmt: (v: number) => `${Math.round(v * 1000)}K`, delta: 15 },
  { label: '缓存 Token', value: 7.1, fmt: (v: number) => `${v.toFixed(1)}M`, delta: 11 },
  { label: '活跃时长', value: 14.5, fmt: (v: number) => `${v.toFixed(1)} 小时`, delta: 3 },
  { label: '会话数', value: 46, fmt: (v: number) => String(Math.round(v)), delta: -9 },
  { label: '消息数', value: 1284, fmt: (v: number) => Math.round(v).toLocaleString(), delta: 6 },
];
const daily = [[0.6, 0.3, 1.8], [0.9, 0.4, 2.2], [0.4, 0.2, 1.1], [1.2, 0.5, 2.8], [0.8, 0.4, 2.0], [0.2, 0.1, 0.4], [0.5, 0.2, 1.3]];
const models = [['Claude Sonnet 4.5', 11.2, 5.9, 612], ['GPT-5 Codex', 4.8, 2.6, 401], ['Gemini 2.5 Flash', 0.9, 0.8, 196], ['deepseek-chat', 0, 0.5, 75]] as const;
const projectsRank = [['EnsoCode', 12.9, 6.4, 28], ['phone-companion', 3.1, 1.8, 9], ['relay-service', 2.4, 1.6, 7], ['（无项目）', 0.02, 0.01, 2]] as const;
const members = [['产品调研员', 1.6, 0.9, 6], ['发布助手', 0.8, 0.4, 3], ['已删除成员', 0.1, 0.05, 1]] as const;

function Rank({ title, count, rows }: { title: string; count: string; rows: readonly (readonly [string, number, number, number])[] }) {
  const max = Math.max(...rows.map((r) => r[1]), 0.01);
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[13px] font-medium">{title}</p>
      <div className="rounded-control border border-line">
        <div className="grid grid-cols-[1fr_64px_56px_44px] gap-2 border-b border-line px-3 py-1.5 text-[11px] text-muted"><span>名称</span><span className="text-right">费用</span><span className="text-right">Token</span><span className="text-right">{count}</span></div>
        {rows.map(([name, cost, tokens, n]) => (
          <div key={name} className="relative grid grid-cols-[1fr_64px_56px_44px] gap-2 px-3 py-1.5 text-[12px]">
            <span className="absolute inset-y-1 left-0 rounded-r-[3px] bg-primary-soft" style={{ width: `${(cost / max) * 60}%` }} />
            <span className="relative truncate">{name}</span>
            <span className="relative text-right tabular-nums">{cost ? `$${cost.toFixed(2)}` : '—'}</span>
            <span className="relative text-right tabular-nums text-muted">{tokens.toFixed(1)}M</span>
            <span className="relative text-right tabular-nums text-muted">{n}</span>
          </div>
        ))}
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-faint">共 {rows.length} 项</p>
      </div>
    </div>
  );
}

/** UsageSettings：周期 / 八项指标与同期对比 / 每日趋势 / 分时活跃 / 排行 / 单价 */
export function UsagePage({ empty = false }: { empty?: boolean }) {
  const { botModeEnabled } = useWorkbench();
  const [range, setRange] = useState<Range>('7');
  const [loading, setLoading] = useState(false);
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens');
  const [priceQuery, setPriceQuery] = useState('');
  const [editing, setEditing] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 350);
    return () => window.clearTimeout(timer);
  }, [range]);
  const k = scale[range];
  const dayLabels = range === '1' ? ['0时', '4时', '8时', '12时', '16时', '20时', '23时'] : ['10/21', '10/22', '10/23', '10/24', '10/25', '10/26', '10/27'];
  const prices = [['claude-sonnet-4-5', '3.00', '15.00', '0.30', false], ['gpt-5-codex', '1.25', '10.00', '0.13', false], ['gemini-2.5-flash', '0.30', '2.50', '0.08', false], ['deepseek-chat', '', '', '', true]] as const;
  return (
    <>
      <SettingsHeader title="用量" description="统计本机全部会话的 Token 用量；费用按目录单价估算，可在下方覆盖。" actions={<button onClick={() => { setLoading(true); window.setTimeout(() => setLoading(false), 500); }} aria-label="刷新" title="刷新" className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-hover">{loading ? <Spinner /> : <span className="icon-[lucide--refresh-cw] size-3.5" />}</button>} />
      <div className="mb-4 flex items-center gap-3">
        <Segmented label="周期" value={range} onChange={setRange} options={[{ value: '1', label: '今天' }, { value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: '90', label: '90 天' }]} />
        <span className="text-[11px] text-muted">基于本机记录估算，不是订阅额度</span>
      </div>
      {empty ? (
        <div className="rounded-control border border-dashed border-border"><Empty icon="icon-[lucide--chart-column]" title="该周期内没有用量" description="在这段时间里开过会话后，这里会显示 Token 与费用。" /></div>
      ) : (
        <div className={loading ? 'opacity-50' : ''}>
          <div className="mb-6 grid grid-cols-4 gap-x-6 gap-y-4">
            {base.map((stat) => (
              <div key={stat.label}>
                <p className="text-[11px] text-muted">{stat.label}</p>
                <p className="mt-0.5 text-[20px] font-medium tabular-nums">{stat.fmt(stat.value * k)}</p>
                <p className={`text-[11px] tabular-nums ${stat.delta >= 0 ? 'text-success' : 'text-danger'}`}>{stat.delta >= 0 ? '↑' : '↓'} {Math.abs(stat.delta)}% 较上一周期</p>
              </div>
            ))}
          </div>
          <SettingsSection title="每日趋势" actions={<Segmented size="sm" label="趋势指标" value={metric} onChange={setMetric} options={[{ value: 'tokens', label: 'Token' }, { value: 'cost', label: '费用' }]} />}>
            <div className="flex h-[150px] items-end gap-3 border-b border-line pb-1">
              {daily.map(([out, input, cache], i) => {
                const total = metric === 'cost' ? out * 3 + input : out + input + cache;
                return (
                  <div key={i} className="flex h-full flex-1 flex-col items-center justify-end" title={`${dayLabels[i]} · ${total.toFixed(1)}${metric === 'cost' ? ' 美元' : 'M'}`}>
                    <div className="flex w-full max-w-[44px] flex-col-reverse overflow-hidden rounded-t-[3px]" style={{ height: `${(total / 8.4) * 100}%` }}>
                      <span className="bg-primary" style={{ flex: metric === 'cost' ? out * 3 : out }} />
                      <span className="bg-primary/55" style={{ flex: input }} />
                      {metric === 'tokens' && <span className="bg-control" style={{ flex: cache }} />}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-3 text-[11px] text-muted">{dayLabels.map((d) => <span key={d} className="flex-1 text-center tabular-nums">{d}</span>)}</div>
            <div className="mt-2 flex gap-4 text-[11px] text-muted"><span className="flex items-center gap-1"><span className="size-2 rounded-[2px] bg-primary" />输出</span><span className="flex items-center gap-1"><span className="size-2 rounded-[2px] bg-primary/55" />输入</span>{metric === 'tokens' && <span className="flex items-center gap-1"><span className="size-2 rounded-[2px] bg-control" />缓存</span>}</div>
          </SettingsSection>
          <SettingsSection title="分时活跃">
            <div className="grid grid-cols-[24px_repeat(24,1fr)] gap-[3px]">
              {['一', '二', '三', '四', '五', '六', '日'].map((day, row) => (
                <div key={day} className="contents">
                  <span className="text-[11px] leading-[14px] text-muted">{day}</span>
                  {Array.from({ length: 24 }, (_, h) => {
                    const v = h < 8 ? 0 : ((h * 7 + row * 5) % 11) / 10 * (row > 4 ? 0.3 : 1);
                    return <span key={h} title={`周${day} ${h}:00`} className="h-[14px] rounded-[2px] bg-primary" style={{ opacity: v < 0.08 ? 0.07 : 0.15 + v * 0.85 }} />;
                  })}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-muted">少{[0.07, 0.3, 0.55, 0.8, 1].map((o) => <span key={o} className="size-2.5 rounded-[2px] bg-primary" style={{ opacity: o }} />)}多</div>
          </SettingsSection>
          <SettingsSection>
            <div className="grid grid-cols-2 gap-4">
              <Rank title="按模型" count="消息数" rows={models} />
              <Rank title="按项目" count="会话数" rows={projectsRank} />
            </div>
            {botModeEnabled && <div className="mt-4"><Rank title="按成员" count="会话数" rows={members} /></div>}
            <InlineNotice tone="warning">以下模型无目录单价：deepseek-chat，其费用未计入。</InlineNotice>
          </SettingsSection>
        </div>
      )}
      <SettingsSection title="单价" description="费用估算用的单价（$/百万 tokens）。">
        <div className="mb-2 flex items-center gap-2">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-input px-2.5 text-muted"><span className="icon-[lucide--search] size-3.5" /><input value={priceQuery} onChange={(e) => setPriceQuery(e.target.value)} placeholder="搜索模型" aria-label="搜索模型" className="min-w-0 flex-1 bg-transparent text-[12px] text-surface-foreground outline-none" /></label>
          <button onClick={() => setEditing('new')} className={outlineButton}><span className="icon-[lucide--plus] size-3.5" />添加</button>
        </div>
        {error && <p role="alert" className="mb-2 text-[12px] text-danger">{error}</p>}
        <div className="rounded-control border border-line text-[12px]">
          <div className="grid grid-cols-[1fr_72px_72px_72px_64px] gap-2 border-b border-line px-3 py-1.5 text-[11px] text-muted"><span>模型 id</span><span className="text-right">输入</span><span className="text-right">输出</span><span className="text-right">缓存读</span><span /></div>
          {editing === 'new' && (
            <div className="grid grid-cols-[1fr_72px_72px_72px_64px] items-center gap-2 border-b border-line bg-panel/50 px-3 py-1.5">
              <input placeholder="模型 id" className={`${inputClass} h-7 font-mono text-[12px]`} />
              {[0, 1, 2].map((i) => <input key={i} placeholder="0.00" className={`${inputClass} h-7 text-right`} />)}
              <span className="flex justify-end gap-2"><button onClick={() => setError('请填写模型 id 和非负单价。')} className="text-primary">保存</button><button onClick={() => { setEditing(''); setError(''); }} className="text-muted">取消</button></span>
            </div>
          )}
          {prices.filter(([id]) => !priceQuery || id.includes(priceQuery)).map(([id, input, output, cache, missing]) => (
            <div key={id} className="grid grid-cols-[1fr_72px_72px_72px_64px] items-center gap-2 px-3 py-1.5">
              <span className="flex items-center gap-1.5 font-mono">{id}{missing && <span className="font-sans text-[11px] text-warning">缺少单价</span>}{id === 'gpt-5-codex' && <span className="font-sans text-[11px] text-primary">自定义</span>}</span>
              <span className="text-right tabular-nums">{input || '—'}</span>
              <span className="text-right tabular-nums">{output || '—'}</span>
              <span className="text-right tabular-nums">{cache || '—'}</span>
              <button className="text-right text-primary">编辑</button>
            </div>
          ))}
        </div>
      </SettingsSection>
    </>
  );
}

const procGroups = [
  { name: '应用进程', rows: [['主进程', '2.1%', '182 MB'], ['主窗口', '6.4%', '412 MB'], ['设置', '0.3%', '96 MB'], ['内置浏览器', '1.2%', '268 MB']] },
  { name: 'Agent 与工具', rows: [['会话 · 统一工作台布局与侧栏样式', '18.6%', '624 MB'], ['MCP · github', '0.1%', '48 MB'], ['工具 · pnpm dev', '3.8%', '310 MB']] },
  { name: '其他子进程', rows: [['记忆嵌入模型 bge-m3', '0.0%', '702 MB']] },
];
const storage = [
  { id: 'data', name: '应用数据', size: '1.2 GB', files: 2840, protect: '设置与密钥不会被清理', clean: false },
  { id: 'sessions', name: '会话记录', size: '3.4 GB', files: 612, protect: '当前打开、运行中和等待处理的会话会跳过。', clean: true },
  { id: 'worktree', name: 'Worktree 目录', size: '6.8 GB', files: 18, protect: '仅清理已合并且干净的隔离 worktree', clean: true },
  { id: 'browser', name: '内置浏览器', size: '420 MB', files: 1340, protect: '内置浏览器中打开过的网站将退出登录。', clean: true },
  { id: 'cache', name: '缓存', size: '880 MB', files: 9120, protect: '删除的文件无法恢复。', clean: true },
];

/** ResourcesSettings：内存（进程分组）/ 存储扫描 / 分类清理确认 / 会话筛选清理 */
export function ResourcesPage({ dialog = '' }: { dialog?: '' | 'sessions' }) {
  const [tab, setTab] = useState<'memory' | 'storage'>(dialog ? 'storage' : 'memory');
  const [scan, setScan] = useState<'idle' | 'scanning' | 'done'>('done');
  const [scanned, setScanned] = useState(0);
  const [cleanTarget, setCleanTarget] = useState('');
  const [sessions, setSessions] = useState(dialog === 'sessions');
  const [project, setProject] = useState('全部项目');
  const [days, setDays] = useState('30');
  const [includeOpen, setIncludeOpen] = useState(false);
  const [toast, setToast] = useState('');
  useEffect(() => {
    if (scan !== 'scanning') return;
    if (scanned >= 13930) { setScan('done'); return; }
    const timer = window.setTimeout(() => setScanned(Math.min(13930, scanned + 3500)), 250);
    return () => window.clearTimeout(timer);
  }, [scan, scanned]);
  const target = storage.find((s) => s.id === cleanTarget);
  return (
    <>
      <SettingsHeader title="资源" description="EnsoCode 及其启动的进程占用的 CPU、内存和磁盘。" actions={<Segmented label="资源类型" value={tab} onChange={setTab} options={[{ value: 'memory', label: '内存' }, { value: 'storage', label: '存储' }]} />} />
      {toast && <InlineNotice action={<button onClick={() => setToast('')} aria-label="关闭"><span className="icon-[lucide--x] size-3" /></button>}>{toast}</InlineNotice>}
      {tab === 'memory' ? (
        <>
          <div className="mb-5 flex gap-8">
            <div><p className="text-[11px] text-muted">CPU</p><p className="text-[20px] font-medium tabular-nums">32.5%</p></div>
            <div><p className="text-[11px] text-muted">内存</p><p className="text-[20px] font-medium tabular-nums">2.6 GB</p></div>
            <div><p className="text-[11px] text-muted">系统</p><p className="text-[20px] font-medium tabular-nums">18.4 / 32 GB</p></div>
          </div>
          {procGroups.map((group) => (
            <SettingsSection key={group.name} title={group.name}>
              <div className="rounded-control border border-line text-[12px]">
                {group.rows.map(([name, cpu, mem]) => (
                  <div key={name} className="grid grid-cols-[1fr_64px_80px] gap-2 border-b border-line px-3 py-1.5 last:border-b-0">
                    <span className="truncate">{name}</span>
                    <span className="text-right tabular-nums text-muted">{cpu}</span>
                    <span className="text-right tabular-nums">{mem}</span>
                  </div>
                ))}
              </div>
            </SettingsSection>
          ))}
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3 text-[12px] text-muted">
            {scan === 'scanning' ? <span className="flex items-center gap-2"><Spinner />正在扫描 {scanned.toLocaleString()} 个文件 · {(scanned / 1100).toFixed(1)} GB</span> : <span>扫描于 14:52 · 用时 3 秒</span>}
            {scan === 'scanning' ? <button onClick={() => setScan('done')} className="ml-auto">取消</button> : <button onClick={() => { setScan('scanning'); setScanned(0); }} className={`${outlineButton} ml-auto h-7`}><span className="icon-[lucide--refresh-cw] size-3.5" />刷新</button>}
          </div>
          <InlineNotice tone="warning">2 个路径无法读取，未计入。</InlineNotice>
          <div className="mb-5 flex h-2.5 overflow-hidden rounded-full bg-control">
            <span className="w-[9%] bg-surface-foreground/60" /><span className="w-[27%] bg-primary" /><span className="w-[53%] bg-primary/55" /><span className="w-[4%] bg-warning" /><span className="w-[7%] bg-success" />
          </div>
          <div className="divide-y divide-line rounded-control border border-line">
            {storage.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{s.name}<span className="ml-2 font-normal tabular-nums text-muted">{s.size} · {s.files.toLocaleString()} 个文件</span></p>
                  <p className="truncate text-[12px] text-muted">{s.protect}</p>
                </div>
                <button className="text-[12px] text-muted hover:text-surface-foreground">在文件夹中显示</button>
                {s.id === 'sessions' ? <button onClick={() => setSessions(true)} className={`${outlineButton} h-7`}>清理会话</button> : s.clean ? <button onClick={() => setCleanTarget(s.id)} className={`${outlineButton} h-7`}>清理</button> : <span className="w-[52px] text-right text-[11px] text-faint">受保护</span>}
              </div>
            ))}
          </div>
        </>
      )}
      {target && <Overlay><DangerConfirm title={`清理${target.name}？`} description={`释放 ${target.size}，删除 ${target.files.toLocaleString()} 个文件。${target.protect}`} confirmLabel="清理" onClose={() => setCleanTarget('')} onConfirm={() => { setCleanTarget(''); setToast(`已清理${target.name}：释放 ${target.size}。`); }} /></Overlay>}
      {sessions && (
        <Overlay>
          <DangerConfirm
            title={project === '全部项目' ? `删除 ${includeOpen ? 214 : 186} 个会话？` : `删除「${project}」下的 42 个会话？`}
            description={`将删除约 ${includeOpen ? '1.9' : '1.6'} GB 的对话记录、工具输出和隔离 worktree，无法恢复。当前打开、运行中和等待处理的会话会跳过。`}
            confirmLabel="删除"
            onClose={() => setSessions(false)}
            onConfirm={() => { setSessions(false); setToast(`已删除 ${includeOpen ? 214 : 186} 个会话。`); }}
          />
          <div className="pointer-events-none absolute inset-x-0 top-[calc(50%-130px)] z-[51] flex justify-center">
            <div className="pointer-events-auto flex w-[440px] items-center gap-2 rounded-t-control border border-b-0 border-border bg-panel px-5 py-2.5 text-[12px]">
              <select value={project} onChange={(e) => setProject(e.target.value)} className={selectClass}><option>全部项目</option><option>EnsoCode</option><option>relay-service</option><option>无项目</option></select>
              <select value={days} onChange={(e) => setDays(e.target.value)} className={selectClass}><option value="7">7 天前</option><option value="30">30 天前</option><option value="90">90 天前</option><option value="0">全部</option></select>
              <label className="ml-auto flex items-center gap-1.5"><Checkbox label="包含未归档会话" checked={includeOpen} onChange={setIncludeOpen} />包含未归档会话</label>
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}

export { primaryButton };
