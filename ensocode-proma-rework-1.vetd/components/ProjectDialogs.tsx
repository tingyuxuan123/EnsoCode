import { useState } from 'react';
import { Link } from 'react-router';
import { Dialog, Field, Spinner, Switch, inputClass } from './Controls';
import { groups, projects } from './data';
import { useWorkbench } from './Workbench';

const accentDots = ['bg-primary', 'bg-warning', 'bg-success', 'bg-danger', 'bg-muted', 'bg-surface-foreground'];

/**
 * 项目与会话相关弹窗（真实应用里都挂主窗口，不占用页面）：
 * 添加项目（本地 / SSH + 远程目录浏览 + 主机指纹）、项目设置、分组编辑、导入会话、已归档、移除确认。
 * 由 useWorkbench().projectDialog 驱动；侧栏的 + / 右键菜单 / 归档按钮都会打开这里。
 */
export function ProjectDialogs() {
  const { projectDialog, setProjectDialog, dialogProject, setNotice } = useWorkbench();
  const project = projects.find((item) => item.id === dialogProject);
  const group = groups.find((item) => item.id === dialogProject);
  const close = () => setProjectDialog(null);
  if (!projectDialog) return null;

  if (projectDialog === 'add') return <AddProjectDialog onClose={close} />;
  if (projectDialog === 'settings') return <ProjectSettingsDialog name={project?.name ?? ''} path={project?.local ? `~/githubproject/${project.name}` : `${project?.host}:/srv/${project?.name}`} onClose={close} />;
  if (projectDialog === 'group' || projectDialog === 'group-edit') return <GroupEditorDialog group={projectDialog === 'group-edit' ? group : undefined} onClose={close} />;
  if (projectDialog === 'import') return <ImportSessionDialog name={project?.name ?? ''} onClose={close} />;
  if (projectDialog === 'archive') return <ArchiveDialog onClose={close} />;
  return (
    <Dialog
      title="从工作台移除项目？"
      description={`「${project?.name ?? ''}」和它的 ${project?.sessions.length ?? 0} 个对话将从列表移除；不删除真实目录或源代码。`}
      width={440}
      onClose={close}
      footer={
        <>
          <button onClick={close} className="px-3 py-2 text-[12px] text-muted">取消</button>
          <button onClick={() => { close(); setNotice('已从列表移除（设计预览）。目录仍保留在磁盘上。'); }} className="rounded-control bg-danger px-4 py-2 text-[12px] text-white">移除</button>
        </>
      }
    >
      <p className="text-[12px] leading-5 text-muted">如果只是暂时不想看到它，可以改用「归档项目」，之后能从「已归档」恢复。</p>
    </Dialog>
  );
}

