import { useState } from 'react';
import { Dialog, Switch } from '../../Controls';
import { Badge, InlineNotice, ListRow, SettingsHeader, SettingsList, SettingsRow, SettingsSection, outlineButton, primaryButton } from '../SettingsUI';
import { CheckList, ModelSelect, Select, demoMcp, demoSkills } from './shared';

/** 子代理类型（AgentTypesSettings）：Enso 锁定 / general 固定、内置启停与覆盖、自定义、coworker 上限、slug/描述/系统提示、选模模式 */
type AgentType = { id: string; name: string; builtin: boolean; locked?: boolean; desc: string; model: string; tools: 'all' | 'readonly'; enabled: boolean; custom?: boolean };
const initial: AgentType[] = [
  { id: 'enso', name: 'Enso', builtin: true, locked: true, desc: '继承当前对话模型，并提供产品能力', model: '继承当前对话模型', tools: 'all', enabled: true },
  { id: 'general', name: 'general', builtin: true, desc: '跟随会话模型,全部工具', model: '跟随会话模型', tools: 'all', enabled: true },
  { id: 'scout', name: 'scout', builtin: true, desc: '快速只读调研,返回压缩结论', model: '由主 Agent 选择', tools: 'readonly', enabled: true },
  { id: 'reviewer', name: 'reviewer', builtin: true, desc: '代码审查：行为回归、安全边界、缺失测试', model: '由主 Agent 选择', tools: 'readonly', enabled: true },
  { id: 'tester', name: 'tester', builtin: true, desc: '补充单元测试并运行验证', model: '由主 Agent 选择', tools: 'all', enabled: false },
  { id: 'designer', name: 'designer', builtin: false, custom: true, desc: '界面实现：按设计规范落地页面与组件', model: 'Claude Sonnet 4.5', tools: 'all', enabled: true },
];

export function AgentTypesPage() {
  const [list, setList] = useState(initial);
  const [edit, setEdit] = useState<AgentType | null>(null);
  const [maxCoworkers, setMaxCoworkers] = useState('4');
  const subagentModels = false;
  return (
    <>
      <SettingsHeader title="子代理类型" description="自定义子代理预设：系统提示、模型与工具集，主 agent 经 agent_type 参数选用。" actions={<button className={primaryButton} onClick={() => setEdit({ id: 'new', name: '', builtin: false, desc: '', model: '必须由主 Agent 选择', tools: 'readonly', enabled: true, custom: true })}>新建类型</button>} />
      {!subagentModels && <InlineNotice tone="warning">未在【模型中心】中配置【允许子代理指定模型】。设为【必须由主 Agent 选择】的子代理类型将暂时回退为跟随会话。</InlineNotice>}
      <SettingsSection title="同时在编 coworker 上限" description="单个会话最多同时保留多少个 coworker。调低上限不会解散现有成员，雇新的前需先解雇。subagent 不计入。">
        <SettingsRow label="上限">
          <Select label="同时在编上限" value={maxCoworkers} onChange={setMaxCoworkers} options={['1', '2', '3', '4', '6', '8']} width="w-24" />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="内置与自定义" actions={<button className={outlineButton}><span className="icon-[lucide--sparkles] size-3.5" />AI 自动配置</button>}>
        <SettingsList>
          {list.map((agent) => (
            <ListRow
              key={agent.id}
              icon={<span className={`${agent.locked ? 'icon-[lucide--lock] text-faint' : agent.builtin ? 'icon-[lucide--bot] text-muted' : 'icon-[lucide--pencil-line] text-primary'} size-4`} />}
              title={<>
                <span className="font-medium">{agent.name}</span>
                {agent.locked && <Badge>系统 · 已锁定</Badge>}
                {agent.builtin && !agent.locked && <Badge>内置</Badge>}
                {agent.custom && <Badge tone="primary">自定义</Badge>}
                {agent.custom && list.some((item) => item.builtin && item.name === agent.name) && <Badge tone="warning">覆盖内置</Badge>}
              </>}
              meta={<span className="block truncate">{agent.desc}</span>}
              onClick={agent.locked ? undefined : () => setEdit(agent)}
            >
              <span className="hidden shrink-0 text-[11px] text-muted sm:block">{agent.model}</span>
              <Switch label={`${agent.name} 启用`} checked={agent.enabled} disabled={agent.locked} onChange={(value) => setList(list.map((item) => item.id === agent.id ? { ...item, enabled: value } : item))} />
              <button className="shrink-0 rounded-control px-2 py-1 text-[11px] text-muted hover:bg-hover" onClick={() => setEdit(agent)} disabled={agent.locked}>编辑</button>
            </ListRow>
          ))}
        </SettingsList>
        <p className="mt-2 text-[11px] leading-5 text-muted">同名自定义类型会覆盖内置类型；Enso 为系统保留名称，不可改名或删除。改动对新会话生效。</p>
      </SettingsSection>
      {edit && <AgentEditor agent={edit} onClose={() => setEdit(null)} onSave={(next) => { setList(next ? [...list.filter((item) => item.id !== next.id), next] : list); setEdit(null); }} />}
    </>
  );
}

