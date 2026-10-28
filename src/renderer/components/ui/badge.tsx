import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[4px] border border-transparent font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [button,a&]:cursor-pointer [button,a&]:pointer-coarse:after:absolute [button,a&]:pointer-coarse:after:size-full [button,a&]:pointer-coarse:after:min-h-11 [button,a&]:pointer-coarse:after:min-w-11",
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-[calc(20rem/14)] min-w-[20px] px-[6px] text-[calc(11rem/14)]',
        lg: 'h-[calc(24rem/14)] min-w-[24px] px-[8px] text-[calc(12rem/14)]',
        sm: 'h-[calc(18rem/14)] min-w-[18px] px-[5px] text-[calc(11rem/14)]',
      },
      variant: {
        default: 'bg-primary text-primary-foreground [button,a&]:hover:bg-primary/90',
        destructive: 'bg-destructive text-white [button,a&]:hover:bg-destructive/90',
        error: 'bg-destructive/12 text-destructive dark:bg-destructive/16',
        info: 'bg-info/12 text-info dark:bg-info/16',
        outline:
          'border-border bg-transparent dark:bg-input/32 [button,a&]:hover:bg-accent/50 dark:[button,a&]:hover:bg-input/48',
        secondary: 'bg-secondary text-secondary-foreground [button,a&]:hover:bg-secondary/90',
        success: 'bg-success/12 text-success dark:bg-success/16',
        warning: 'bg-warning/12 text-warning-foreground dark:bg-warning/16',
      },
    },
  }
);

interface BadgeProps extends useRender.ComponentProps<'span'> {
  variant?: VariantProps<typeof badgeVariants>['variant'];
  size?: VariantProps<typeof badgeVariants>['size'];
}

function Badge({ className, variant, size, render, ...props }: BadgeProps) {
  const defaultProps = {
    className: cn(badgeVariants({ className, size, variant })),
    'data-slot': 'badge',
  };

  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(defaultProps, props),
    render,
  });
}

export { Badge, badgeVariants };