function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const { setNotice } = useWorkbench();
  const [kind, setKind] = useState<'local' | 'ssh'>('local');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [browse, setBrowse] = useState(false);
  const [conn, setConn] = useState('生产服务器');
  const [group, setGroup] = useState('日常开发');
  const [error, setError] = useState('');
  const recent = ['~/githubproject/EnsoCode', '~/githubproject/new-project', '~/Documents/workspace'];
  const remote = kind === 'ssh' ? ['/srv/relay-service', '/srv/web', '/home/deploy'] : recent;
  const submit = () => {
    if (!name.trim() || !path.trim()) { setError('请填写名称和项目目录。'); return; }
    if (projects.some((item) => (item.local ? `~/githubproject/${item.name}` : '') === path.trim())) { setError('该目录已在项目列表中，请选择其他目录。'); return; }
    onClose();
    setNotice(`已添加「${name}」（设计预览，未访问真实目录）。`);
  };
  return (
    <Dialog
      title="添加项目"
      description="把本地目录加为对话的工作目录，或从已有 SSH 连接里选一个远端目录。"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button>
          <button onClick={submit} className="rounded-control bg-surface-foreground px-4 py-2 text-[12px] text-surface">添加</button>
        </>
      }
    >
      {error && <p role="alert" className="mb-3 rounded-control bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>}
      <div className="mb-4 flex h-9 items-center rounded-control bg-control/50 p-[3px] text-[12px]">
        <button onClick={() => { setKind('local'); setPath(''); }} className={`h-full flex-1 rounded-[4px] ${kind === 'local' ? 'bg-surface font-medium' : 'text-muted'}`}>本地目录</button>
        <button onClick={() => { setKind('ssh'); setPath(''); }} className={`h-full flex-1 rounded-[4px] ${kind === 'ssh' ? 'bg-surface font-medium' : 'text-muted'}`}>远程（SSH）</button>
      </div>
      {kind === 'ssh' && (
        <Field label="SSH 连接" hint="请先在设置里添加 SSH 连接。工具在远端主机执行，聊天记录保存在本地。">
          <select value={conn} onChange={(event) => setConn(event.target.value)} className={inputClass}>
            <option>生产服务器</option>
            <option>开发服务器</option>
          </select>
        </Field>
      )}
      <Field label="名称">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：EnsoCode" aria-label="名称" className={inputClass} />
      </Field>
      <Field label={kind === 'ssh' ? '远端目录' : '工作目录'} hint={kind === 'ssh' ? '预览远端目录，不会进行真实 SSH 连接。' : '输入路径，或从最近项目中选择。'}>
        <div className="flex gap-2">
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder={kind === 'ssh' ? '/srv/project' : '~/githubproject/project'} aria-label="目录" className={inputClass} />
          <button onClick={() => setBrowse(!browse)} className="shrink-0 rounded-control border border-border px-3 text-[12px] hover:bg-hover">浏览</button>
        </div>
      </Field>
      {browse && (
        <div className="mb-4 rounded-control border border-line bg-panel/50">
          <div className="flex h-8 items-center gap-2 border-b border-line px-2 text-[11px] text-muted">
            {kind === 'ssh' ? <><span>{conn}</span><span className="text-border">·</span><span className="font-mono">/srv</span></> : <span className="truncate">最近使用</span>}
            {kind === 'ssh' && <button onClick={() => setNotice('远程目录列取失败。请检查连接或主机指纹。')} className="ml-auto text-[11px]">上级</button>}
          </div>
          {remote.map((directory) => (
            <button key={directory} onClick={() => { setPath(directory); if (!name) setName(directory.split('/').at(-1) || '项目'); setBrowse(false); }} className="flex h-8 w-full items-center gap-2 px-2 text-left text-[12px] hover:bg-hover">
              <span className="icon-[lucide--folder] size-3.5 text-muted" />
              <span className="min-w-0 flex-1 truncate font-mono">{directory}</span>
              <span className="text-[11px] text-primary">选择此目录</span>
            </button>
          ))}
          {kind === 'ssh' && <p className="px-2 py-1.5 text-[11px] text-faint">没有子目录 · <span className="text-muted">未知主机时会先要求信任主机指纹。</span></p>}
        </div>
      )}
      <Field label="项目组">
        <select value={group} onChange={(event) => setGroup(event.target.value)} className={inputClass}>
          <option>未分组</option>
          {groups.map((item) => <option key={item.id}>{item.name}</option>)}
        </select>
      </Field>
    </Dialog>
  );
}

