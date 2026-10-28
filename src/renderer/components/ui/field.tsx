'use client';

import { Field as FieldPrimitive } from '@base-ui/react/field';

import { cn } from '@/lib/utils';

function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return (
    <FieldPrimitive.Root
      className={cn('flex flex-col items-start gap-2', className)}
      data-slot="field"
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      className={cn(
        'inline-flex items-center gap-2 font-medium text-[calc(12rem/14)] leading-[calc(18rem/14)]',
        className
      )}
      data-slot="field-label"
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      className={cn('text-muted-foreground text-[calc(11rem/14)]', className)}
      data-slot="field-description"
      {...props}
    />
  );
}

function FieldError({ className, ...props }: FieldPrimitive.Error.Props) {
  return (
    <FieldPrimitive.Error
      className={cn('text-destructive-foreground text-[calc(11rem/14)]', className)}
      data-slot="field-error"
      {...props}
    />
  );
}

const FieldControl = FieldPrimitive.Control;
const FieldValidity = FieldPrimitive.Validity;

export { Field, FieldControl, FieldDescription, FieldError, FieldLabel, FieldValidity };
