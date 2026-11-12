import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { Faint, Meta, PageTitle, SectionTitle } from '@/components/ui/type';
import type { BoardSettings, LocalBoard } from './types';
import { errorsOf, post } from './api';

type Key = keyof BoardSettings;

/**
 * Preferences: how Arbiter works in this project, saved in arbiter.json so everyone on it shares them.
 * Each control saves as you change it; the CLI reads the file each time it acts, so nothing else needs
 * telling. Three groups: what the agent says in chat, what gets queued for review, and the rules and
 * pictures. The review question isn't a setting: it comes at every 5 waiting (D-0005).
 * Live board only: an exported copy has no settings.
 */
export function Preferences({ data, refresh }: { data: LocalBoard; refresh: () => Promise<void> }) {
  const s = data.settings!;
  // What's showing: changed at once on a click, put back if the save is refused.
  const [shown, setShown] = useState(s);
  useEffect(() => setShown(s), [s]);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = async (patch: Partial<BoardSettings>): Promise<boolean> => {
    const keys = Object.keys(patch) as Key[];
    setShown((x) => ({ ...x, ...patch }));
    const r = await post('/api/settings', patch);
    if (r.exitCode) {
      setShown(s);
      setErrors((e) => ({ ...e, ...Object.fromEntries(keys.map((k) => [k, errorsOf(r)])) }));
      return false;
    }
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k as Key))));
    setSaved(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 1500);
    await refresh();
    return true;
  };

  return (
    <TooltipProvider delay={300}>
    <main>
      <div className="mb-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <PageTitle>Preferences</PageTitle>
          <Meta className="mt-0.5 block">How Arbiter works in this project. Saved in arbiter.json, so everyone on the project shares them.</Meta>
        </div>
        <span aria-live="polite" className="pt-1.5">{saved ? <Faint>Saved</Faint> : null}</span>
      </div>

      <Group title="Check-ins" about="What the agent tells you in chat while it works.">
        <Row label="After work settles" hint="What the agent says in chat when a piece of work is done. Except under Nothing until I ask, it also asks whether to review at 5, 10 and 15 changes waiting.">
          <Segmented
            label="After work settles" value={shown.checkin} onChange={(v) => void save({ checkin: v })}
            options={[
              { value: 'quiet', label: 'Nothing until I ask', tip: 'Decisions are saved silently. The agent never asks you to review; type /arbiter when you want to see them. It still asks when something clashes with a rule.' },
              { value: 'feature', label: 'A line after big work', tip: 'When a new screen, flow or feature is done, one sentence saying what changed. Small changes are saved silently.' },
              { value: 'every', label: 'A line after everything', tip: 'One sentence each time a piece of work is done, big or small.' },
            ]}
          />
          <FieldError text={errors.checkin} />
        </Row>
      </Group>

      <Group title="What gets recorded" about="What the agent saves for you to review, and what it leaves out.">
        <Row label="Record" hint="What the agent queues for your Review inbox. A feature is a new screen, flow or page. A pattern is a call that would apply on other screens too.">
          <Segmented
            label="Record" value={shown.record} onChange={(v) => void save({ record: v })}
            options={[
              { value: 'pattern', label: 'Features and patterns', tip: 'New screens, flows and pages, and calls that would apply on other screens too, like where save buttons go.' },
              { value: 'feature', label: 'Features only', tip: 'Only new screens, flows and pages. Smaller calls that repeat across screens aren’t queued.' },
            ]}
          />
          <FieldError text={errors.record} />
        </Row>
        <Row kind="switch" label="The agent’s own calls" hint="Off: only what you asked for or corrected.">
          <Switch checked={shown.agentCalls} onChange={(on) => void save({ agentCalls: on })} tip="When the agent picks between real options on its own, like tabs or a dropdown, it records the choice for you to confirm. Off: only what you asked for or corrected.">Record choices the agent made between real options</Switch>
          <FieldError text={errors.agentCalls} />
        </Row>
      </Group>

      <Group title="Rules and pictures" about="How many rules the agent keeps, and the pictures on each change.">
        <Row label="Design rules" hint={`DECISIONS.md has ${s.rules} now. When it’s full, a new rule has to replace one. More rules is more for the agent to read before every change.`}>
          <Cap value={shown.cap} min={Math.max(1, s.rules)} onSave={(cap) => save({ cap })} />
          <FieldError text={errors.cap} />
        </Row>
        <Row kind="switch" label="Pictures" hint="One picture of a screen when work on it settles, for its card.">
          <Switch checked={shown.pictures} onChange={(on) => void save({ pictures: on })} tip="When work on a screen settles, the agent opens the app and takes one picture of it for that change's card. Off: no pictures, and nothing says one is missing.">Take a picture when a screen changes</Switch>
          <FieldError text={errors.pictures} />
          {shown.pictures ? <App value={s.app} onSave={(app) => save({ app })} error={errors.app} /> : null}
        </Row>
        <Row kind="switch" label="Folders" hint="Offered once a session, when eight or more areas sit outside a folder.">
          <Switch checked={shown.suggestFolders} onChange={(on) => void save({ suggestFolders: on })} tip="When eight or more areas sit outside a folder, the agent offers once a session to group them. It only saves folders you say yes to.">Suggest folders when areas pile up</Switch>
          <FieldError text={errors.suggestFolders} />
        </Row>
      </Group>
    </main>
    </TooltipProvider>
  );
}