function ProjectSettingsDialog({ name, path, onClose }: { name: string; path: string; onClose: () => void }) {
  const { setNotice } = useWorkbench();
  const [globalTools, setGlobalTools] = useState(true);
  const [agentMode, setAgentMode] = useState(true);
  const [trusted, setTrusted] = useState(true);
  const [tools, setTools] = useState(['读取文件', '编辑文件', '终端']);
  return (
    <Dialog
      title="项目设置"
      description="项目设置优先于分组，分组优先于全局默认。"
      width={600}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button>
          <button onClick={() => { onClose(); setNotice('项目设置已保存（设计预览）。'); }} className="rounded-control bg-surface-foreground px-4 py-2 text-[12px] text-surface">保存</button>
        </>
      }
    >
      <Field label="别名" hint="在侧边栏代替目录名显示，留空则恢复默认。">
        <input defaultValue={name} aria-label="别名" className={inputClass} />
      </Field>
      <Field label="路径">
        <div className="flex gap-2">
          <input readOnly value={path} aria-label="路径" className={inputClass} />
          <button className="shrink-0 rounded-control border border-border px-3 text-[12px] hover:bg-hover">打开文件夹</button>
        </div>
      </Field>
      <Field label="项目组">
        <select className={inputClass}><option>日常开发</option><option>未分组</option>{groups.map((item) => <option key={item.id}>{item.name}</option>)}</select>
      </Field>
      <Field label="默认模型" hint="跟随分组默认，再跟随全局默认。会话里手动选的模型优先于项目默认。">
        <div className="flex gap-2">
          <select className={inputClass}><option>跟随分组默认</option><option>Claude Sonnet 4.5</option><option>GPT-5 Codex</option></select>
          <select className={`${inputClass} w-32`}><option>思考档位：中</option><option>思考档位：高</option></select>
        </div>
      </Field>
      <div className="flex items-center gap-4 border-t border-line py-3">
        <div className="flex-1"><p className="text-[13px]">跟随全局内置工具</p><p className="mt-1 text-[11px] leading-5 text-muted">关闭后可为本项目单独配置内置工具，优先级高于全局，下次会话生效。</p></div>
        <Switch label="跟随全局内置工具" checked={globalTools} onChange={setGlobalTools} />
      </div>
      {!globalTools && (
        <div className="mb-3 flex flex-wrap gap-3">
          {['读取文件', '编辑文件', '终端', '浏览器', '工作流', '记忆', '电脑操控'].map((tool) => (
            <label key={tool} className="flex items-center gap-1.5 text-[12px]">
              <input type="checkbox" checked={tools.includes(tool)} onChange={(event) => setTools(event.target.checked ? [...tools, tool] : tools.filter((item) => item !== tool))} />
              {tool}
            </label>
          ))}
        </div>
      )}
      <div className="flex items-center gap-4 border-t border-line py-3">
        <div className="flex-1"><p className="text-[13px]">跟随全局统一 Agent 模式</p><p className="mt-1 text-[11px] leading-5 text-muted">关闭后，此项目使用自己明确配置的 Agent 模式权限掩码。统一 subagent 工具已关闭时，重新开启会保留此选择。</p></div>
        <Switch label="跟随全局统一 Agent 模式" checked={agentMode} onChange={setAgentMode} />
      </div>
      <div className="flex items-start gap-4 border-t border-line py-3">
        <div className="flex-1">
          <p className="text-[13px]">已信任的项目扩展</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">{trusted ? '保存后不再加载该项目里的 pi 扩展代码，从下一个会话开始生效。' : '该项目里的扩展代码会在你信任后才加载。'}</p>
        </div>
        <button onClick={() => setTrusted(!trusted)} className={`shrink-0 rounded-control border px-3 py-1 text-[12px] ${trusted ? 'border-danger/40 text-danger hover:bg-danger-soft' : 'border-border hover:bg-hover'}`}>{trusted ? '撤销信任' : '信任项目'}</button>
      </div>
    </Dialog>
  );
}

