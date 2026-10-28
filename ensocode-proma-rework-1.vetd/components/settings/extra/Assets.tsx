import { useEffect, useState } from 'react';
import { DangerConfirm, Dialog, Empty, Segmented, Spinner, Switch, inputClass } from '../../Controls';
import { Overlay } from '../../Workbench';
import { Badge, FilterBar, InlineNotice, SettingsHeader, SettingsRow, SettingsSection, outlineButton, primaryButton, selectClass } from '../SettingsUI';
import { Checkbox } from './common';

/** 「从本地应用导入」弹窗（LocalAssetImportDialog）：扫描来源 → 勾选 → 以引用方式登记；重复候选标出 */
function ImportDialog({ kind, onClose }: { kind: string; onClose: () => void }) {
  const [scanning, setScanning] = useState(true);
  const [picked, setPicked] = useState<string[]>(['frontend-design', 'pdf-tools']);
  const rows = kind === 'MCP' ? [['github', 'Claude Desktop', false], ['filesystem', 'Cursor', true], ['linear', 'Codex', false]] : kind === '指令文件' ? [['CLAUDE.md', 'Claude Code · ~/.claude', false], ['AGENTS.md', 'Codex · ~/.codex', false]] : [['frontend-design', 'Claude Code', false], ['pdf-tools', 'Codex', false], ['project-knowledge', 'Cursor', true]];
  useEffect(() => {
    const timer = window.setTimeout(() => setScanning(false), 700);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <Overlay>
      <Dialog title={`从本地应用导入${kind}`} description="扫描 Claude Code、Codex、Cursor、Claude Desktop 的本机配置。以引用方式登记,文件仍留在原应用目录。" width={520} onClose={onClose} footer={<><button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button><button disabled={!picked.length || scanning} onClick={onClose} className={primaryButton}>导入 {picked.length} 项</button></>}>
        {scanning ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted"><Spinner />正在扫描本机应用…</div>
        ) : (
          <div className="divide-y divide-line rounded-control border border-line">
            {rows.map(([name, source, dup]) => (
              <label key={String(name)} className={`flex items-center gap-3 px-3 py-2 text-[13px] ${dup ? 'opacity-60' : ''}`}>
                <Checkbox label={String(name)} checked={picked.includes(String(name))} onChange={(on) => setPicked(on ? [...picked, String(name)] : picked.filter((p) => p !== name))} />
                <span className="font-medium">{name}</span>
                <span className="text-[12px] text-muted">{source}</span>
                {dup && <Badge>已存在同名</Badge>}
              </label>
            ))}
          </div>
        )}
      </Dialog>
    </Overlay>
  );
}

const skills = [
  { name: 'frontend-design', desc: '按设计规范实现前端界面', source: 'Claude Code', path: '~/.claude/skills/frontend-design', tokens: 1840, on: true },
  { name: 'project-knowledge', desc: '检索项目约定与踩坑记录', source: '项目', path: '.agents/skills/project-knowledge', tokens: 2210, on: true },
  { name: 'pdf-tools', desc: '合并、拆分与提取 PDF 文本', source: 'Codex', path: '~/.codex/skills/pdf-tools', tokens: 960, on: false },
  { name: 'release-notes', desc: '根据 git log 撰写发版说明', source: '本机 .agents', path: '~/.agents/skills/release-notes', tokens: 640, on: true },
];