/**
 * A titled group of settings, with a line on what it covers under its title. A hairline sits above each
 * group, the first included; the settings inside one aren't ruled, so the lines only mark the groups.
 */
function Group({ title, about, children }: { title: string; about: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-border pt-10 [&+&]:mt-10">
      <SectionTitle className="mb-0.5!">{title}</SectionTitle>
      <p className="mb-2 text-[13px] text-muted">{about}</p>
      <div>{children}</div>
    </section>
  );
}

/**
 * A setting: its name on the left, then the control, with what it does under it. Stacked on a phone.
 * The name's line is as tall as the control beside it, so their words sit on one line: 32px beside a
 * field or a choice of a few, 21px beside a switch and its words.
 */
function Row({ label, hint, kind = 'field', children }: { label: string; hint?: string; kind?: 'field' | 'switch'; children: React.ReactNode }) {
  const [control, ...rest] = Array.isArray(children) ? children : [children];
  return (
    <div className="grid gap-x-6 gap-y-2 py-4 md:grid-cols-[12rem_minmax(0,1fr)]">
      <div className={`text-[14px] ${kind === 'switch' ? 'md:leading-[21px]' : 'md:leading-8'}`}>{label}</div>
      <div className="min-w-0">
        {control}
        {hint ? <p className="mt-1.5 max-w-xl text-[13px] text-muted">{hint}</p> : null}
        {rest}
      </div>
    </div>
  );
}

function FieldError({ text }: { text?: string }) {
  return text ? <p role="alert" className="mt-1.5 text-[13px] text-bad">{text}</p> : null;
}

/** The most rules DECISIONS.md holds. Saved on Enter or on leaving the field; Escape puts it back. */
function Cap({ value, min, onSave }: { value: number; min: number; onSave: (n: number) => Promise<boolean> }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === '' || n === value) { setText(String(value)); return; }
    void onSave(n).then((ok) => { if (!ok) setText(String(value)); });
  };
  return (
    <div className="flex items-center gap-2 text-[14px]">
      <Tooltip label={`The most rules DECISIONS.md can hold, up to 100. It can’t go below the ${min} you have. Press Enter to save.`}>
        <Input
          type="number" inputMode="numeric" min={min} max={100} value={text} aria-label="The most design rules DECISIONS.md holds" className="w-20! tabular-nums"
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setText(String(value)); }}
        />
      </Tooltip>
      <span className="text-muted">at most, in DECISIONS.md</span>
    </div>
  );
}

/** Where the app runs, so the agent has an address to open. Saved on Enter or on leaving the field; empty takes it off. */
function App({ value, onSave, error }: { value: string | null; onSave: (url: string) => Promise<boolean>; error?: string }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const commit = () => { if (text.trim() !== (value ?? '')) void onSave(text.trim()); };
  return (
    <div className="mt-4">
      <label htmlFor="app-address" className="block text-[13px] text-muted">App address</label>
      <Tooltip label="Where your app runs while you work on it, like http://localhost:3000. The agent opens it here to take pictures. Press Enter to save.">
        <Input
          id="app-address" aria-label="App address" value={text} placeholder="http://localhost:3000" spellCheck={false} className="mt-1.5 max-w-xs"
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setText(value ?? ''); }}
        />
      </Tooltip>
      {error ? <FieldError text={error} /> : <p className="mt-1.5 text-[13px] text-muted">Where the agent opens the app to take them. Leave it empty and the agent asks.</p>}
    </div>
  );
}