function AgentEditor({ agent, onClose, onSave }: { agent: AgentType; onClose: () => void; onSave: (next: AgentType | null) => void }) {
  const [name, setName] = useState(agent.name);
  const [desc, setDesc] = useState(agent.desc);
  const [prompt, setPrompt] = useState(agent.builtin ? '你是快速调研代理,只探索不修改…' : '');
  const [mode, setMode] = useState<'pick' | 'follow' | 'fixed'>(agent.model === '必须由主 Agent 选择' ? 'pick' : agent.model === '跟随会话模型' ? 'follow' : 'fixed');
  const [tools, setTools] = useState<'all' | 'readonly'>(agent.tools);
  const [skills, setSkills] = useState<string[]>(['frontend-design']);
  const [mcp, setMcp] = useState<string[]>(['browser-tools']);
  const [thinking, setThinking] = useState('中');
  const reserved = name === 'enso';
  return (
    <Dialog
      title={agent.custom || !agent.builtin ? '编辑类型' : `覆盖内置 ${agent.name}`}
      description="自定义子代理预设：系统提示、模型与工具集，主 agent 经 agent_type 参数选用。"
      width={640}
      onClose={onClose}
      footer={<><button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button><button disabled={!name.trim() || reserved} onClick={() => onSave({ ...agent, name, desc, model: mode === 'pick' ? '必须由主 Agent 选择' : mode === 'follow' ? '跟随会话模型' : 'Claude Sonnet 4.5', tools, enabled: true, builtin: false, custom: true })} className={primaryButton}>保存</button></>}
    >
      <div className="grid grid-cols-2 gap-x-4">
        <label className="mb-3 block text-[12px]">
          <span className="mb-1 block font-medium">名称(slug)</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className={`h-9 w-full rounded-control border bg-input px-2.5 text-[13px] outline-none ${reserved ? 'border-danger/60' : 'border-border'}`} />
          {reserved && <span className="mt-1 block text-[11px] text-danger">此 Agent 名称为系统保留名称</span>}
        </label>
        <label className="mb-3 block text-[12px]">
          <span className="mb-1 block font-medium">描述(帮助主 agent 选型)</span>
          <input value={desc} onChange={(event) => setDesc(event.target.value)} placeholder="快速只读调研,返回压缩结论" className="h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] outline-none" />
        </label>
      </div>
      <label className="mb-3 block text-[12px]">
        <span className="mb-1 block font-medium">系统提示</span>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} placeholder="你是快速调研代理,只探索不修改…" className="block w-full resize-none rounded-control border border-border bg-input p-2.5 font-mono text-[12px] leading-5 outline-none" />
      </label>
      <div className="mb-3">
        <p className="mb-1.5 text-[12px] font-medium">模型选择</p>
        <div className="grid grid-cols-3 gap-2 text-[12px]">
          {([['pick', '必须由主 Agent 选择'], ['follow', '跟随会话'], ['fixed', '自选固定模型']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)} className={`rounded-control border px-2.5 py-2 text-left ${mode === id ? 'border-primary/50 bg-primary-soft/40 font-medium' : 'border-border text-muted hover:bg-hover'}`}>{label}</button>
          ))}
        </div>
        {mode === 'fixed' && <div className="mt-2 flex items-center gap-2"><ModelSelect label="模型" value="Claude Sonnet 4.5" onChange={() => undefined} unavailable /></div>}
        <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">思考档位
          <SegmentedThinking value={thinking} onChange={setThinking} />
        </div>
      </div>
      <SettingsRow label="工具集" description={tools === 'all' ? '全部工具(bash/edit/write)' : '只读(read/grep/find/ls + 绑定的 MCP)'}>
        <Select label="工具集" value={tools === 'all' ? '全部工具' : '只读'} onChange={(value) => setTools(value === '全部工具' ? 'all' : 'readonly')} options={['全部工具', '只读']} />
      </SettingsRow>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-1.5 text-[12px] font-medium">技能</p>
          <CheckList items={demoSkills} selected={skills} onChange={setSkills} filter emptyText="暂无技能" filterPlaceholder="筛选技能..." />
        </div>
        <div>
          <p className="mb-1.5 text-[12px] font-medium">MCP 服务器</p>
          <CheckList items={demoMcp} selected={mcp} onChange={setMcp} filter emptyText="暂无 MCP 服务器" filterPlaceholder="筛选 MCP..." />
        </div>
      </div>
    </Dialog>
  );
}

function SegmentedThinking({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex h-7 items-center rounded-control bg-control/55 p-[2px] text-[11px]">
      {['关', '低', '中', '高'].map((level) => (
        <button key={level} onClick={() => onChange(level)} className={`h-full rounded-[4px] px-2 ${value === level ? 'bg-surface font-medium' : 'text-muted'}`}>{level}</button>
      ))}
    </div>
  );
}
