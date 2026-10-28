'use client';

import { Field as FieldPrimitive } from '@base-ui/react/field';
import { mergeProps } from '@base-ui/react/merge-props';
import type * as React from 'react';

import { cn } from '@/lib/utils';

type TextareaProps = React.ComponentProps<'textarea'> & {
  size?: 'sm' | 'default' | 'lg' | number;
  unstyled?: boolean;
};

function Textarea({ className, size = 'default', unstyled = false, ...props }: TextareaProps) {
  return (
    <span
      className={
        cn(
          !unstyled &&
            'relative inline-flex w-full rounded-[6px] border border-border bg-input/20 text-[calc(12rem/14)] ring-ring/20 transition-shadow has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-disabled:opacity-55 has-focus-visible:ring-2',
          className
        ) || undefined
      }
      data-size={size}
      data-slot="textarea-control"
    >
      <FieldPrimitive.Control
        render={(defaultProps) => (
          <textarea
            className={cn(
              'field-sizing-content min-h-[calc(72rem/14)] w-full rounded-[inherit] px-[10px] py-[8px] leading-[calc(20rem/14)] outline-none',
              size === 'sm' &&
                'min-h-16.5 px-[calc(--spacing(2.5)-1px)] py-[calc(--spacing(1)-1px)] max-sm:min-h-19.5',
              size === 'lg' && 'min-h-18.5 py-[calc(--spacing(2)-1px)] max-sm:min-h-21.5'
            )}
            data-slot="textarea"
            {...mergeProps(defaultProps, props)}
          />
        )}
      />
    </span>
  );
}

export { Textarea, type TextareaProps };
