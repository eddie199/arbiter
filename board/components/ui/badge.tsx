// Copied from the site's hosted/components/ui/badge.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
import { cn } from './cn';

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'done' | 'excepted';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  info: 'bg-surface-2 text-info',
  /** Decided, beside Waiting's `info`: the same grey pill, in green. */
  done: 'bg-surface-2 text-ok',
  /** A rule's exceptions counted on Design rules, beside Waiting's `info`: the same grey pill, in amber. */
  excepted: 'bg-surface-2 text-warn',
};

export function Badge({ tone = 'neutral', className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-[12px] font-medium leading-none', tones[tone], className)} {...props} />;
}

