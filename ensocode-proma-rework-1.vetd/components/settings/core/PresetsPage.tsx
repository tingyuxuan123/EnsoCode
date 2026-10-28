import { useState } from 'react';
import { Dialog, Spinner, Switch } from '../../Controls';
import { Overlay } from '../../Workbench';
import { Badge, InlineNotice, outlineButton, primaryButton, SettingsHeader, SettingsSection } from '../SettingsUI';
import { CheckList, demoInstructions, demoMcp, demoSkills, NewSessionBadge, Select } from './shared';

const DEFAULT_ROLE = 'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.';

type Preset = { id: string; name: string; skills: string[]; mcp: string[]; instruction: string; role: string; isDefault?: boolean };
const SEED: Preset[] = [
  { id: 'reviewer', name: '代码审查', skills: ['project-knowledge', 'pdf'], mcp: ['github'], instruction: '~/.codex/AGENTS.md', role: '你是一名谨慎的代码审查者，优先指出行为回归与安全边界问题。' },
  { id: 'frontend', name: '前端重构', skills: ['frontend-design', 'project-knowledge', 'enso-cdp', 'pdf'], mcp: ['github', 'playwright'], instruction: '~/.claude/CLAUDE.md', role: '', isDefault: true },
];

/** 编辑预设（PresetsSettings 内的编辑弹窗） */
export function PresetEditor({ preset, onClose, onSave }: { preset?: Preset; onClose: () => void; onSave: (preset: Preset) => void }) {
  const [name, setName] = useState(preset?.name ?? '');
  const [replaceRole, setReplaceRole] = useState(Boolean(preset?.role));
  const [role, setRole] = useState(preset?.role ?? '');
  const [skills, setSkills] = useState(preset?.skills ?? []);
  const [mcp, setMcp] = useState(preset?.mcp ?? []);
  const [instruction, setInstruction] = useState(preset?.instruction ?? '不注入');
  const [state, setState] = useState<'' | 'saving' | 'error' | 'load-error'>('');
  const roleEmpty = replaceRole && !role.trim();
  const save = () => {
    if (roleEmpty) return;
    setState('saving');
    window.setTimeout(() => {
      if (name.includes('失败')) { setState('error'); return; }
      onSave({ id: preset?.id ?? `p-${Date.now()}`, name: name.trim() || '未命名', skills, mcp, instruction, role: replaceRole ? role : '', isDefault: preset?.isDefault });
    }, 700);
  };
  return (
    <Overlay>
      <Dialog width={620} title={preset ? '编辑预设' : '新建预设'} onClose={onClose} footer={
        <>
          <span className="mr-auto"><NewSessionBadge text="新建及冷恢复的会话生效" /></span>
          <button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button>
          <button disabled={state === 'saving' || roleEmpty} onClick={save} className={primaryButton}>{state === 'saving' && <Spinner className="size-3" />}保存</button>
        </>
      }>
        {state === 'error' && <InlineNotice tone="danger" action={<button onClick={() => setState('')} className="text-[12px]">关闭</button>}>系统提示词保存失败：磁盘写入被拒绝。</InlineNotice>}
        <label className="mb-4 block"><span className="mb-1 block text-[12px] font-medium">名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="未命名" className="h-8 w-full rounded-control border border-border bg-input px-2 text-[13px] outline-none focus:border-primary/60" /></label>
        <div className="mb-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium">角色描述</p>
              <p className="text-[11px] leading-5 text-muted">替换 pi 开头的角色描述。仅替换开头的角色段落，Available tools 及之后的全部内容保持不变。</p>
            </div>
            <Switch label="替换 pi 开头的角色描述" checked={replaceRole} onChange={setReplaceRole} />
          </div>
          {replaceRole && (
            state === 'load-error' ? (
              <div className="mt-2 flex items-center gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger"><span className="icon-[lucide--circle-alert] size-3.5" />系统提示词读取失败<button onClick={() => setState('')} className="ml-auto">重试</button></div>
            ) : (
              <>
                <textarea value={role} onChange={(event) => setRole(event.target.value)} placeholder={DEFAULT_ROLE} aria-label="角色描述" className={`mt-2 h-24 w-full rounded-control border bg-input p-2.5 text-[12px] leading-5 outline-none ${roleEmpty ? 'border-danger/60' : 'border-border focus:border-primary/60'}`} />
                <div className="flex items-center gap-3 text-[11px]">
                  {roleEmpty && <span className="text-danger">系统提示词不能为空</span>}
                  <button onClick={() => setState('load-error')} className="ml-auto text-faint">（预览：读取失败）</button>
                </div>
              </>
            )
          )}
        </div>
        <p className="mb-1.5 text-[12px] font-medium">技能</p>
        <div className="mb-4"><CheckList items={demoSkills} selected={skills} onChange={setSkills} emptyText="暂无技能" filterPlaceholder="筛选技能..." /></div>
        <p className="mb-1.5 text-[12px] font-medium">MCP 服务器</p>
        <div className="mb-4"><CheckList items={demoMcp} selected={mcp} onChange={setMcp} emptyText="暂无 MCP 服务器" filterPlaceholder="筛选 MCP..." /></div>
        <p className="mb-1.5 text-[12px] font-medium">指令文件</p>
        <Select label="指令文件" value={instruction} onChange={setInstruction} width="w-full" options={demoInstructions} />
        {instruction !== '不注入' && <p className="mt-1 text-[11px] text-muted">来源 {instruction.includes('claude') ? 'Claude Code' : 'Codex'} · 本地副本 · 2.4 KB</p>}
      </Dialog>
    </Overlay>
  );
}

