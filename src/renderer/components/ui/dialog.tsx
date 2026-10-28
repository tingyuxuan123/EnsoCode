'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OverlayGuardHost } from '@/hooks/useOverlayGuard';
import { useTrafficLightsGuard } from '@/hooks/useTrafficLightsGuard';
import { cn } from '@/lib/utils';
import { Z_INDEX } from '@/lib/z-index';

// Traffic lights guard is driven by the controlled `open` prop.
// Uncontrolled Dialogs (without `open`) will not trigger the guard.
function Dialog(props: DialogPrimitive.Root.Props) {
  useTrafficLightsGuard(props.open ?? false);
  return <DialogPrimitive.Root {...props} />;
}

const DialogPortal = DialogPrimitive.Portal;

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogBackdrop({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        // 优化动画：150ms，使用 ease-out 实现快速响应
        // z-index 由 DialogPopup 通过 style prop 统一控制
        'fixed inset-0 no-drag bg-foreground/15 transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0',
        className
      )}
      data-slot="dialog-backdrop"
      data-enso-float=""
      {...props}
    />
  );
}

function DialogViewport({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        // z-index 由 DialogPopup 通过 style prop 统一控制
        'fixed inset-0 grid grid-rows-[1fr_auto_1fr] justify-items-center p-[24px] pointer-events-none',
        className
      )}
      data-slot="dialog-viewport"
      {...props}
    />
  );
}

function DialogPopup({
  className,
  children,
  showCloseButton = true,
  bottomStickOnMobile = true,
  disableNestedTransform = false,
  showBackdrop = true,
  zIndexLevel = 'base',
  style,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  bottomStickOnMobile?: boolean;
  disableNestedTransform?: boolean;
  showBackdrop?: boolean;
  zIndexLevel?: 'base' | 'nested';
}) {
  const mergedStyle = disableNestedTransform
    ? ({ ...(style ?? {}), '--nested-dialogs': 0 } as React.CSSProperties)
    : style;

  const contentZIndex =
    zIndexLevel === 'base' ? Z_INDEX.MODAL_CONTENT : Z_INDEX.NESTED_MODAL_CONTENT;
  const backdropZIndex =
    zIndexLevel === 'base' ? Z_INDEX.MODAL_BACKDROP : Z_INDEX.NESTED_MODAL_BACKDROP;

  return (
    <DialogPortal>
      <OverlayGuardHost />
      {showBackdrop && <DialogBackdrop style={{ zIndex: backdropZIndex }} />}
      <DialogViewport
        className={cn(bottomStickOnMobile && 'max-sm:grid-rows-[1fr_auto] max-sm:pt-12')}
        style={{ zIndex: contentZIndex }}
      >
        <DialogPrimitive.Popup
          className={cn(
            // 优化动画：150ms，使用模拟 Spring 的 cubic-bezier 曲线
            '-translate-y-[calc(1.25rem*var(--nested-dialogs))] no-drag pointer-events-auto relative row-start-2 flex max-h-full min-h-0 w-full min-w-0 max-w-[600px] scale-[calc(1-0.1*var(--nested-dialogs))] flex-col rounded-[6px] border border-border bg-popover text-popover-foreground opacity-[calc(1-0.1*var(--nested-dialogs))] transition-[scale,opacity,translate] duration-150 ease-out will-change-transform data-nested:data-ending-style:translate-y-8 data-nested:data-starting-style:translate-y-8 data-nested-dialog-open:origin-top data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0',
            bottomStickOnMobile &&
              'max-sm:rounded-none max-sm:border-x-0 max-sm:border-t max-sm:border-b-0 max-sm:opacity-[calc(1-min(var(--nested-dialogs),1))] max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4 max-sm:before:hidden max-sm:before:rounded-none',
            className
          )}
          style={mergedStyle}
          data-slot="dialog-popup"
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute end-[16px] top-[12px] z-50 flex size-[calc(24rem/14)] cursor-pointer items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <XIcon className="h-4 w-4" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col gap-[4px] border-b border-line px-[20px] py-[16px] pr-[48px]',
        className
      )}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogFooter({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'default' | 'bare';
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col-reverse gap-[12px] px-[20px] sm:flex-row sm:justify-end sm:rounded-b-[5px]',
        variant === 'default' && 'border-t border-line py-[12px]',
        variant === 'bare' &&
          'in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pt-3 pt-4 pb-6',
        className
      )}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn('font-semibold text-[calc(16rem/14)] leading-[calc(24rem/14)]', className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn(
        'text-muted-foreground text-[calc(12rem/14)] leading-[calc(20rem/14)]',
        className
      )}
      data-slot="dialog-description"
      {...props}
    />
  );
}

const DIALOG_PANEL_CLASS =
  'px-[20px] py-[16px] in-[[data-slot=dialog-popup]:not(:has([data-slot=dialog-footer].border-t))]:pb-[20px]';

/**
 * 对话框正文区。
 *
 * bare：已经处在另一个滚动区里时用（例如向导里按步骤嵌的页），只出排版不出
 * ScrollArea——滚动容器不能套娃，内层那个即使没有溢出也会把滚轮吃掉。
 */
function DialogPanel({
  className,
  bare = false,
  ...props
}: React.ComponentProps<'div'> & { bare?: boolean }) {
  const content = (
    <div className={cn(DIALOG_PANEL_CLASS, className)} data-slot="dialog-panel" {...props} />
  );
  if (bare) return content;
  // flex-1 + 去掉 h-full：面板高度由对话框剩余空间决定，而不是被内容撑开
  return <ScrollArea className="!h-auto min-h-0 flex-1">{content}</ScrollArea>;
}

export {
  Dialog,
  DialogBackdrop,
  DialogBackdrop as DialogOverlay,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogPopup as DialogContent,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
};
