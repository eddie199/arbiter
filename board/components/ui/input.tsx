// Copied from the site's hosted/components/ui/input.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
import { Input as BaseInput } from '@base-ui-components/react/input';
import { cn } from './cn';

const field = 'h-8 w-full rounded-ui border border-border bg-bg px-2.5 text-[14px] text-fg placeholder:text-faint hover:border-border-strong focus:border-fg focus-visible:outline-none disabled:opacity-50';

export function Input({ className, ...props }: Omit<React.ComponentProps<typeof BaseInput>, 'className'> & { className?: string }) {
  return <BaseInput className={cn(field, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, 'h-auto min-h-20 resize-y py-1.5', className)} {...props} />;
}
