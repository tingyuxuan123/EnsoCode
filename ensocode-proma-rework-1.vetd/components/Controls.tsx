import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

export function Dialog({ title, description, onClose, children, footer, width = 600 }: { title: string; description?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab' && ref.current) {
        const controls = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-foreground/15 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} style={{ width }} className="flex max-h-[90%] max-w-full flex-col overflow-hidden rounded-control border border-border bg-surface outline-none">
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold">{title}</h2>
            {description && <p className="mt-1 text-[12px] leading-5 text-muted">{description}</p>}
          </div>
          <button onClick={onClose} title="关闭对话框" aria-label="关闭对话框" className="flex size-6 shrink-0 items-center justify-center rounded-control text-muted hover:bg-hover">
            <span className="icon-[lucide--x] size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-2 block text-[12px] font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11px] leading-5 text-muted">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`flex h-[18px] w-8 shrink-0 items-center rounded-full px-[3px] ${checked ? 'justify-end bg-primary' : 'justify-start bg-border'}`}>
      <span className="size-3 rounded-full bg-white" />
    </button>
  );
}

export function ToggleRow({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-4 border-t border-line py-3">
      <div className="flex-1">
        <p className="text-[13px]">{label}</p>
        {description && <p className="mt-1 text-[11px] leading-5 text-muted">{description}</p>}
      </div>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: { value: T; options: { value: T; label: string; icon?: string }[]; onChange: (value: T) => void; label: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex items-center rounded-control bg-control/55 p-[3px] ${size === 'sm' ? 'h-7' : 'h-8'}`}>
      {options.map((option) => (
        <button key={option.value} role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)} className={`flex h-full items-center gap-1.5 whitespace-nowrap rounded-[4px] px-2.5 text-[12px] ${value === option.value ? 'bg-surface font-medium text-surface-foreground' : 'text-muted hover:text-surface-foreground'}`}>
          {option.icon && <span className={`${option.icon} size-3.5`} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function StateBar({ text, onClear }: { text: string; onClear: () => void }) {
  if (!text) return null;
  return (
    <div role="status" className="mb-4 flex items-center gap-2 rounded-control bg-panel px-3 py-2 text-[12px] text-muted">
      <span className="icon-[lucide--info] size-3.5 shrink-0 text-primary" />
      <span className="flex-1">{text}</span>
      <button aria-label="关闭状态提示" onClick={onClear}><span className="icon-[lucide--x] size-3" /></button>
    </div>
  );
}

export function DangerConfirm({ title, description, onClose, onConfirm, confirmLabel = '确认操作', requireCheck = true }: { title: string; description: string; onClose: () => void; onConfirm: () => void; confirmLabel?: string; requireCheck?: boolean }) {
  const [confirmed, setConfirmed] = useState(!requireCheck);
  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button>
          <button disabled={!confirmed} onClick={onConfirm} className="rounded-control bg-danger px-4 py-2 text-[12px] text-white">{confirmLabel}</button>
        </>
      }
    >
      {requireCheck && (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          我了解本操作的影响
        </label>
      )}
      <p className="mt-3 text-[11px] text-muted">设计预览仅修改示例数据，不执行真实删除。</p>
    </Dialog>
  );
}

/** 点外部 / Esc 收起；返回挂到弹层根节点上的 ref */
export function useDismiss<T extends HTMLElement>(open: boolean, onClose: () => void): RefObject<T | null> {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    const down = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) closeRef.current(); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', down);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', down); };
  }, [open]);
  return ref;
}

/** 浮层菜单面板（弹出层可加阴影：浮在内容之上） */
export function MenuPanel({ children, className = '', label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div role="menu" aria-label={label} className={`absolute z-40 rounded-control border border-border bg-surface p-1 shadow-[0_8px_24px_rgba(20,40,60,0.12)] ${className}`}>
      {children}
    </div>
  );
}

export function MenuItem({ icon, label, hint, onClick, danger, checked, disabled, trailing }: { icon?: string; label: string; hint?: string; onClick?: () => void; danger?: boolean; checked?: boolean; disabled?: boolean; trailing?: ReactNode }) {
  return (
    <button role="menuitem" disabled={disabled} onClick={onClick} className={`flex w-full items-start gap-2 rounded-[4px] px-2 py-1.5 text-left text-[13px] hover:bg-hover disabled:hover:bg-transparent ${danger ? 'text-danger' : ''}`}>
      {icon && <span className={`${icon} mt-0.5 size-3.5 shrink-0 ${danger ? '' : 'text-muted'}`} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && <span className="block text-[11px] leading-4 text-muted">{hint}</span>}
      </span>
      {trailing}
      {checked && <span className="icon-[lucide--check] mt-0.5 size-3.5 shrink-0 text-primary" />}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-1.5 text-[11px] text-faint">{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded border border-border px-1 text-[11px] text-muted">{children}</span>;
}

export function Empty({ icon, title, description, action }: { icon: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <span className={`${icon} size-6 text-faint`} />
      <p className="mt-3 text-[13px] font-medium">{title}</p>
      {description && <p className="mt-1 max-w-[320px] text-[12px] leading-5 text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className = 'size-3.5' }: { className?: string }) {
  return <span className={`icon-[lucide--loader-circle] vetd-spin ${className}`} />;
}

/** 会话状态点：运行中 / 等待你处理 / 失败 / 未读 / 空闲（conversationDotTone） */
export function StatusDot({ tone, size = 'md' }: { tone: 'running' | 'waiting' | 'failed' | 'unread' | 'idle' | 'attention'; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'size-[6px]' : 'size-[7px]';
  if (tone === 'running') return <span className={`icon-[lucide--loader-circle] vetd-spin shrink-0 text-primary ${size === 'sm' ? 'size-3' : 'size-3.5'}`} aria-label="运行中" />;
  const color = tone === 'waiting' ? 'bg-warning' : tone === 'failed' || tone === 'attention' ? 'bg-danger' : tone === 'unread' ? 'bg-primary' : 'bg-transparent';
  return <span aria-label={tone} className={`${box} shrink-0 rounded-full ${color}`} />;
}

export const inputClass = 'h-9 w-full rounded-control border border-border bg-input px-3 text-[13px] outline-none focus:border-primary/60';
export const buttonClass = 'rounded-control bg-surface-foreground px-4 py-2 text-[12px] text-surface disabled:bg-control disabled:text-muted';
export const ghostButton = 'rounded-control border border-border px-3 py-1.5 text-[12px] hover:bg-hover';