/** 预设（PresetsSettings）：全局（只读·默认）+ 自定义；设为默认；查看默认角色描述 */
export function PresetsPage({ open }: { open?: 'edit' | 'new' }) {
  const [presets, setPresets] = useState(SEED);
  const [editing, setEditing] = useState<Preset | 'new' | null>(open === 'edit' ? SEED[0] : open === 'new' ? 'new' : null);
  const [viewRole, setViewRole] = useState(false);
  const [loading, setLoading] = useState(false);
  const defaultId = presets.find((item) => item.isDefault)?.id ?? 'global';
  const setDefault = (id: string) => setPresets(presets.map((item) => ({ ...item, isDefault: item.id === id })));
  return (
    <div data-settings-row="presets.root">
      <SettingsHeader title="预设" description="角色描述 / 技能 / MCP / 指令文件的组合，按对话选用" actions={<button onClick={() => setEditing('new')} className={primaryButton}><span className="icon-[lucide--plus] size-3.5" />新建预设</button>} />
      <SettingsSection>
        <div className="divide-y divide-line rounded-control border border-line">
          <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
            <span className="icon-[lucide--globe] size-4 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13px] font-medium">全局<Badge>只读</Badge>{defaultId === 'global' && <Badge tone="primary">默认</Badge>}</p>
              <p className="mt-0.5 text-[12px] text-muted">跟随技能 / MCP / 指令文件页的启用开关</p>
            </div>
            <button onClick={() => setViewRole(true)} className="text-[12px] text-primary">查看默认角色描述</button>
            {defaultId !== 'global' && <button onClick={() => setDefault('global')} className={outlineButton}>设为默认</button>}
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-muted"><Spinner />加载中...</div>
          ) : presets.map((preset) => (
            <div key={preset.id} className="group flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-hover" onClick={() => setEditing(preset)}>
              <span className="icon-[lucide--layers] size-4 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[13px] font-medium">{preset.name}{preset.isDefault && <Badge tone="primary">默认</Badge>}{preset.role && <Badge>自定义角色</Badge>}</p>
                <p className="mt-0.5 text-[12px] text-muted">{preset.skills.length} 个技能 · {preset.mcp.length} 个 MCP · {preset.instruction === '不注入' ? 0 : 1} 份指令</p>
              </div>
              <span className="flex items-center gap-2 opacity-0 group-hover:opacity-100" onClick={(event) => event.stopPropagation()}>
                {!preset.isDefault && <button onClick={() => setDefault(preset.id)} className={outlineButton}>设为默认</button>}
                <button aria-label="编辑" onClick={() => setEditing(preset)} className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-control"><span className="icon-[lucide--pencil] size-3.5" /></button>
                <button aria-label="删除" onClick={() => setPresets(presets.filter((item) => item.id !== preset.id))} className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-control hover:text-danger"><span className="icon-[lucide--trash-2] size-3.5" /></button>
              </span>
            </div>
          ))}
        </div>
        <button onClick={() => setLoading(!loading)} className="mt-2 text-[11px] text-faint">（预览：{loading ? '已加载' : '加载中'}）</button>
      </SettingsSection>
      {editing && <PresetEditor preset={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSave={(next) => { setPresets(presets.some((item) => item.id === next.id) ? presets.map((item) => item.id === next.id ? next : item) : [...presets, next]); setEditing(null); }} />}
      {viewRole && (
        <Overlay>
          <Dialog width={560} title="内置默认（只读）" description="这是 pi 开头的角色段落。自定义预设只替换这段，工具、使用准则和项目上下文均保持不变。" onClose={() => setViewRole(false)} footer={<button onClick={() => setViewRole(false)} className={primaryButton}>关闭</button>}>
            <pre className="whitespace-pre-wrap rounded-control bg-code p-3 font-mono text-[12px] leading-5">{DEFAULT_ROLE}</pre>
          </Dialog>
        </Overlay>
      )}
    </div>
  );
}
