import { ChevronRight, PlusCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { usePhoneBack } from './usePhoneBack';

/** 会话菜单：一个会话只有一个入口，放会话级动作。 */
export interface ConversationMenuItem {
  key: string;
  label: string;
  hint: string;
  disabled?: boolean;
  onSelect(): void;
}

export function ConversationMenu({
  open,
  title,
  aside,
  items,
  onClose,
  footer,
}: {
  open: boolean;
  title: string;
  aside?: ReactNode;
  items: ConversationMenuItem[];
  onClose(): void;
  footer?: ReactNode;
}) {
  usePhoneBack(open, onClose, 40);
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        aria-label="关闭菜单"
        onClick={onClose}
        className="absolute inset-0 z-40 bg-ink/35"
      />
      <section
        aria-label={title}
        className="absolute inset-x-0 bottom-0 z-50 rounded-t-[28px] bg-page pb-safe shadow-[0_-12px_40px_rgb(0_0_0/0.18)]"
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <span className="h-1 w-9 rounded-full bg-faint/60" />
        </div>
        <header className="flex items-center gap-3 px-5 pt-2 pb-3">
          <h2 className="min-w-0 flex-1 text-[17px] leading-[22px] font-semibold">{title}</h2>
          {aside}
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-faint"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>
        <div className="px-5">
          {items.map((item, index) => {
            return (
              <button
                key={item.key}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  item.onSelect();
                }}
                className={cnMenuRow(index, item.disabled)}
              >
                <span className={cnIcon(item.disabled)}>
                  <PlusCircle className="size-[18px]" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[15px] leading-5 font-medium ${
                      item.disabled ? 'text-faint' : ''
                    }`}
                  >
                    {item.label}
                  </span>
                  <span className="block truncate text-[12px] leading-4 text-dim">{item.hint}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
              </button>
            );
          })}
        </div>
        <div className="px-5 pt-2 pb-2">
          {footer ?? (
            <button
              type="button"
              onClick={onClose}
              className="h-12 w-full rounded-full bg-card2 text-[15px] font-medium text-ink2"
            >
              取消
            </button>
          )}
        </div>
      </section>
    </>
  );
}

function cnMenuRow(index: number, disabled?: boolean) {
  return [
    'flex w-full items-center gap-3 py-3 text-left',
    index > 0 ? 'border-line/60 border-t' : '',
    disabled ? 'opacity-50' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function cnIcon(disabled?: boolean) {
  return [
    'flex w-6 shrink-0 items-center justify-center',
    disabled ? 'text-faint' : 'text-ink',
  ].join(' ');
}
