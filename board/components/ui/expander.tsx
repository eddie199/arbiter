import { useId } from 'react';
import { cn } from './cn';
import { Small } from './icons';

/**
 * Something that opens in place (DESIGN.md, "Expanders"): its own words say what opens, then a 12px ⌄
 * that flips while it's open. `ExpanderButton` is the line, `ExpanderPanel` what it opens, tied by `id`.
 * On Home the panel grows (`grow`); elsewhere it simply appears. Off with reduced motion either way.
 */
export function ExpanderButton({ open, onToggle, controls, className, children }: { open: boolean; onToggle: () => void; controls?: string; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={controls} className={cn('inline-flex items-center gap-1 rounded-[4px] text-muted hover:text-fg', className)}>
      {children}
      <Chevron open={open} />
    </button>
  );
}

/** The expander's ⌄, flipped while open. For a line that's its own button already (a compact card's top line). */
export function Chevron({ open, className }: { open: boolean; className?: string }) {
  return <span className={cn('inline-flex transition-transform duration-[250ms] ease-[var(--ease-out)] motion-reduce:transition-none', open && 'rotate-180', className)}>{Small.chevron}</span>;
}

export function ExpanderPanel({ id, open, grow, className, children }: { id?: string; open: boolean; grow?: boolean; className?: string; children: React.ReactNode }) {
  if (!grow) return open ? <div id={id} className={className}>{children}</div> : null;
  return (
    <div id={id} inert={!open} aria-hidden={!open} className={cn('grid transition-[grid-template-rows] duration-[250ms] ease-[var(--ease-out)] motion-reduce:transition-none', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
      <div className={cn('min-h-0 overflow-hidden transition-[opacity,filter] duration-[250ms] ease-[var(--ease-out)] motion-reduce:transition-none', open ? 'opacity-100 blur-0' : 'opacity-0 blur-[2px]', className)}>{children}</div>
    </div>
  );
}

/** An id to tie a button to its panel. */
export const usePanelId = () => `panel-${useId().replace(/:/g, '')}`;