/** SkillsSettings：加载开关 / 导入 / 筛选与来源 / 多选启停 / 只读查看正文 */
export function SkillsPage({ empty = false }: { empty?: boolean }) {
  const [loadLocal, setLoadLocal] = useState(true);
  const [loadOthers, setLoadOthers] = useState(false);
  const [list, setList] = useState(empty ? [] : skills);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('全部来源');
  const [picked, setPicked] = useState<string[]>([]);
  const [view, setView] = useState('');
  const [importing, setImporting] = useState(false);
  const shown = list.filter((s) => (!query || s.name.includes(query) || s.desc.includes(query)) && (source === '全部来源' || s.source === source));
  const enabled = list.filter((s) => s.on).length;
  const active = list.find((s) => s.name === view);
  return (
    <>
      <SettingsHeader title="技能" description={`已启用 ${enabled}/${list.length} · 以引用方式登记,文件仍留在原应用目录`} actions={<button onClick={() => setImporting(true)} className={outlineButton}><span className="icon-[lucide--download] size-3.5" />从本地应用导入</button>} />
      <InlineNotice>输入框的 / 菜单会立即更新，但已打开的会话仍使用原来加载的技能，新建会话后才会加载改动。</InlineNotice>
      <SettingsSection>
        <SettingsRow label="加载本机 skill" description="让 agent 自动发现 .agents/skills、.pi/skills 下的 skill"><Switch label="加载本机 skill" checked={loadLocal} onChange={setLoadLocal} /></SettingsRow>
        <SettingsRow label="加载项目内其它工具目录" description="同时加载项目内 .claude/.codex/.cursor 下的 skills，以及规则文件（.cursorrules、.cursor/rules、.claude/rules）"><Switch label="加载项目内其它工具目录" checked={loadOthers} onChange={setLoadOthers} /></SettingsRow>
      </SettingsSection>
      <SettingsSection title="已登记技能">
        {list.length ? (
          <>
            <FilterBar placeholder="筛选技能..." value={query} onChange={setQuery}>
              <select value={source} onChange={(e) => setSource(e.target.value)} className={selectClass}>{['全部来源', 'Claude Code', 'Codex', '项目', '本机 .agents'].map((s) => <option key={s}>{s}</option>)}</select>
            </FilterBar>
            {picked.length > 0 && (
              <div className="mb-2 flex items-center gap-3 rounded-control bg-panel px-3 py-1.5 text-[12px]">
                已选 {picked.length} 项
                <button onClick={() => { setList(list.map((s) => picked.includes(s.name) ? { ...s, on: true } : s)); setPicked([]); }} className="ml-auto">启用</button>
                <button onClick={() => { setList(list.map((s) => picked.includes(s.name) ? { ...s, on: false } : s)); setPicked([]); }}>停用</button>
                <button onClick={() => { setList(list.filter((s) => !picked.includes(s.name))); setPicked([]); }} className="text-danger">移除登记</button>
              </div>
            )}
            {shown.length ? (
              <div className="divide-y divide-line rounded-control border border-line">
                {shown.map((s) => (
                  <div key={s.name} className="flex items-center gap-3 px-3 py-2.5">
                    <Checkbox label={`选择 ${s.name}`} checked={picked.includes(s.name)} onChange={(on) => setPicked(on ? [...picked, s.name] : picked.filter((p) => p !== s.name))} />
                    <button onClick={() => setView(s.name)} className="min-w-0 flex-1 text-left">
                      <span className="flex items-center gap-2 text-[13px] font-medium">{s.name}<Badge>{s.source}</Badge><span className="text-[11px] font-normal tabular-nums text-faint">≈ {s.tokens} tokens</span></span>
                      <span className="block truncate text-[12px] text-muted">{s.desc}</span>
                    </button>
                    <Switch label={s.name} checked={s.on} onChange={(on) => setList(list.map((x) => x.name === s.name ? { ...x, on } : x))} />
                  </div>
                ))}
              </div>
            ) : <p className="py-8 text-center text-[12px] text-muted">无匹配结果</p>}
          </>
        ) : (
          <div className="rounded-control border border-dashed border-border"><Empty icon="icon-[lucide--sparkles]" title="暂无技能" description="从 Claude Code、Codex 或 Cursor 导入技能以开始使用" action={<button onClick={() => setImporting(true)} className={outlineButton}>从本地应用导入</button>} /></div>
        )}
      </SettingsSection>
      {active && (
        <Overlay>
          <Dialog title={active.name} description={active.desc} width={600} onClose={() => setView('')} footer={<button onClick={() => setView('')} className={outlineButton}>关闭</button>}>
            <dl className="mb-3 grid grid-cols-[56px_1fr] gap-y-1 text-[12px]"><dt className="text-muted">来源</dt><dd>{active.source}</dd><dt className="text-muted">路径</dt><dd className="font-mono">{active.path}/SKILL.md</dd></dl>
            <pre className="max-h-[260px] overflow-auto rounded-control bg-code p-3 font-mono text-[12px] leading-5">{`---\nname: ${active.name}\ndescription: ${active.desc}\n---\n\n# ${active.name}\n\n1. 先读取项目已有的组件与令牌。\n2. 只在需要时新增文件。\n3. 完成后截图自检。`}</pre>
            <p className="mt-2 text-[11px] text-muted">正文只读；编辑请在原应用目录中修改文件。</p>
          </Dialog>
        </Overlay>
      )}
      {importing && <ImportDialog kind="技能" onClose={() => setImporting(false)} />}
    </>
  );
}

