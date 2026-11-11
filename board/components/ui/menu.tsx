import { Menu } from '@base-ui-components/react/menu';
import { cn } from './cn';
import { Tooltip } from './tooltip';

/**
 * A menu of actions under a trigger: "⋯" on a row, or a toolbar control that opens one. Base UI's Menu,
 * in the board's popup look (the Select's): arrow keys move, Enter picks, Escape closes. Every item has
 * an icon left of its words, from components/ui/icons.tsx, so all the board's menus read the same.
 */
export const POPUP = 'min-w-44 rounded-lg border border-border bg-bg p-1 shadow-lg outline-none transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0';
export const ITEM = 'group flex h-8 cursor-default select-none items-center justify-between gap-4 rounded-ui px-2 text-[13px] text-fg outline-none data-[highlighted]:bg-surface-2 data-[disabled]:text-faint';

export const DOTS = <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><circle cx="3" cy="7" r="1.15" /><circle cx="7" cy="7" r="1.15" /><circle cx="11" cy="7" r="1.15" /></svg>;
export const CHEVRON = <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="text-faint"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** The "⋯" a row's actions sit behind: 28px, quiet until hovered or open. */
export const dotsTrigger = 'flex h-7 w-7 items-center justify-center rounded-ui text-muted hover:bg-surface-2 hover:text-fg data-[popup-open]:bg-surface-2 data-[popup-open]:text-fg';
/** The "⋯" a page's own actions sit behind, in its filter bar or by its title: the bar's height and outline. */
export const barDots = 'flex h-8 w-8 items-center justify-center rounded-ui border border-border bg-bg text-muted hover:border-border-strong hover:text-fg data-[popup-open]:border-fg data-[popup-open]:text-fg';
/** A toolbar control that opens a menu, the height and outline of the filters beside it. */
export const toolbarTrigger = 'inline-flex h-8 items-center gap-1.5 rounded-ui border border-border bg-bg px-2.5 text-[13px] text-fg hover:border-border-strong data-[popup-open]:border-fg';

/** `tip` names what's behind the trigger on hover, as the bar's other icon buttons do. */
export function ActionMenu({ label, tip, trigger, className, align = 'end', children }: { label: string; tip?: string; trigger: React.ReactNode; className: string; align?: 'start' | 'end'; children: React.ReactNode }) {
  const button = <Menu.Trigger aria-label={label} className={className}>{trigger}</Menu.Trigger>;
  return (
    <Menu.Root>
      {tip ? <Tooltip label={tip}>{button}</Tooltip> : button}
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align={align} className="z-50">
          <Menu.Popup className={POPUP}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** An item's icon and words, for any menu's item: the icon muted, fg when the item is highlighted. */
export function ItemLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return <span className="flex items-center gap-2">{icon ? <span className="flex w-3.5 shrink-0 justify-center text-muted group-data-[highlighted]:text-fg">{icon}</span> : null}{children}</span>;
}

/** One action: its icon and words, and a hint on the right. */
export function ActionItem({ onClick, hint, icon, className, children }: { onClick: () => void; hint?: string; icon?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <Menu.Item className={cn(ITEM, className)} onClick={onClick}>
      <ItemLabel icon={icon}>{children}</ItemLabel>
      {hint ? <span className="text-[12px] text-faint">{hint}</span> : null}
    </Menu.Item>
  );
}

export const ActionSeparator = () => <div role="separator" className="-mx-1 my-1 border-t border-border" />;
