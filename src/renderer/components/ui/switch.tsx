'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';

import { cn } from '@/lib/utils';

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'group/switch inline-flex h-[calc(18rem/14)] w-[calc(32rem/14)] shrink-0 items-center rounded-full px-[calc(3rem/14)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-border data-disabled:opacity-55',
        className
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-[calc(12rem/14)] shrink-0 rounded-full bg-primary-foreground transition-[translate] data-checked:translate-x-[calc(14rem/14)] data-unchecked:translate-x-0'
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
