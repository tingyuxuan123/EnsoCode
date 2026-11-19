// The compact pane furniture the devices pane needs: a tool button in the head, the sheet around
// the pane, the head itself and a waiting state. These stand in for Kettu's shell components,
// which carry a different licence; they are drawn with CodeKiln's own tokens.

import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** A tool button in a pane's head: 24 px, its glyph muted until hovered or pressed. */
export function PanelButton({
  label,
  disabled,
  className,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={cn(
              'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-popup-open:bg-accent data-popup-open:text-foreground disabled:pointer-events-none disabled:opacity-45',
              className
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/** The pane's own head: its tabs on the left, its tools on the right. */
export function PaneHead({ tools, children }: { tools?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line/60 pr-1.5 pl-2">
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
      <div className="flex shrink-0 items-center gap-0.5">{tools}</div>
    </div>
  );
}

/** A pane's body, under its head: what the pane shows, filling the rest of it. */
export function PaneBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>{children}</div>;
}

/** The pane as a whole: a column of head and body, filling whatever room it is given. */
export function PaneSheet({
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { children: ReactNode }) {
  return (
    <div
      className={cn('flex size-full min-h-0 flex-col overflow-hidden bg-panel', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/** A pane's waiting state, in its middle. */
export function PaneSpinner() {
  return <LoaderCircle aria-hidden className="size-4 animate-spin text-muted-foreground" />;
}