function GroupEditorDialog({ group, onClose }: { group?: { id: string; name: string; color: string }; onClose: () => void }) {
  const { setNotice } = useWorkbench();
  const [name, setName] = useState(group?.id === 'daily' ? '日常开发' : group?.id === 'remote' ? '远程服务' : '');
  const [color, setColor] = useState(0);
  const [q, setQ] = useState('');
  const [moved, setMoved] = useState<string[]>([]);
  return (
    <Dialog
      title={group ? '编辑分组' : '新建分组'}
      description="用分组整理侧栏里的项目；分组可以提供默认模型，项目没有单独设置时继承。"
      width={520}
      onClose={onClose}
      footer={
        <>
          {group && <button onClick={() => { onClose(); setNotice('删除分组：组内项目会移到「未分组」（设计预览）。'); }} className="mr-auto px-3 py-2 text-[12px] text-danger">删除分组</button>}
          <button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button>
          <button onClick={() => { onClose(); setNotice(group ? '分组已保存（设计预览）。' : '分组已新建（设计预览）。'); }} className="rounded-control bg-surface-foreground px-4 py-2 text-[12px] text-surface">保存</button>
        </>
      }
    >
      <Field label="名称">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：日常开发" aria-label="分组名称" className={inputClass} />
      </Field>
      <div className="mb-4">
        <p className="mb-2 text-[12px] font-medium">颜色</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setColor(-1)} className={`h-6 rounded-control border px-2 text-[11px] ${color === -1 ? 'border-primary text-surface-foreground' : 'border-border text-muted'}`}>无颜色</button>
          {accentDots.map((tone, index) => (
            <button key={tone} onClick={() => setColor(index)} aria-label={`颜色 ${index + 1}`} className={`size-6 rounded-full ${tone} ${color === index ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface' : ''}`} />
          ))}
        </div>
      </div>
      <Field label="分组默认模型" hint="用于本组的新对话；未设置时跟随全局默认。">
        <select className={inputClass}><option>跟随全局默认</option><option>Claude Sonnet 4.5</option><option>GPT-5 Codex</option></select>
      </Field>
      <div>
        <p className="mb-1.5 text-[12px] font-medium">选择要移入的项目</p>
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="筛选项目..." aria-label="筛选项目" className={`${inputClass} mb-1.5 h-8`} />
        <div className="max-h-40 divide-y divide-line overflow-y-auto rounded-control border border-line">
          {projects.filter((item) => !q || item.name.toLowerCase().includes(q.toLowerCase())).map((item) => (
            <label key={item.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
              <input type="checkbox" checked={moved.includes(item.id)} onChange={(event) => setMoved(event.target.checked ? [...moved, item.id] : moved.filter((id) => id !== item.id))} />
              <span className="icon-[lucide--folder] size-3.5 text-muted" />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="text-[11px] text-faint">{groups.find((g) => g.id === item.group)?.name ?? '未分组'}</span>
            </label>
          ))}
          {!projects.filter((item) => !q || item.name.toLowerCase().includes(q.toLowerCase())).length && <p className="px-3 py-4 text-center text-[12px] text-muted">没有匹配的项目</p>}
        </div>
      </div>
    </Dialog>
  );
}

function ImportSessionDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const { setNotice } = useWorkbench();
  const [picked, setPicked] = useState('');
  const list = [{ title: '重构工作台布局', count: 148, time: '昨天' }, { title: '排查侧栏滚动位置', count: 32, time: '3 天前' }, { title: '未命名', count: 6, time: '上周' }];
  return (
    <Dialog
      title="导入会话"
      description={`从本地 AI 应用导入 ${name} 项目下的对话历史；重复会话会跳过。`}
      width={560}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button>
          <button disabled={!picked} onClick={() => { onClose(); setNotice('已导入 1 个会话（设计预览）。'); }} className="rounded-control bg-surface-foreground px-4 py-2 text-[12px] text-surface disabled:opacity-50">导入</button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <div className="divide-y divide-line rounded-control border border-line">
          {list.map((item) => (
            <button key={item.title} onClick={() => setPicked(item.title)} className={`flex w-full items-start gap-2 px-2.5 py-2 text-left ${picked === item.title ? 'bg-selected' : 'hover:bg-hover'}`}>
              <span className="icon-[lucide--messages-square] mt-0.5 size-3.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px]">{item.title}</span>
                <span className="block text-[11px] text-faint">{item.count} 条消息 · {item.time}</span>
              </span>
            </button>
          ))}
          {!list.length && <p className="px-3 py-6 text-center text-[12px] text-muted">没有找到该项目的会话</p>}
        </div>
        <div className="rounded-control border border-dashed border-border px-3 py-3 text-[12px] leading-6">
          {picked ? (
            <>
              <p className="font-medium">{picked}</p>
              <p className="mt-1 text-muted">148 条消息 · 3 个工具调用 · 2 处文件改动</p>
              <p className="mt-2 text-[11px] text-faint">预览只显示结构，导入后可在会话里完整查看。</p>
            </>
          ) : <p className="text-muted">选择一个会话预览</p>}
        </div>
      </div>
    </Dialog>
  );
}

