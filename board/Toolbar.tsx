import { SearchButton } from '@/components/ui/search-button';
import { FilterPill, MultiSelect, type MultiOption } from '@/components/ui/multi-select';
import { Select, type SelectOption } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { go, href } from './route';

/**
 * The team board's toolbar (components/BoardToolbar.tsx), with the filters in the hash instead of the
 * URL's query: Status first, then Area, then search; each value chosen shows as a pill that removes itself.
 */
export function Toolbar({ q, section, folder, status, view, sections, statuses, total, sort }: { q: string; section: string[]; folder?: string; status: string[]; view: 'cards' | 'list'; sections: MultiOption[]; statuses: MultiOption[]; total: number; sort?: { value: string; options: SelectOption[]; onChange: (v: string) => void } }) {

  const to = (next: { q?: string; section?: string[]; status?: string[]; view?: 'cards' | 'list' }) => {
    const v = { q, section, status, view, ...next };
    // A folder stays while you search or filter by status in it; picking areas leaves it.
    go(href('overview', { q: v.q || undefined, status: v.status, section: v.section, folder: next.section === undefined ? folder : undefined, view: v.view === 'list' ? 'list' : undefined }));
  };
  const chosen = (values: string[], options: MultiOption[]) => values.map((v) => options.find((o) => o.value === v) ?? ({ value: v, label: v } as MultiOption));
  const chosenStatus = chosen(status, statuses);
  const chosenArea = chosen(section, sections);
  const pills = chosenStatus.length + chosenArea.length;

  return (
    <div className="border-b border-border pb-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Sort leads, as in the Review inbox's toolbar. */}
        {sort ? <Select label="Sort" value={sort.value} options={sort.options} onChange={sort.onChange} /> : null}
        <MultiSelect label="Status" values={status} options={statuses} onChange={(v) => to({ status: v })} />
        {sections.length > 1 ? <MultiSelect label="Area" values={section} options={sections} onChange={(v) => to({ section: v })} /> : null}
        {/* Search, as an icon beside the views; it opens into a field. */}
        <div className="ml-auto flex items-center gap-2">
          <SearchButton value={q} label="Search changes" placeholder={`Search ${total} change${total === 1 ? '' : 's'}…`} onSearch={(text) => to({ q: text })} />
        </div>
        <ViewToggle value={view} onChange={(v) => to({ view: v })} options={[
          { value: 'cards', label: 'Cards', icon: CardsIcon },
          { value: 'list', label: 'List', icon: ListIcon },
        ]} />
      </div>
      {pills ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {chosenStatus.map((o) => <FilterPill key={`s-${o.value}`} label={o.label} tone={o.tone} onRemove={() => to({ status: status.filter((x) => x !== o.value) })} />)}
          {chosenArea.map((o) => <FilterPill key={`a-${o.value}`} prefix="Area" label={o.label} onRemove={() => to({ section: section.filter((x) => x !== o.value) })} />)}
          <Button variant="ghost" size="sm" onClick={() => to({ q: '', section: [], status: [] })}>Clear filters</Button>
        </div>
      ) : null}
    </div>
  );
}

export const CardsIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="1" y="1" width="5" height="5" rx="1" /><rect x="8" y="1" width="5" height="5" rx="1" /><rect x="1" y="8" width="5" height="5" rx="1" /><rect x="8" y="8" width="5" height="5" rx="1" /></svg>;
export const ListIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M1.5 3h11M1.5 7h11M1.5 11h11" /></svg>;
/** One thing at a time: a single card. */
/** Compact: rows, each a line you open. */
export const CompactIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 2.75h7.5M5 7h7.5M5 11.25h7.5" /><path d="m1.5 1.75 1 1-1 1M1.5 6l1 1-1 1M1.5 10.25l1 1-1 1" /></svg>;
export const SingleIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><rect x="1.5" y="1.5" width="11" height="11" rx="1.5" /><path d="M4 5h6M4 8h4" /></svg>;

/**
 * How a page is seen, at the end of its toolbar: icons, named on hover. As tall as the filters beside
 * it (h-8), so every control in a toolbar lines up.
 */
export function ViewToggle<V extends string>({ value, options, onChange, className = '' }: { value: V; options: { value: V; label: string; icon: React.ReactNode }[]; onChange: (v: V) => void; className?: string }) {
  return (
    <div className={`flex h-8 items-center rounded-ui border border-border p-0.5 ${className}`} role="group" aria-label="View">
      {options.map((o) => (
        <Tooltip key={o.value} label={o.label}>
          <button type="button" aria-label={o.label} aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={`flex h-full w-7 items-center justify-center rounded-[4px] ${value === o.value ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'}`}>{o.icon}</button>
        </Tooltip>
      ))}
    </div>
  );
}
