// Copied from the site's hosted/components/ui/button.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const base = 'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-ui font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const sizes: Record<Size, string> = { sm: 'h-7 px-2.5 text-[13px]', md: 'h-8 px-3 text-[14px]' };
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg border border-accent hover:opacity-90',
  // The outline is the strong border: next to a filled primary, a hairline reads as a smaller button.
  secondary: 'bg-bg text-fg border border-border-strong hover:border-fg',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-surface-2 hover:text-fg',
  danger: 'bg-bg text-bad border border-border hover:border-bad',
};

export function Button({ variant = 'secondary', size = 'md', className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={cn(base, sizes[size], variants[variant], className)} {...props} />;
}

export const buttonClass = (variant: Variant = 'secondary', size: Size = 'md') => cn(base, sizes[size], variants[variant]);
