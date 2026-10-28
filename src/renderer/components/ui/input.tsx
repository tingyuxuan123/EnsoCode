'use client';

import { Input as InputPrimitive } from '@base-ui/react/input';
import type * as React from 'react';

import { cn } from '@/lib/utils';

type InputProps = Omit<InputPrimitive.Props & React.RefAttributes<HTMLInputElement>, 'size'> & {
  size?: 'sm' | 'default' | 'lg' | number;
  unstyled?: boolean;
};

function Input({ className, size = 'default', unstyled = false, ...props }: InputProps) {
  return (
    <span
      className={
        cn(
          !unstyled &&
            'relative inline-flex h-[calc(32rem/14)] w-full rounded-[6px] border border-border bg-input/20 text-[calc(12rem/14)] ring-ring/20 transition-shadow has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-disabled:opacity-55 has-focus-visible:ring-2',
          !unstyled && size === 'sm' && 'h-[calc(28rem/14)]',
          !unstyled && size === 'lg' && 'h-[calc(36rem/14)]',
          className
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      <InputPrimitive
        className={cn(
          'h-full min-h-0 w-full min-w-0 rounded-[inherit] px-[10px] leading-normal outline-none placeholder:text-muted-foreground/72',
          unstyled && 'h-[calc(32rem/14)]',
          unstyled && size === 'sm' && 'h-[calc(28rem/14)]',
          unstyled && size === 'lg' && 'h-[calc(36rem/14)]',
          size === 'sm' && 'px-[8px]',
          props.type === 'search' &&
            '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none',
          props.type === 'file' &&
            'text-muted-foreground file:me-3 file:bg-transparent file:font-medium file:text-foreground file:text-sm'
        )}
        data-slot="input"
        size={typeof size === 'number' ? size : undefined}
        {...props}
      />
    </span>
  );
}

export { Input, type InputProps };
