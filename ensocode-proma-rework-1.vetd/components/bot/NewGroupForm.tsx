import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from './BotShell';
import { members, templates } from './data';
import { Segmented, Switch } from '../Controls';

/** 群聊与团队创建：成员（至少两位并指定群主）、共享/独立工作区、@ 接力上限、模板选择与成员能力覆盖 */
export function NewGroupForm({ initial = 'group' }: { initial?: 'group' | 'team' }) {
  const [mode, setMode] = useState<'group' | 'team'>(initial);
  const [selected, setSelected] = useState(['阿岚', '小满', '老周']);
  const [owner, setOwner] = useState('阿岚');
  const [shared, setShared] = useState(true);
  const [relay, setRelay] = useState('2');
  const [template, setTemplate] = useState(templates[0].id);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-6">
        <span className="icon-[lucide--users] size-4 text-muted" />
        <h1 className="text-[15px] font-medium">{mode === 'group' ? '新建群聊' : '从模板创建团队'}</h1>
        <span className="text-[12px] text-muted">{mode === 'group' ? '一次只有一位成员回复；没人被 @ 时智能选出最合适的成员回复。' : '模板预置成员、能力与共享工作区，可逐项覆盖。'}</span>
        <Link to="/bot" className="ml-auto text-[12px] text-muted hover:text-surface-foreground">取消</Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[820px]">
          <Segmented label="创建方式" value={mode} onChange={setMode} options={[{ value: 'group', label: '新建群聊' }, { value: 'team', label: '从模板创建团队' }]} />
          {mode === 'group' ? (
            <div className="mt-4 grid grid-cols-2 gap-5">
              <div>
                <label className="block text-[12px] text-muted">群名<input defaultValue="竞品周报" className="mt-1 h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] text-surface-foreground outline-none focus:border-primary/60" /></label>
                <p className="mt-4 text-[12px] text-muted">成员<span className="ml-1 text-faint">至少选两位，并指定一位群主</span></p>
                <div className="mt-1.5 divide-y divide-line rounded-control border border-line">
                  {members.map((member) => (
                    <label key={member.id} className="flex items-center gap-2 whitespace-nowrap px-2.5 py-2 text-[12.5px]">
                      <input type="checkbox" checked={selected.includes(member.name)} onChange={(event) => setSelected(event.target.checked ? [...selected, member.name] : selected.filter((name) => name !== member.name))} />
                      <Avatar member={member} size="sm" />
                      <span className="min-w-0 flex-1 truncate whitespace-nowrap">
                        {member.name}
                        <span className="ml-1.5 text-[11px] text-faint">{member.title}</span>
                      </span>
                      <button type="button" onClick={() => setOwner(member.name)} className={`shrink-0 whitespace-nowrap rounded-[4px] px-1.5 py-0.5 text-[11px] ${owner === member.name ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-hover'}`}>
                        {owner === member.name ? '群主' : '设为群主'}
                      </button>
                    </label>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-faint">请先创建至少两名成员。</p>
              </div>
              <div>
                <div className="rounded-control border border-line p-3">
                  <div className="flex items-center gap-2"><Switch label="共享工作区" checked={shared} onChange={setShared} /><span className="text-[12.5px] font-medium">共享工作区</span></div>
                  <div className="mt-2 flex gap-1">
                    <button onClick={() => setShared(true)} className={`flex-1 rounded-control border px-2 py-1.5 text-[12px] ${shared ? 'border-primary/50 bg-primary-soft/30' : 'border-line'}`}>基于 Code 项目</button>
                    <button onClick={() => setShared(false)} className={`flex-1 rounded-control border px-2 py-1.5 text-[12px] ${!shared ? 'border-primary/50 bg-primary-soft/30' : 'border-line'}`}>独立工作区</button>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-muted">{shared ? '成员直接在项目目录里读写。群内成员共享这个目录，能和任一成员对话的人，都能经由他触达目录里的内容。' : '为这个群新建一个空目录，删除群时一并清理。'}</p>
                  {shared && <select className="mt-2 h-8 w-full rounded-control border border-border bg-input px-2 text-[12px] text-surface-foreground"><option>EnsoCode · ~/githubproject/EnsoCode</option><option>phone-companion</option></select>}
                </div>
                <div className="mt-3 rounded-control border border-line p-3">
                  <p className="text-[12.5px] font-medium">@ 接力上限（你的每条消息之后）</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input value={relay} onChange={(event) => setRelay(event.target.value)} className="h-8 w-16 rounded-control border border-border bg-input px-2 text-[12px]" />
                    <span className="text-[11px] text-muted">每个成员最多回复几次</span>
                  </div>
                </div>
                <div className="mt-3 rounded-control border border-line p-3 text-[11.5px] leading-5">
                  <p className="font-medium">复制范围说明</p>
                  <p className="mt-1 text-muted">克隆群聊会复制成员、共享工作区设置与接力上限，不复制消息记录与成员记忆。</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {templates.map((item) => (
                <button key={item.id} onClick={() => setTemplate(item.id)} className={`w-full rounded-control border p-3 text-left ${template === item.id ? 'border-primary/50 bg-primary-soft/30' : 'border-line hover:bg-hover'}`}>
                  <div className="flex items-center gap-2"><span className="text-[13px] font-medium">{item.title}</span><span className="rounded-[4px] bg-control px-1.5 text-[10px] text-muted">{item.members} 名成员</span><span className="ml-auto text-[11px] text-faint">{item.id === templates[0].id ? '内置' : '自定义'}</span></div>
                  <p className="mt-1 text-[12px] text-muted">{item.desc}</p>
                  <div className="mt-1.5 flex gap-3">{members.slice(0, 3).map((member) => <span key={member.id} className="flex items-center gap-1 text-[11.5px]"><Avatar member={member} size="sm" />{member.name}<span className="text-faint">{member.title}</span></span>)}</div>
                </button>
              ))}
              <div className="rounded-control border border-line p-3">
                <p className="text-[12.5px] font-medium">成员能力覆盖</p>
                <p className="mt-1 text-[11px] text-muted">创建后可覆盖模板里的模型、工具与审批档位；共享工作区与群主在这里确认。</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11.5px]">
                  <label className="text-muted">群名<input defaultValue="竞品周报" className="mt-1 h-8 w-full rounded-control border border-border bg-input px-2 text-[12px] text-surface-foreground" /></label>
                  <label className="text-muted">群主<select className="mt-1 h-8 w-full rounded-control border border-border bg-input px-2 text-[12px] text-surface-foreground"><option>阿岚</option><option>小满</option></select></label>
                </div>
              </div>
              <p className="text-[11px] text-faint">团队需要 2–12 名成员；每个成员都需要合法的名字。</p>
            </div>
          )}
        </div>
      </div>
      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-line px-6">
        <span className="text-[11px] text-muted">{mode === 'group' ? `${selected.length} 名成员 · 群主 ${owner}` : `模板：${templates.find((item) => item.id === template)?.title}`}</span>
        <div className="ml-auto flex gap-2">
          <Link to="/bot" className="px-3 py-1.5 text-[12px] text-muted">取消</Link>
          <Link to="/bot-group" className="rounded-control bg-surface-foreground px-4 py-1.5 text-[12px] text-surface">{mode === 'group' ? '创建' : '创建团队'}</Link>
        </div>
      </div>
    </div>
  );
}
