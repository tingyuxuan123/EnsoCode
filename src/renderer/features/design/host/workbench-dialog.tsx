import type { ReactNode } from 'react';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { DesignRoot } from '../mounts/DesignRoot';

/** Full-bleed visual editor inside the host's modal/focus/traffic-light layers. */
export function DesignWorkbenchDialog({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="h-[85vh] max-w-[85vw]" bottomStickOnMobile={false}>
        <DesignRoot>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{subtitle}</DialogDescription>
          </DialogHeader>
          {children}
        </DesignRoot>
      </DialogPopup>
    </Dialog>
  );
}
export function DesignWorkbenchPanel({ children }: { children: ReactNode }) {
  return (
    <DialogPanel bare className="flex min-h-0 flex-1 px-0 py-0 pb-0!">
      {children}
    </DialogPanel>
  );
}
export function DesignWorkbenchFooter({ children }: { children: ReactNode }) {
  return <DialogFooter className="flex-row items-center gap-2">{children}</DialogFooter>;
}