const archived = [
  { project: 'EnsoCode', items: ['重构前的临时会话', 'IDE 迁移记录', '旧版发布脚本', '排查导入失败'] },
  { project: 'phone-companion', items: ['配对验证'] },
  { project: 'design-system', items: ['色板初稿', '组件清单', '令牌整理'] },
];
const archivedProjects = ['旧官网', 'docs-site'];

function ArchiveDialog({ onClose }: { onClose: () => void }) {
  const { setNotice } = useWorkbench();
  const [q, setQ] = useState('');
  const [removed, setRemoved] = useState<string[]>([]);
  const [purge, setPurge] = useState(false);
  const total = archived.reduce((sum, group) => sum + group.items.length, 0) - removed.length;
  return (
    <Dialog
      title={`已归档 (${total})`}
      description="归档的会话不会删除；可以取消归档回到项目里，或彻底删除。"
      width={620}
      onClose={onClose}
      footer={<><span className="mr-auto text-[11px] text-muted">超过 30 天的归档会在下次启动时清理（可在通用设置里改）</span><button onClick={onClose} className="rounded-control bg-surface-foreground px-4 py-2 text-[12px] text-surface">完成</button></>}
    >
      <div className="mb-3 flex items-center gap-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-input px-2.5 text-muted">
          <span className="icon-[lucide--search] size-3.5" />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索会话..." aria-label="搜索归档会话" className="min-w-0 flex-1 bg-transparent text-[12px] text-surface-foreground outline-none" />
        </label>
        <button onClick={() => setPurge(true)} className="shrink-0 rounded-control border border-border px-2.5 py-1 text-[12px] text-muted hover:text-danger">清理已归档</button>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {archived.map((group) => {
          const items = group.items.filter((title) => (!q || title.includes(q)) && !removed.includes(`${group.project}/${title}`));
          if (!items.length) return null;
          return (
            <section key={group.project} className="mb-3">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
                <span className="icon-[lucide--folder] size-3.5" />
                {group.project}
                <span className="tabular-nums text-faint">{items.length}</span>
                <button onClick={() => setNotice(`已取消归档 ${group.project}（设计预览）。`)} className="ml-auto text-[11px] text-primary">取消归档项目</button>
              </div>
              {items.map((title) => (
                <div key={title} className="flex items-center gap-2 rounded-control px-2 py-1.5 text-[12px] hover:bg-hover">
                  <span className="icon-[lucide--archive] size-3.5 text-faint" />
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                  <button className="shrink-0 text-[11px] text-muted hover:text-surface-foreground">取消归档</button>
                  <button onClick={() => setRemoved([...removed, `${group.project}/${title}`])} className="shrink-0 text-[11px] text-muted hover:text-danger">删除</button>
                </div>
              ))}
            </section>
          );
        })}
        {!total && !archivedProjects.length && <p className="py-8 text-center text-[12px] text-muted">没有已归档的会话</p>}
        <section>
          <p className="mb-1 text-[11px] text-muted">已归档项目</p>
          {archivedProjects.map((name) => (
            <div key={name} className="flex items-center gap-2 rounded-control px-2 py-1.5 text-[12px] hover:bg-hover">
              <span className="icon-[lucide--folder-x] size-3.5 text-faint" />
              <span className="flex-1">{name}</span>
              <button className="text-[11px] text-primary">取消归档</button>
            </div>
          ))}
        </section>
      </div>
      {purge && (
        <div className="mt-3 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-[12px]">
          <p className="font-medium text-danger">删除全部已归档的 {total} 个会话？</p>
          <p className="mt-0.5 text-[11px] leading-5">对话记录、工具输出与隔离 worktree 会一起删除，无法恢复；当前打开与运行中的会话会跳过。</p>
          <div className="mt-1.5 flex justify-end gap-2">
            <button onClick={() => setPurge(false)} className="px-2 py-1 text-[11px] text-muted">取消</button>
            <Link to="/resources" onClick={onClose} className="rounded-control bg-danger px-2.5 py-1 text-[11px] text-white">删除全部</Link>
          </div>
        </div>
      )}
    </Dialog>
  );
}
