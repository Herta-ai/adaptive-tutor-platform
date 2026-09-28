import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-paper hover:bg-primary-hover active:scale-[0.99]',
        destructive:
          'bg-destructive text-destructive-foreground shadow-paper hover:bg-destructive/90 active:scale-[0.99]',
        outline:
          'border border-border bg-card text-foreground hover:bg-secondary hover:text-foreground active:scale-[0.99]',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-accent/80 active:scale-[0.99]',
        ghost:
          'text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-[0.99]',
        link: 'text-primary underline-offset-4 hover:underline !p-0 !h-auto !bg-transparent',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 rounded-md px-2.5 text-xs',
        lg: 'h-10 rounded-lg px-6 text-base',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