const plugins = [
  { id: 'superpowers', name: 'superpowers', version: '4.2.0', on: true, components: [['技能', 12], ['命令', 6], ['子代理类型', 2]], hooks: false, missing: false },
  { id: 'github', name: 'github-tools', version: '1.3.1', on: false, components: [['MCP 服务器（会话启动时运行）', 1], ['命令', 3]], hooks: true, missing: false },
  { id: 'old', name: 'legacy-linter', version: '0.9.0', on: true, components: [], hooks: false, missing: true },
];

/** PluginsSettings：扫描本机 Claude Code 已安装插件（不是市场），整包开关，组件详情，清理已卸载 */
export function PluginsPage({ empty = false }: { empty?: boolean }) {
  const [list, setList] = useState(empty ? [] : plugins);
  const [open, setOpen] = useState('superpowers');
  const [scanning, setScanning] = useState(false);
  const rescan = () => { setScanning(true); window.setTimeout(() => setScanning(false), 900); };
  return (
    <>
      <SettingsHeader title="插件" description={`已启用 ${list.filter((p) => p.on && !p.missing).length} 个 · Claude Code 里已安装的插件，在这里按整包开关，新会话生效。`} actions={<button onClick={rescan} disabled={scanning} className={outlineButton}>{scanning ? <Spinner /> : <span className="icon-[lucide--refresh-cw] size-3.5" />}重新扫描</button>} />
      {list.length ? (
        <div className="divide-y divide-line rounded-control border border-line">
          {list.map((p) => (
            <div key={p.id}>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <button onClick={() => setOpen(open === p.id ? '' : p.id)} aria-expanded={open === p.id} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className={`${open === p.id ? 'icon-[lucide--chevron-down]' : 'icon-[lucide--chevron-right]'} size-3.5 text-faint`} />
                  <span className="icon-[lucide--puzzle] size-4 text-muted" />
                  <span className="text-[13px] font-medium">{p.name}</span>
                  <span className="font-mono text-[11px] text-faint">{p.version}</span>
                  {p.missing && <Badge tone="warning">Claude Code 中已卸载</Badge>}
                </button>
                {p.missing ? <button onClick={() => setList(list.filter((x) => x.id !== p.id))} className="text-[12px] text-danger">移除</button> : <Switch label={p.name} checked={p.on} onChange={(on) => setList(list.map((x) => x.id === p.id ? { ...x, on } : x))} />}
              </div>
              {open === p.id && (
                <div className="border-t border-line bg-panel/50 px-10 py-2.5 text-[12px]">
                  {p.components.length ? p.components.map(([label, count]) => <div key={String(label)} className="flex h-6 items-center gap-2"><span className="text-muted">{label}</span><span className="tabular-nums">{count}</span></div>) : <p className="text-muted">没有可用组件</p>}
                  {p.hooks && <div className="flex h-6 items-center gap-2 text-muted">Hooks（本地会话中自动运行）<Badge>暂不支持</Badge></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-control border border-dashed border-border"><Empty icon="icon-[lucide--puzzle]" title="没有找到 Claude Code 插件" description="在 Claude Code 里用 /plugin 安装插件后重新扫描。" action={<button onClick={rescan} className={outlineButton}>重新扫描</button>} /></div>
      )}
    </>
  );
}

type Mcp = { name: string; desc: string; transport: 'stdio' | 'http'; status: 'connecting' | 'ok' | 'unauth' | 'authed' | 'failed'; tools: number; tokens: number; on: boolean; mode: 'resident' | 'lazy' };
const servers: Mcp[] = [
  { name: 'github', desc: '仓库、Issue 与 PR', transport: 'http', status: 'ok', tools: 26, tokens: 8400, on: true, mode: 'lazy' },
  { name: 'linear', desc: '任务与项目看板', transport: 'http', status: 'unauth', tools: 0, tokens: 0, on: true, mode: 'resident' },
  { name: 'filesystem', desc: '读取指定目录外的文件', transport: 'stdio', status: 'connecting', tools: 0, tokens: 0, on: true, mode: 'resident' },
  { name: 'postgres', desc: '只读查询开发库', transport: 'stdio', status: 'failed', tools: 0, tokens: 0, on: true, mode: 'resident' },
  { name: 'figma', desc: '读取设计稿节点', transport: 'http', status: 'authed', tools: 0, tokens: 0, on: false, mode: 'lazy' },
];
const statusView = (s: Mcp) => ({ connecting: [<Spinner key="s" className="size-3" />, '连接中', 'text-muted'], ok: [<span key="d" className="size-1.5 rounded-full bg-success" />, `${s.tools} 个工具 · ≈${(s.tokens / 1000).toFixed(1)}K tokens`, 'text-muted'], unauth: [<span key="d" className="size-1.5 rounded-full bg-warning" />, '未授权', 'text-warning'], authed: [<span key="d" className="size-1.5 rounded-full bg-primary" />, '已授权，待连接', 'text-muted'], failed: [<span key="d" className="size-1.5 rounded-full bg-danger" />, '连接失败 · spawn psql ENOENT', 'text-danger'] }[s.status]);

/** McpEditDialog：表单 / JSON；stdio 命令·参数·env；HTTP URL·OAuth；超时 */
export function McpDialog({ onClose, editing }: { onClose: () => void; editing?: string }) {
  const [tab, setTab] = useState<'form' | 'json'>('form');
  const [name, setName] = useState(editing ?? '');
  const [transport, setTransport] = useState<'stdio' | 'http'>(editing === 'github' ? 'http' : 'stdio');
  const [command, setCommand] = useState(editing ? 'npx' : '');
  const [json, setJson] = useState('{\n  "mcpServers": {\n    "sentry": { "url": "https://mcp.sentry.dev/mcp" },\n    "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] }\n  }\n}');
  const [error, setError] = useState('');
  const save = () => {
    if (tab === 'json') {
      try {
        const parsed = JSON.parse(json);
        const count = Object.keys(parsed.mcpServers ?? { one: parsed }).length;
        if (!count) return setError('JSON 中没有有效的 MCP 服务器');
        if (editing && count > 1) return setError('JSON 只能描述一台 MCP 服务器');
      } catch { return setError('JSON 格式错误'); }
      return onClose();
    }
    if (!name.trim()) return setError('请填写名称。');
    if (!editing && servers.some((s) => s.name === name.trim())) return setError('该 MCP 服务器已存在');
    if (transport === 'stdio' && !command.trim()) return setError('请填写命令。');
    onClose();
  };
  const switchTab = (next: 'form' | 'json') => {
    setError('');
    if (next === 'form') {
      try { const parsed = JSON.parse(json); if (Object.keys(parsed.mcpServers ?? {}).length > 1) return setError('切回表单时 JSON 只能描述一台 MCP 服务器'); } catch { return setError('JSON 格式错误'); }
    }
    setTab(next);
  };
  return (
    <Overlay>
      <Dialog title={editing ? '编辑 MCP 服务器' : '添加 MCP 服务器'} width={560} onClose={onClose} footer={<><button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={save} className={primaryButton}>保存</button></>}>
        <div className="mb-4"><Segmented label="编辑方式" value={tab} onChange={switchTab} options={[{ value: 'form', label: '表单' }, { value: 'json', label: 'JSON' }]} /></div>
        {error && <p role="alert" className="mb-3 rounded-control bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>}
        {tab === 'json' ? (
          <>
            <div className="mb-1.5 flex items-center text-[12px] font-medium">JSON 配置<button onClick={() => { try { setJson(JSON.stringify(JSON.parse(json), null, 2)); setError(''); } catch { setError('JSON 格式错误'); } }} className="ml-auto font-normal text-primary">格式化</button></div>
            <textarea value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} aria-label="JSON 配置" className="h-52 w-full rounded-control border border-border bg-code p-3 font-mono text-[12px] leading-5 outline-none" />
            <p className="mt-1.5 text-[11px] text-muted">可粘贴单台配置，或 Cursor / Claude Desktop 的 mcpServers JSON</p>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[12px] font-medium">名称<input value={name} onChange={(e) => setName(e.target.value)} disabled={Boolean(editing)} className={`${inputClass} mt-1.5 font-normal`} /></label>
              <label className="text-[12px] font-medium">传输方式<select value={transport} onChange={(e) => setTransport(e.target.value as 'stdio' | 'http')} className={`${inputClass} mt-1.5 font-normal`}><option value="stdio">stdio</option><option value="http">HTTP</option></select></label>
            </div>
            <label className="mt-3 block text-[12px] font-medium">描述（可选）<input placeholder="一句话告诉模型这个服务器的用途" className={`${inputClass} mt-1.5 font-normal`} /></label>
            {transport === 'stdio' ? (
              <>
                <label className="mt-3 block text-[12px] font-medium">命令<input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" className={`${inputClass} mt-1.5 font-mono font-normal`} /></label>
                <label className="mt-3 block text-[12px] font-medium">参数（每行一条）<textarea defaultValue={'-y\n@modelcontextprotocol/server-filesystem\n~/Documents'} className="mt-1.5 h-16 w-full rounded-control border border-border bg-input p-2 font-mono text-[12px] font-normal outline-none" /></label>
                <label className="mt-3 block text-[12px] font-medium">环境变量（KEY=VALUE，每行一条）<textarea defaultValue="LOG_LEVEL=warn" className="mt-1.5 h-12 w-full rounded-control border border-border bg-input p-2 font-mono text-[12px] font-normal outline-none" /></label>
              </>
            ) : (
              <>
                <label className="mt-3 block text-[12px] font-medium">URL<input defaultValue={editing ? 'https://api.githubcopilot.com/mcp/' : ''} placeholder="https://" className={`${inputClass} mt-1.5 font-mono font-normal`} /></label>
                <label className="mt-3 block text-[12px] font-medium">OAuth 客户端名称（可选）<input placeholder="用于只接受已知 OAuth 客户端的服务器" className={`${inputClass} mt-1.5 font-normal`} /></label>
                <label className="mt-3 block text-[12px] font-medium">OAuth 授权服务器元数据地址（可选）<input placeholder="服务器声明的授权服务器不对或没有声明时填写" className={`${inputClass} mt-1.5 font-normal`} /></label>
              </>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-[12px] font-medium">连接超时（秒）<input type="number" defaultValue={30} className={`${inputClass} mt-1.5 font-normal`} /></label>
              <label className="text-[12px] font-medium">工具调用超时（秒）<input type="number" defaultValue={120} className={`${inputClass} mt-1.5 font-normal`} /></label>
            </div>
          </>
        )}
      </Dialog>
    </Overlay>
  );
}

/** McpSettings：列表、状态、授权、加载方式、工具列表、启停、编辑、删除 */
export function McpPage({ dialog = '', empty = false }: { dialog?: '' | 'add' | 'edit'; empty?: boolean }) {
  const [list, setList] = useState(empty ? [] : servers);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string>(dialog === 'edit' ? 'github' : dialog === 'add' ? 'new' : '');
  const [importing, setImporting] = useState(false);
  const [remove, setRemove] = useState('');
  const [open, setOpen] = useState('github');
  const shown = list.filter((s) => !query || s.name.includes(query));
  return (
    <>
      <SettingsHeader title="MCP 服务器" description={`已启用 ${list.filter((s) => s.on).length}/${list.length} · 应用可用的 MCP 服务器`} actions={<><button onClick={() => setImporting(true)} className={outlineButton}>从本地应用导入</button><button onClick={() => setEditing('new')} className={primaryButton}><span className="icon-[lucide--plus] size-3.5" />添加 MCP</button></>} />
      {list.length ? (
        <>
          <FilterBar placeholder="筛选 MCP..." value={query} onChange={setQuery} />
          {shown.length ? (
            <div className="divide-y divide-line rounded-control border border-line">
              {shown.map((s) => {
                const [dot, text, tone] = statusView(s);
                return (
                  <div key={s.name}>
                    <div className="group flex items-center gap-3 px-3 py-2.5">
                      <button onClick={() => setOpen(open === s.name ? '' : s.name)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <span className={`${open === s.name ? 'icon-[lucide--chevron-down]' : 'icon-[lucide--chevron-right]'} size-3.5 shrink-0 text-faint`} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 text-[13px] font-medium">{s.name}<Badge><span className="font-mono">{s.transport}</span></Badge></span>
                          <span className={`mt-0.5 flex items-center gap-1.5 text-[12px] ${tone}`}>{dot}{text}<span className="text-faint">· {s.desc}</span></span>
                        </span>
                      </button>
                      {s.status === 'unauth' && <button className={`${primaryButton} h-7`}>授权</button>}
                      {(s.status === 'ok' || s.status === 'authed') && s.transport === 'http' && <button className="text-[12px] text-muted hover:text-surface-foreground">取消授权</button>}
                      {s.status === 'failed' && <button className="text-[12px] text-primary">重试</button>}
                      <button onClick={() => setEditing(s.name)} aria-label="编辑" title="编辑" className="flex size-7 items-center justify-center rounded-control text-muted opacity-0 hover:bg-hover group-hover:opacity-100"><span className="icon-[lucide--pencil] size-3.5" /></button>
                      <button onClick={() => setRemove(s.name)} aria-label="删除" title="删除" className="flex size-7 items-center justify-center rounded-control text-muted opacity-0 hover:bg-hover hover:text-danger group-hover:opacity-100"><span className="icon-[lucide--trash-2] size-3.5" /></button>
                      <Switch label={s.name} checked={s.on} onChange={(on) => setList(list.map((x) => x.name === s.name ? { ...x, on } : x))} />
                    </div>
                    {open === s.name && (
                      <div className="border-t border-line bg-panel/50 px-9 py-2.5 text-[12px]">
                        <div className="mb-2 flex items-center gap-3">
                          <span className="text-muted">加载方式</span>
                          <Segmented size="sm" label="加载方式" value={s.mode} onChange={(mode) => setList(list.map((x) => x.name === s.name ? { ...x, mode } : x))} options={[{ value: 'resident', label: '常驻' }, { value: 'lazy', label: '按需' }]} />
                        </div>
                        {s.mode === 'lazy' && <p className="mb-2 leading-5 text-muted">按需：不预先把工具说明放进上下文，模型用到时经 mcp 工具连接；适合工具多、不常用的 server。新会话生效。</p>}
                        {s.status === 'ok' ? (
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                            {['create_issue', 'create_pull_request', 'get_file_contents', 'list_commits', 'search_code', 'merge_pull_request'].map((tool, i) => <div key={tool} className="flex items-center justify-between"><span className="font-mono">{tool}</span><span className="tabular-nums text-faint">≈{[420, 610, 280, 230, 350, 300][i]} tokens</span></div>)}
                            <p className="col-span-2 mt-1 text-faint">还有 20 个工具</p>
                          </div>
                        ) : s.status === 'failed' ? (
                          <pre className="overflow-auto rounded-[4px] bg-code p-2 font-mono text-[11px] text-danger">Error: spawn psql ENOENT{'\n'}    at ChildProcess._handle.onexit</pre>
                        ) : <p className="text-muted">连接成功后显示工具列表与 Token 估算。</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : <p className="py-8 text-center text-[12px] text-muted">无匹配结果</p>}
        </>
      ) : (
        <div className="rounded-control border border-dashed border-border"><Empty icon="icon-[lucide--plug]" title="暂无 MCP 服务器" description="从本地应用导入或手动添加 MCP 服务器以开始使用" action={<button onClick={() => setEditing('new')} className={outlineButton}>添加 MCP</button>} /></div>
      )}
      {editing && <McpDialog editing={editing === 'new' ? undefined : editing} onClose={() => setEditing('')} />}
      {importing && <ImportDialog kind="MCP" onClose={() => setImporting(false)} />}
      {remove && <Overlay><DangerConfirm title={`删除「${remove}」？`} description="将从应用中移除这台 MCP 服务器，已打开的会话在下次启动后不再加载。" confirmLabel="删除" requireCheck={false} onClose={() => setRemove('')} onConfirm={() => { setList(list.filter((s) => s.name !== remove)); setRemove(''); }} /></Overlay>}
    </>
  );
}

const instructions = [
  { name: 'CLAUDE.md', source: 'Claude Code · ~/.claude/CLAUDE.md', link: true, on: true },
  { name: '团队约定', source: '本地副本', link: false, on: false },
  { name: 'AGENTS.md', source: 'Codex · ~/.codex/AGENTS.md', link: true, on: false },
];

/** InstructionsSettings + InstructionEditDialog：同一时间仅一份生效；链接（覆盖原文件）/ 本地副本 */
export function InstructionsPage() {
  const [list, setList] = useState(instructions);
  const [editing, setEditing] = useState<'' | 'new' | string>('');
  const [importing, setImporting] = useState(false);
  const [remove, setRemove] = useState('');
  const [saveMode, setSaveMode] = useState<'overwrite' | 'copy'>('overwrite');
  const target = list.find((i) => i.name === editing);
  return (
    <>
      <SettingsHeader title="指令文件" description="本机 AI 工具的全局 CLAUDE.md / AGENTS.md 类文件" actions={<><button onClick={() => setImporting(true)} className={outlineButton}>从本地应用导入</button><button onClick={() => setEditing('new')} className={primaryButton}><span className="icon-[lucide--plus] size-3.5" />添加指令</button></>} />
      <InlineNotice>同一时间仅一份生效（注入会话）；启用一份会自动关闭其余</InlineNotice>
      <div className="divide-y divide-line rounded-control border border-line">
        {list.map((item) => (
          <div key={item.name} className="group flex items-center gap-3 px-3 py-2.5">
            <span className="icon-[lucide--file-text] size-4 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13px] font-medium">{item.name}<Badge tone={item.link ? 'primary' : 'neutral'}>{item.link ? '链接' : '本地副本'}</Badge>{item.on && <Badge tone="success">生效中</Badge>}</p>
              <p className="truncate font-mono text-[11px] text-muted">{item.source}</p>
            </div>
            <button onClick={() => setEditing(item.name)} aria-label="编辑" className="flex size-7 items-center justify-center rounded-control text-muted opacity-0 hover:bg-hover group-hover:opacity-100"><span className="icon-[lucide--pencil] size-3.5" /></button>
            <button onClick={() => setRemove(item.name)} aria-label="删除" className="flex size-7 items-center justify-center rounded-control text-muted opacity-0 hover:bg-hover hover:text-danger group-hover:opacity-100"><span className="icon-[lucide--trash-2] size-3.5" /></button>
            <Switch label={item.name} checked={item.on} onChange={(on) => setList(list.map((x) => ({ ...x, on: x.name === item.name ? on : on ? false : x.on })))} />
          </div>
        ))}
      </div>
      {editing && (
        <Overlay>
          <Dialog title={editing === 'new' ? '添加指令文件' : '编辑指令文件'} width={600} onClose={() => setEditing('')} footer={<><button onClick={() => setEditing('')} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={() => setEditing('')} className={primaryButton}>{target?.link ? (saveMode === 'overwrite' ? '覆盖原文件' : '保存为本地副本') : '保存'}</button></>}>
            <label className="block text-[12px] font-medium">名称<input defaultValue={target?.name ?? ''} className={`${inputClass} mt-1.5 font-normal`} /></label>
            {target?.link && (
              <div className="mt-3 space-y-1.5 text-[12px]">
                <label className="flex items-start gap-2"><input type="radio" checked={saveMode === 'overwrite'} onChange={() => setSaveMode('overwrite')} className="mt-0.5" /><span><span className="font-medium">直接修改原文件</span><span className="block text-muted">保存会直接覆盖 ~/.claude/CLAUDE.md —— Claude Code 会随之生效。</span></span></label>
                <label className="flex items-start gap-2"><input type="radio" checked={saveMode === 'copy'} onChange={() => setSaveMode('copy')} className="mt-0.5" /><span><span className="font-medium">保存为本地副本</span><span className="block text-muted">保存后会复制一份到应用内 —— ~/.claude/CLAUDE.md 不会被改动,此条目也将不再跟随其更新。</span></span></label>
              </div>
            )}
            {target && !target.link && <p className="mt-2 text-[12px] text-muted">本地副本 —— 修改只保存在应用内。</p>}
            <label className="mt-3 block text-[12px] font-medium">内容<textarea defaultValue={'# 开发约定\n\n- 变更范围保持最小。\n- 提交前运行 pnpm typecheck && pnpm lint && pnpm test。'} className="mt-1.5 h-48 w-full rounded-control border border-border bg-code p-3 font-mono text-[12px] font-normal leading-5 outline-none" /></label>
          </Dialog>
        </Overlay>
      )}
      {importing && <ImportDialog kind="指令文件" onClose={() => setImporting(false)} />}
      {remove && <Overlay><DangerConfirm title={`删除「${remove}」？`} description="只移除此条目；链接条目的原文件不会被删除。" confirmLabel="删除" requireCheck={false} onClose={() => setRemove('')} onConfirm={() => { setList(list.filter((x) => x.name !== remove)); setRemove(''); }} /></Overlay>}
    </>
  );
}
