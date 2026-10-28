'use client';

import { Select as SelectPrimitive } from '@base-ui/react/select';
import { ChevronDownIcon, ChevronsUpDownIcon, ChevronUpIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Z_INDEX } from '@/lib/z-index';

const Select = SelectPrimitive.Root;

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: 'sm' | 'default' | 'lg';
}) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "relative inline-flex min-h-[calc(32rem/14)] w-full min-w-[112px] select-none items-center justify-between gap-[8px] rounded-[6px] border border-border bg-input/20 px-[10px] text-left text-[calc(12rem/14)] outline-none ring-ring/20 transition-shadow pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 focus-visible:border-ring focus-visible:ring-2 aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/16 data-disabled:pointer-events-none data-disabled:opacity-55 [&_svg:not([class*='size-'])]:size-[calc(14rem/14)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
        size === 'sm' && 'min-h-[calc(28rem/14)] gap-[6px] px-[8px]',
        size === 'lg' && 'min-h-[calc(36rem/14)]',
        className
      )}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon data-slot="select-icon">
        <ChevronsUpDownIcon className="size-[calc(14rem/14)] text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      className={cn('flex-1 truncate data-placeholder:text-muted-foreground', className)}
      data-slot="select-value"
      {...props}
    />
  );
}

function SelectPopup({
  className,
  children,
  sideOffset = 4,
  alignItemWithTrigger = true,
  zIndex,
  ...props
}: SelectPrimitive.Popup.Props & {
  sideOffset?: SelectPrimitive.Positioner.Props['sideOffset'];
  alignItemWithTrigger?: SelectPrimitive.Positioner.Props['alignItemWithTrigger'];
  zIndex?: number;
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        alignItemWithTrigger={alignItemWithTrigger}
        className="select-none"
        style={{ zIndex: zIndex ?? Z_INDEX.DROPDOWN }}
        data-slot="select-positioner"
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          className="origin-(--transform-origin) transition-[scale,opacity] has-data-[side=none]:scale-100 has-data-starting-style:scale-98 has-data-starting-style:opacity-0 has-data-[side=none]:transition-none"
          data-slot="select-popup"
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow
            className="top-0 z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:top-px before:h-[200%] before:rounded-t-[calc(var(--radius-lg)-1px)] before:bg-linear-to-b before:from-50% before:from-popover"
            data-slot="select-scroll-up-arrow"
          >
            <ChevronUpIcon className="relative size-4.5 sm:size-4" />
          </SelectPrimitive.ScrollUpArrow>
          <span className="relative block h-full rounded-[6px] border border-border bg-popover text-popover-foreground">
            <SelectPrimitive.List
              className={cn(
                'max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto p-1',
                className
              )}
              data-slot="select-list"
            >
              {children}
            </SelectPrimitive.List>
          </span>
          <SelectPrimitive.ScrollDownArrow
            className="bottom-0 z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:bottom-px before:h-[200%] before:rounded-b-[calc(var(--radius-lg)-1px)] before:bg-linear-to-t before:from-50% before:from-popover"
            data-slot="select-scroll-down-arrow"
          >
            <ChevronDownIcon className="relative size-4.5 sm:size-4" />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "grid min-h-[calc(28rem/14)] in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-default grid-cols-[1rem_1fr] items-center gap-[8px] rounded-[4px] py-[4px] ps-[8px] pe-[16px] text-[calc(12rem/14)] outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-55 [&_svg:not([class*='size-'])]:size-[calc(14rem/14)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="col-start-1">
        <svg
          aria-hidden="true"
          fill="none"
          height="24"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="24"
          xmlns="http://www.w3.org/1500/svg"
        >
          <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
        </svg>
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText className="col-start-2 min-w-0">
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      className={cn('mx-2 my-1 h-px bg-border', className)}
      data-slot="select-separator"
      {...props}
    />
  );
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectGroupLabel(props: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      className="px-2 py-1.5 font-medium text-muted-foreground text-[calc(11rem/14)]"
      data-slot="select-group-label"
      {...props}
    />
  );
}

export {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectPopup as SelectContent,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
