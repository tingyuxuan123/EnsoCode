import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Dialog({ title, description, onClose, children, footer }: { title: string; description?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
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
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[90%] w-[600px] max-w-full flex-col overflow-hidden rounded-control border border-border bg-surface outline-none">
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1"><h2 className="text-[16px] font-semibold">{title}</h2>{description && <p className="mt-1 text-[12px] leading-5 text-muted">{description}</p>}</div>
          <button onClick={onClose} title="关闭对话框" aria-label="关闭对话框" className="flex size-6 shrink-0 items-center justify-center rounded-control text-muted hover:bg-hover"><span className="icon-[lucide--x] size-4" /></button>
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
export function ToggleRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center gap-4 border-t border-line py-3">
      <div className="flex-1"><p className="text-[13px]">{label}</p>{description && <p className="mt-1 text-[11px] leading-5 text-muted">{description}</p>}</div>
      <button role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className={`flex h-[18px] w-8 shrink-0 items-center rounded-full px-[3px] ${checked ? 'justify-end bg-surface-foreground' : 'justify-start bg-border'}`}><span className="size-3 rounded-full bg-surface" /></button>
    </div>
  );
}
export function StateBar({ text, onClear }: { text: string; onClear: () => void }) {
  if (!text) return null;
  return <div role="status" className="mb-4 flex items-center gap-2 rounded-control bg-panel px-3 py-2 text-[12px] text-muted"><span className="icon-[lucide--info] size-3.5 shrink-0 text-primary" /><span className="flex-1">{text}</span><button aria-label="关闭状态提示" onClick={onClear}><span className="icon-[lucide--x] size-3" /></button></div>;
}
export function DangerConfirm({ title, description, onClose, onConfirm }: { title: string; description: string; onClose: () => void; onConfirm: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return <Dialog title={title} description={description} onClose={onClose} footer={<><button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button><button disabled={!confirmed} onClick={onConfirm} className="rounded-control bg-danger px-4 py-2 text-[12px] text-white">确认操作</button></>}><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我了解本操作的影响</label><p className="mt-3 text-[11px] text-muted">设计预览仅修改示例数据，不执行真实删除。</p></Dialog>;
}
export const inputClass = 'h-9 w-full rounded-control border border-border bg-input px-3 text-[13px] outline-none';
export const buttonClass = 'rounded-control bg-surface-foreground px-4 py-2 text-[12px] text-surface disabled:bg-control disabled:text-muted';
