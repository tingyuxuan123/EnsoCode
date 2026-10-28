import type * as React from 'react';

import { cn } from '@/lib/utils';

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-[calc(22rem/14)] min-w-[22px] select-none items-center justify-center gap-1 rounded-[4px] border border-line bg-muted/50 px-[5px] font-medium font-sans text-muted-foreground text-[calc(11rem/14)] [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn('inline-flex items-center gap-1', className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
