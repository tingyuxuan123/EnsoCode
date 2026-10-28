import { Link } from 'react-router';
import { Switch } from '../../Controls';

/** 依赖内置工具才显示的分页（settingsCategories.ts TOOL_GATED）：页内开关只读，去「内置工具」关闭 */
export function ToolGate({ tool }: { tool: string }) {
  return (
    <div className="mb-6 flex items-center gap-3 rounded-control border border-line bg-panel px-3 py-2.5">
      <Switch label={`内置工具「${tool}」`} checked onChange={() => undefined} disabled />
      <div className="min-w-0 flex-1 text-[12px] leading-5">
        <p className="text-surface-foreground">已在「内置工具」中开启{tool}</p>
        <p className="text-muted">如需关闭，请到「内置工具」中操作。关闭后此分页会隐藏，入口落到「内置工具」。</p>
      </div>
      <Link to="/settings-tools" className="shrink-0 text-[12px] text-primary">前往内置工具</Link>
    </div>
  );
}

/** 页内二级页签（例如 设置 / 记忆库） */
export function SubTabs({ value, tabs }: { value: string; tabs: { id: string; label: string; to: string }[] }) {
  return (
    <div className="mb-6 flex h-9 items-end gap-5 border-b border-line">
      {tabs.map((tab) => (
        <Link key={tab.id} to={tab.to} className={`relative pb-2 text-[13px] ${value === tab.id ? 'font-medium text-surface-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:bg-primary' : 'text-muted hover:text-surface-foreground'}`}>
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

/** 列表行左侧的来源图标（纯图标，不放有色方块） */
export function RowIcon({ icon, tone = 'text-muted' }: { icon: string; tone?: string }) {
  return <span className={`${icon} size-4 shrink-0 ${tone}`} />;
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-3.5 accent-[var(--color-primary)]" />;
}
