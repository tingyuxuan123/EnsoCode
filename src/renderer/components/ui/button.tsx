import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-[6px] whitespace-nowrap rounded-[6px] border font-medium text-[calc(12rem/14)] outline-none transition-colors duration-150 pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-55 [&_svg:not([class*='size-'])]:size-[calc(14rem/14)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-[calc(32rem/14)] px-[12px]',
        icon: 'size-[calc(32rem/14)]',
        'icon-lg': 'size-[calc(36rem/14)]',
        'icon-sm': 'size-[calc(28rem/14)]',
        'icon-xl': "size-[calc(40rem/14)] [&_svg:not([class*='size-'])]:size-[calc(18rem/14)]",
        'icon-xs': "size-[calc(24rem/14)] [&_svg:not([class*='size-'])]:size-[calc(12rem/14)]",
        lg: 'h-[calc(36rem/14)] px-[14px] text-[calc(13rem/14)]',
        sm: 'h-[calc(28rem/14)] px-[10px]',
        xl: "h-[calc(40rem/14)] px-[16px] text-[calc(14rem/14)] [&_svg:not([class*='size-'])]:size-[calc(18rem/14)]",
        xs: "h-[calc(24rem/14)] gap-[4px] px-[8px] text-[calc(11rem/14)] [&_svg:not([class*='size-'])]:size-[calc(12rem/14)]",
      },
      variant: {
        default:
          'border-foreground bg-foreground text-inverse-foreground hover:bg-foreground/90 data-pressed:bg-foreground/80',
        destructive:
          'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 data-pressed:bg-destructive/80',
        'destructive-outline':
          'border-destructive/30 bg-transparent text-destructive hover:border-destructive/50 hover:bg-destructive/5 data-pressed:bg-destructive/10',
        ghost: 'border-transparent hover:bg-accent data-pressed:bg-accent',
        link: 'border-transparent underline-offset-4 hover:underline',
        outline: 'border-border bg-background hover:bg-accent/50 data-pressed:bg-accent',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90 [:active,[data-pressed]]:bg-secondary/80',
      },
    },
  }
);

interface ButtonProps extends useRender.ComponentProps<'button'> {
  variant?: VariantProps<typeof buttonVariants>['variant'];
  size?: VariantProps<typeof buttonVariants>['size'];
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>['type'] = render
    ? undefined
    : 'button';

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    'data-slot': 'button',
    type: typeValue,
  };

  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(defaultProps, props),
    render,
  });
}

export { Button, buttonVariants };
