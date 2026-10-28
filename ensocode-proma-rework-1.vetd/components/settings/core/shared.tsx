import { useState, type ReactNode } from 'react';
import { MenuItem, MenuLabel, MenuPanel, MenuSeparator, Switch, useDismiss } from '../../Controls';
import { vendors, virtualModels } from '../../data';
import { selectClass } from '../SettingsUI';

/** 设置页里的「需新会话生效」小标签（NewSessionBadge） */
export function NewSessionBadge({ text = '新会话生效' }: { text?: string }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-[4px] bg-primary-soft px-1.5 text-[11px] text-primary">
      <span className="icon-[lucide--refresh-ccw] size-3" />
      {text}
    </span>
  );
}

/** 一行：标题 + 说明 + 右侧开关（GeneralSettings.SwitchRow） */
export function SwitchLine({ label, description, checked, onChange, disabled, badge }: { label: string; description?: ReactNode; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; badge?: ReactNode }) {
  return (
    <div className={`flex items-start gap-4 py-2.5 ${disabled ? 'opacity-55' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[13px]">
          {label}
          {badge}
        </p>
        {description && <p className="mt-0.5 text-[12px] leading-5 text-muted">{description}</p>}
      </div>
      <div className="pt-0.5">
        <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}

/** 原生下拉，统一外观 */
export function Select({ value, onChange, options, width = 'w-44', label, disabled }: { value: string; onChange: (value: string) => void; options: (string | [string, string])[]; width?: string; label: string; disabled?: boolean }) {
  return (
    <select aria-label={label} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className={`${selectClass} ${width} disabled:opacity-50`}>
      {options.map((option) => {
        const [v, l] = Array.isArray(option) ? option : [option, option];
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}

/** 设置里的模型下拉（DefaultModelPicker 同款，厂商分组 + 可选跟随项） */
export function ModelSelect({ value, onChange, emptyLabel, allowVirtual = true, width = 'w-64', label, unavailable }: { value: string; onChange: (value: string) => void; emptyLabel?: string; allowVirtual?: boolean; width?: string; label: string; unavailable?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className={`relative ${width}`}>
      <button aria-label={label} onClick={() => setOpen(!open)} className={`flex h-8 w-full items-center gap-2 rounded-control border bg-input px-2 text-left text-[12px] ${unavailable ? 'border-danger/50' : 'border-border'}`}>
        <span className={`${value ? 'icon-[lucide--sparkle] text-primary' : 'icon-[lucide--circle-dashed] text-faint'} size-3.5 shrink-0`} />
        <span className={`min-w-0 flex-1 truncate ${value ? '' : 'text-muted'} ${unavailable ? 'line-through' : ''}`}>{value || emptyLabel || '选择模型'}</span>
        <span className="icon-[lucide--chevrons-up-down] size-3 shrink-0 text-faint" />
      </button>
      {open && (
        <MenuPanel label={label} className="right-0 top-9 max-h-[280px] w-72 overflow-y-auto">
          {emptyLabel && <MenuItem label={emptyLabel} checked={!value} onClick={() => { onChange(''); setOpen(false); }} />}
          {allowVirtual && (
            <>
              <MenuLabel>虚拟模型</MenuLabel>
              {virtualModels.map((name) => <MenuItem key={name} icon="icon-[lucide--shuffle]" label={name} checked={value === name} onClick={() => { onChange(name); setOpen(false); }} />)}
              <MenuSeparator />
            </>
          )}
          {vendors.map((vendor) => (
            <div key={vendor.id}>
              <MenuLabel>{vendor.label}</MenuLabel>
              {vendor.entries.flatMap((entry) => entry.models.map((model) => (
                <MenuItem key={`${entry.id}/${model}`} label={model} hint={entry.primary} checked={value === model} onClick={() => { onChange(model); setOpen(false); }} />
              )))}
            </div>
          ))}
        </MenuPanel>
      )}
    </div>
  );
}

/** 多选列表：技能 / MCP 在预设与子代理类型里共用 */
export function CheckList({ items, selected, onChange, filter, emptyText, filterPlaceholder }: { items: { id: string; title: string; meta: string }[]; selected: string[]; onChange: (ids: string[]) => void; filter?: boolean; emptyText: string; filterPlaceholder: string }) {
  const [query, setQuery] = useState('');
  const shown = items.filter((item) => !query || `${item.title} ${item.meta}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="rounded-control border border-line">
      {filter !== false && (
        <label className="flex h-8 items-center gap-2 border-b border-line px-2.5 text-muted">
          <span className="icon-[lucide--search] size-3.5" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={filterPlaceholder} aria-label={filterPlaceholder} className="min-w-0 flex-1 bg-transparent text-[12px] text-surface-foreground outline-none" />
          <span className="text-[11px] tabular-nums">{selected.length}/{items.length}</span>
        </label>
      )}
      <div className="max-h-[132px] overflow-y-auto">
        {!items.length && <p className="px-3 py-4 text-center text-[12px] text-muted">{emptyText}</p>}
        {items.length > 0 && !shown.length && <p className="px-3 py-4 text-center text-[12px] text-muted">无匹配结果</p>}
        {shown.map((item) => (
          <label key={item.id} className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-hover">
            <input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => onChange(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />
            <span className="shrink-0 text-[12px] font-medium">{item.title}</span>
            <span className="min-w-0 truncate text-[11px] text-muted">{item.meta}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export const demoSkills = [
  { id: 'frontend-design', title: 'frontend-design', meta: '来源 Claude Code · 按设计规范实现前端界面' },
  { id: 'project-knowledge', title: 'project-knowledge', meta: '项目 .agents/skills · 项目约定与踩坑记录' },
  { id: 'enso-cdp', title: 'enso-cdp', meta: '项目 .agents/skills · 驱动 Electron 渲染进程' },
  { id: 'pdf', title: 'pdf', meta: '来源 Codex · 读写 PDF' },
];
export const demoMcp = [
  { id: 'github', title: 'github', meta: 'stdio · 26 个工具' },
  { id: 'linear', title: 'linear', meta: 'HTTP · OAuth · 12 个工具' },
  { id: 'playwright', title: 'playwright', meta: 'stdio · 按需加载' },
];
export const demoInstructions = ['不注入', '~/.claude/CLAUDE.md', '~/.codex/AGENTS.md'];

/** 键位显示：mod→⌘、shift→⇧ …（formatBinding） */
export function formatBinding(binding: string) {
  if (!binding) return '';
  const map: Record<string, string> = { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', enter: '↩', tab: 'Tab', space: 'Space', ',': ',', '.': '.' };
  return binding.split('+').map((part) => map[part] ?? part.toUpperCase()).join('');
}

/** 数字/滑条行：标签 + 滑条 + 百分比 */
export function SliderLine({ label, value, onChange, max = 100, unit = '%', disabled }: { label: string; value: number; onChange: (value: number) => void; max?: number; unit?: string; disabled?: boolean }) {
  return (
    <div className={`grid grid-cols-[120px_1fr_52px] items-center gap-3 py-1.5 ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-[13px]">{label}</span>
      <input type="range" min={0} max={max} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} className="accent-[var(--color-primary)]" />
      <span className="text-right text-[12px] tabular-nums text-muted">{value}{unit}</span>
    </div>
  );
}
