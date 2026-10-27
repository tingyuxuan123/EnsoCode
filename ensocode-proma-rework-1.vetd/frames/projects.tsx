export const frame = { width: 1440, height: 900, title: "项目管理 · 设置与分组" };

import { useState } from 'react';
import { Link } from 'react-router';
import { buttonClass, DangerConfirm, Dialog, Field, inputClass, StateBar, ToggleRow } from '../components/Controls';
import { models } from '../components/data';

type ProjectRow = { id: string; name: string; path: string; group: string; ssh: boolean; count: number; pinned: boolean };
const initial: ProjectRow[] = [
  { id: 'enso', name: 'EnsoCode', path: '~/githubproject/EnsoCode', group: '日常开发', ssh: false, count: 3, pinned: true },
  { id: 'phone', name: 'phone-companion', path: '~/githubproject/phone-companion', group: '日常开发', ssh: false, count: 1, pinned: false },
  { id: 'design', name: 'design-system', path: '~/githubproject/design-system', group: '未分组', ssh: false, count: 0, pinned: false },
  { id: 'relay', name: 'relay-service', path: '/srv/relay-service', group: '远程服务', ssh: true, count: 0, pinned: false },
];
export default function ProjectsScreen() {
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState(['日常开发', '远程服务']);
  const [dialog, setDialog] = useState<'add' | 'settings' | 'group' | null>(null);
  const [selected, setSelected] = useState('enso');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [group, setGroup] = useState('未分组');
  const [ssh, setSsh] = useState(false);
  const [connection, setConnection] = useState('生产服务器');
  const [browse, setBrowse] = useState(false);
  const [model, setModel] = useState('继承全局默认');
  const [reasoning, setReasoning] = useState(true);
  const [thinking, setThinking] = useState('中');
  const [globalTools, setGlobalTools] = useState(true);
  const [tools, setTools] = useState(['读取文件', '编辑文件', '终端']);
  const [mode, setMode] = useState('继承全局');
  const [trust, setTrust] = useState(true);
  const [remove, setRemove] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const visible = rows.filter((row) => `${row.name} ${row.path} ${row.group}`.toLowerCase().includes(query.toLowerCase()));
  const open = (type: 'add' | 'settings' | 'group', row?: ProjectRow) => {
    setDialog(type); setError(''); setBrowse(false);
    setName(type === 'group' ? '' : row?.name ?? ''); setPath(row?.path ?? ''); setGroup(row?.group ?? '未分组'); setSsh(row?.ssh ?? false); setSelected(row?.id ?? 'enso');
  };
  const save = () => {
    if (!name.trim() || (dialog !== 'group' && !path.trim())) { setError('请填写名称和项目目录。'); return; }
    if (dialog === 'add' && rows.some((row) => row.path === path.trim())) { setError('该目录已在项目列表中，请选择其他目录。'); return; }
    if (dialog === 'group') {
      if (groups.includes(name.trim())) { setError('已有同名分组。'); return; }
      setGroups([...groups, name.trim()]);
    } else if (dialog === 'settings') setRows(rows.map((row) => row.id === selected ? { ...row, name, group } : row));
    else setRows([...rows, { id: `project-${rows.length}`, name, path, group, ssh, count: 0, pinned: false }]);
    setStatus(dialog === 'group' ? '分组已添加到预览。' : dialog === 'settings' ? '项目设置已保存到预览。' : '项目已添加到预览，未访问真实目录。'); setDialog(null);
  };
  return (
    <div className="relative flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-7 py-6">
        <div><h1 className="text-[22px] font-semibold">项目</h1><p className="mt-1 text-[12px] text-muted">组织工作目录、默认模型和项目级权限。</p></div>
        <button onClick={() => open('group')} className="ml-auto flex items-center gap-1.5 rounded-control border border-border px-3 py-2 text-[12px]"><span className="icon-[lucide--folder-plus] size-3.5" />新建分组</button>
        <button onClick={() => open('add')} className={buttonClass}>添加项目</button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-7 py-5">
        <StateBar text={status} onClear={() => setStatus('')} />
        <div className="mb-5 flex items-center gap-3"><label className="flex h-9 w-[320px] items-center gap-2 rounded-control bg-panel px-3"><span className="icon-[lucide--search] size-4 text-muted" /><input aria-label="搜索项目" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、分组或路径…" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" /></label><span className="ml-auto text-[12px] text-muted">{rows.length} 个项目 · {groups.length} 个分组</span></div>
        <table className="w-full table-fixed text-left text-[13px]">
          <thead className="text-[11px] text-muted"><tr><th className="w-[35%] pb-3 font-normal">项目与目录</th><th className="w-[19%] pb-3 font-normal">分组</th><th className="w-[16%] pb-3 font-normal">位置</th><th className="w-[12%] pb-3 text-right font-normal">会话</th><th className="w-[18%] pb-3 text-right font-normal">管理</th></tr></thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="py-4 pr-4">
                  <div className="flex items-center gap-2">
                    <span className="icon-[lucide--folder-open] size-4 text-muted" />
                    <Link to="/" className="font-medium hover:text-primary">{row.name}</Link>
                    {row.pinned && <span className="icon-[lucide--pin] size-3 text-faint" />}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted">{row.path}</p>
                </td>
                <td className="py-4 text-muted">{row.group}</td>
                <td className="py-4 text-muted">{row.ssh ? 'SSH 远程' : '本地项目'}</td>
                <td className="py-4 text-right tabular-nums text-muted">{row.count}</td>
                <td className="py-4">
                  <div className="flex justify-end gap-3">
                    <button onClick={() => open('settings', row)} className="text-[12px] text-primary">设置</button>
                    <button onClick={() => setRemove(row.id)} className="text-[12px] text-muted hover:text-danger">移除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <p className="py-14 text-center text-[13px] text-muted">没有匹配项目。清空搜索或添加新项目。</p>}
        <section className="mt-9 border-t border-line pt-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[14px] font-medium">项目分组</h2>
            <span className="text-[11px] text-muted">项目 → 分组 → 全局默认模型</span>
          </div>
          {groups.map((item) => (
            <div key={item} className="flex h-10 items-center gap-2 border-b border-line text-[12px]">
              <span className="icon-[lucide--folder] size-4 text-muted" />
              <span>{item}</span>
              <span className="ml-auto text-muted">{rows.filter((row) => row.group === item).length} 个项目</span>
              <button onClick={() => { setDialog('group'); setName(`${item} 副本`); setError(''); }} className="ml-3 text-primary">复制分组</button>
            </div>
          ))}
        </section>
        <p className="mt-5 text-[11px] text-muted">当前为设计预览，所有修改仅影响本页面的演示数据。</p>
      </div>
      {dialog && (
        <Dialog title={dialog === 'group' ? '新建项目分组' : dialog === 'settings' ? '项目设置' : '添加项目'} description={dialog === 'group' ? '分组用于组织侧栏项目，并提供继承的默认模型。' : dialog === 'settings' ? '项目设置优先于分组和全局设置。' : '选择本地工作目录，或从已有 SSH 连接中选择远程目录。'} onClose={() => setDialog(null)} footer={<><button onClick={() => setDialog(null)} className="px-3 py-2 text-[12px] text-muted">取消</button><button className={buttonClass} onClick={save}>{dialog === 'add' ? '添加项目' : '保存'}</button></>}>
          {error && <p role="alert" className="mb-4 rounded-control bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>}
          {dialog === 'add' && <div className="mb-5 flex h-9 gap-1 rounded-control bg-control/50 p-[3px]"><button onClick={() => setSsh(false)} className={`flex-1 rounded-[4px] text-[12px] ${!ssh ? 'bg-surface' : 'text-muted'}`}>本地项目</button><button onClick={() => setSsh(true)} className={`flex-1 rounded-[4px] text-[12px] ${ssh ? 'bg-surface' : 'text-muted'}`}>SSH 远程项目</button></div>}
          {ssh && dialog === 'add' && <Field label="SSH 连接"><select value={connection} onChange={(event) => setConnection(event.target.value)} className={inputClass}><option>生产服务器</option><option>开发服务器</option></select></Field>}
          <Field label={dialog === 'settings' ? '显示别名' : '名称'}><input aria-label="项目或分组名称" value={name} onChange={(event) => setName(event.target.value)} placeholder={dialog === 'group' ? '例如：日常开发' : '例如：EnsoCode'} className={inputClass} /></Field>
          {dialog !== 'group' && <Field label="项目目录" hint={dialog === 'settings' ? '目录由已添加项目确定，不在此处任意修改。' : ssh ? '预览远程目录，不会进行真实 SSH 连接。' : '可填入路径或从最近目录中选择。'}><div className="flex gap-2"><input aria-label="项目目录" value={path} readOnly={dialog === 'settings'} onChange={(event) => setPath(event.target.value)} placeholder={ssh ? '/srv/project' : '~/githubproject/project'} className={inputClass} />{dialog === 'add' && <button onClick={() => setBrowse(!browse)} className="shrink-0 rounded-control border border-border px-3 text-[12px]">浏览</button>}</div></Field>}
          {browse && (
            <div className="mb-4 rounded-control border border-line bg-panel p-3">
              <p className="mb-2 text-[11px] text-muted">{ssh ? `${connection} · 远程目录示例` : '最近使用的本地目录'}</p>
              {(ssh ? ['/srv/relay-service', '/srv/web', '/home/deploy'] : ['~/githubproject/EnsoCode', '~/githubproject/new-project', '~/Documents/workspace']).map((directory) => (
                <button key={directory} onClick={() => { setPath(directory); if (!name) setName(directory.split('/').at(-1) || '项目'); setBrowse(false); }} className="flex h-8 w-full items-center gap-2 px-2 text-left text-[12px] hover:bg-hover">
                  <span className="icon-[lucide--folder] size-3.5 text-muted" />
                  {directory}
                </button>
              ))}
            </div>
          )}
          {dialog !== 'group' && <Field label="所属分组"><select value={group} onChange={(event) => setGroup(event.target.value)} className={inputClass}><option>未分组</option>{groups.map((item) => <option key={item}>{item}</option>)}</select></Field>}
          {dialog !== 'add' && <><Field label="默认模型" hint="未覆盖时继承上一级设置。"><select value={model} onChange={(event) => setModel(event.target.value)} className={inputClass}><option>继承全局默认</option>{models.map((item) => <option key={item}>{item}</option>)}</select></Field>{model !== '继承全局默认' && <><ToggleRow label="启用推理" checked={reasoning} onChange={setReasoning} /><Field label="思考等级"><select className={inputClass} value={thinking} onChange={(event) => setThinking(event.target.value)}><option>低</option><option>中</option><option>高</option></select></Field></>}</>}
          {dialog === 'settings' && (
            <>
              <ToggleRow label="工具跟随全局设置" description="关闭后可限制该项目可用的内置工具。" checked={globalTools} onChange={setGlobalTools} />
              {!globalTools && (
                <div className="mb-4 flex flex-wrap gap-4 py-2">
                  {['读取文件', '编辑文件', '终端', '浏览器', '工作流', '记忆'].map((tool) => (
                    <label key={tool} className="flex items-center gap-1.5 text-[12px]">
                      <input type="checkbox" checked={tools.includes(tool)} onChange={(event) => setTools(event.target.checked ? [...tools, tool] : tools.filter((item) => item !== tool))} />
                      {tool}
                    </label>
                  ))}
                </div>
              )}
              <Field label="子 Agent 运行权限">
                <select className={inputClass} value={mode} onChange={(event) => setMode(event.target.value)}>
                  <option>继承全局</option><option>仅允许隔离沙箱</option><option>允许项目工作区</option>
                </select>
              </Field>
              <ToggleRow label="信任项目代码" description="撤销后，执行项目代码需要再次确认。" checked={trust} onChange={setTrust} />
            </>
          )}
          {dialog === 'group' && <p className="text-[11px] leading-5 text-muted">新建后可在项目设置中移入项目；颜色和批量选择将在下一轮状态补齐中完善。</p>}
        </Dialog>
      )}
      {remove && <DangerConfirm title="从工作台移除项目？" description="项目不再显示在列表中；不删除真实目录或源代码。设计预览仅移除示例行。" onClose={() => setRemove('')} onConfirm={() => { setRows(rows.filter((row) => row.id !== remove)); setRemove(''); setStatus('已从预览列表移除项目。'); }} />}
    </div>
  );
}
