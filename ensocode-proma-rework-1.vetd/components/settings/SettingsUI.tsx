import type { ReactNode } from 'react';

/**
 * 设置页共用排版。所有设置页都用这些块，保证 21 个分类同一套节奏：
 * - SettingsHeader：页顶标题 + 一句说明 + 右侧主操作（对应 data-settings-row="<分类>.root"）
 * - SettingsSection：一组设置，组标题 + 可选说明，组与组之间用间距与一条细线分隔
 * - SettingsRow：左标签/说明，右控件；用于开关、下拉、数字
 * - SettingsList / ListRow：资源列表（技能、MCP、服务商……），行内状态 + 操作
 * - Badge：小状态标签（已启用 / 内置 / 未授权……）
 * - Notice：页内提示（需要新会话生效、权限不足、失败）
 */
export function SettingsHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-[18px] font-semibold">{title}</h1>
        {description && <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SettingsSection({ title, description, children, actions }: { title?: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mb-7 border-t border-line pt-5 first-of-type:border-t-0 first-of-type:pt-0">
      {(title || actions) && (
        <div className="mb-2 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-[14px] font-medium">{title}</h2>}
            {description && <p className="mt-0.5 text-[12px] leading-5 text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function SettingsRow({ label, description, children, stacked = false }: { label: string; description?: ReactNode; children?: ReactNode; stacked?: boolean }) {
  return (
    <div className={`flex gap-4 py-2.5 ${stacked ? 'flex-col' : 'items-center'}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px]">{label}</p>
        {description && <p className="mt-0.5 text-[12px] leading-5 text-muted">{description}</p>}
      </div>
      {children && <div className={stacked ? 'w-full' : 'flex shrink-0 items-center gap-2'}>{children}</div>}
    </div>
  );
}

export function SettingsList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line rounded-control border border-line">{children}</div>;
}

export function ListRow({ icon, title, meta, children, onClick, active }: { icon?: ReactNode; title: ReactNode; meta?: ReactNode; children?: ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <div onClick={onClick} className={`flex min-h-12 items-center gap-3 px-3 py-2.5 ${onClick ? 'cursor-pointer hover:bg-hover' : ''} ${active ? 'bg-selected' : ''}`}>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-[13px]">{title}</div>
        {meta && <div className="mt-0.5 truncate text-[12px] text-muted">{meta}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>{children}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }) {
  const color = { neutral: 'bg-control text-muted', primary: 'bg-primary-soft text-primary', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger' }[tone];
  return <span className={`inline-flex h-5 shrink-0 items-center rounded-[4px] px-1.5 text-[11px] ${color}`}>{children}</span>;
}

export function InlineNotice({ children, tone = 'info', action }: { children: ReactNode; tone?: 'info' | 'warning' | 'danger'; action?: ReactNode }) {
  const style = tone === 'danger' ? 'border-danger/30 bg-danger-soft text-danger' : tone === 'warning' ? 'border-warning/30 bg-warning-soft text-surface-foreground' : 'border-line bg-panel text-muted';
  const icon = tone === 'danger' ? 'icon-[lucide--circle-alert]' : tone === 'warning' ? 'icon-[lucide--triangle-alert] text-warning' : 'icon-[lucide--info] text-primary';
  return (
    <div className={`mb-4 flex items-start gap-2 rounded-control border px-3 py-2 text-[12px] leading-5 ${style}`}>
      <span className={`${icon} mt-0.5 size-3.5 shrink-0`} />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

export function FilterBar({ placeholder, value, onChange, children }: { placeholder: string; value: string; onChange: (value: string) => void; children?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-input px-2.5 text-muted focus-within:border-primary/60">
        <span className="icon-[lucide--search] size-3.5" />
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} className="min-w-0 flex-1 bg-transparent text-[12px] text-surface-foreground outline-none" />
      </label>
      {children}
    </div>
  );
}

export const primaryButton = 'inline-flex h-8 items-center gap-1.5 rounded-control bg-surface-foreground px-3 text-[12px] text-surface hover:opacity-90 disabled:bg-control disabled:text-muted';
export const outlineButton = 'inline-flex h-8 items-center gap-1.5 rounded-control border border-border bg-surface px-3 text-[12px] hover:bg-hover disabled:opacity-50';
export const selectClass = 'h-8 rounded-control border border-border bg-input px-2 text-[12px] outline-none focus:border-primary/60';
