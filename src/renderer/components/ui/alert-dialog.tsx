'use client';

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';

import { OverlayGuardHost } from '@/hooks/useOverlayGuard';
import { useTrafficLightsGuard } from '@/hooks/useTrafficLightsGuard';
import { cn } from '@/lib/utils';
import { Z_INDEX } from '@/lib/z-index';

// Traffic lights guard is driven by the controlled `open` prop.
// Uncontrolled AlertDialogs (without `open`) will not trigger the guard.
function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
  useTrafficLightsGuard(props.open ?? false);
  return <AlertDialogPrimitive.Root {...props} />;
}

const AlertDialogPortal = AlertDialogPrimitive.Portal;

function AlertDialogTrigger(props: AlertDialogPrimitive.Trigger.Props) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogBackdrop({ className, style, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      className={cn(
        'fixed inset-0 bg-foreground/15 transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0',
        className
      )}
      style={style}
      data-slot="alert-dialog-backdrop"
      {...props}
    />
  );
}

function AlertDialogViewport({ className, style, ...props }: AlertDialogPrimitive.Viewport.Props) {
  return (
    <AlertDialogPrimitive.Viewport
      className={cn(
        'fixed inset-0 grid grid-rows-[1fr_auto] justify-items-center pt-6 sm:grid-rows-[1fr_auto_1fr] sm:p-[24px]',
        className
      )}
      style={style}
      data-slot="alert-dialog-viewport"
      {...props}
    />
  );
}

function AlertDialogPopup({
  className,
  showBackdrop = true,
  zIndexLevel = 'base',
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  showBackdrop?: boolean;
  zIndexLevel?: 'base' | 'nested';
}) {
  const backdropZIndex =
    zIndexLevel === 'nested' ? Z_INDEX.NESTED_MODAL_BACKDROP : Z_INDEX.MODAL_BACKDROP;
  const contentZIndex =
    zIndexLevel === 'nested' ? Z_INDEX.NESTED_MODAL_CONTENT : Z_INDEX.MODAL_CONTENT;

  return (
    <AlertDialogPortal>
      <OverlayGuardHost />
      {showBackdrop && <AlertDialogBackdrop style={{ zIndex: backdropZIndex }} />}
      <AlertDialogViewport style={{ zIndex: contentZIndex }}>
        <AlertDialogPrimitive.Popup
          className={cn(
            'sm:-translate-y-[calc(1.25rem*var(--nested-dialogs))] relative row-start-2 grid max-h-full w-full min-w-0 border-t border-border bg-popover text-popover-foreground opacity-[calc(1-0.1*var(--nested-dialogs))] transition-[scale,opacity,translate] duration-200 ease-out will-change-transform data-nested-dialog-open:origin-top data-ending-style:opacity-0 data-starting-style:opacity-0 max-sm:opacity-[calc(1-min(var(--nested-dialogs),1))] max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4 sm:max-w-[440px] sm:data-nested:data-ending-style:translate-y-8 sm:data-nested:data-starting-style:translate-y-8 sm:scale-[calc(1-0.1*var(--nested-dialogs))] sm:rounded-[6px] sm:border sm:data-ending-style:scale-98 sm:data-starting-style:scale-98',
            className
          )}
          data-slot="alert-dialog-popup"
          {...props}
        />
      </AlertDialogViewport>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-[8px] px-[20px] py-[16px] text-center sm:text-left',
        className
      )}
      data-slot="alert-dialog-header"
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'default' | 'bare';
}) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-[12px] px-[20px] sm:flex-row sm:justify-end sm:rounded-b-[5px]',
        variant === 'default' && 'border-t border-line py-[12px]',
        variant === 'bare' && 'pt-4 pb-6',
        className
      )}
      data-slot="alert-dialog-footer"
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      className={cn('font-semibold text-[calc(16rem/14)] leading-[calc(24rem/14)]', className)}
      data-slot="alert-dialog-title"
      {...props}
    />
  );
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      className={cn(
        'text-muted-foreground text-[calc(12rem/14)] leading-[calc(20rem/14)]',
        className
      )}
      data-slot="alert-dialog-description"
      {...props}
    />
  );
}

function AlertDialogClose(props: AlertDialogPrimitive.Close.Props) {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />;
}

export {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogBackdrop as AlertDialogOverlay,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogPopup as AlertDialogContent,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogViewport,
};
