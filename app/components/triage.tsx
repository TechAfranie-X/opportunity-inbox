"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { confirmEventAction, ignoreEventAction } from "@/app/actions";
import { EntityMark } from "@/app/components/entity-mark";
import { GmailLink } from "@/app/components/gmail-link";
import { IconCheck, IconPencil, IconSlash } from "@/app/components/icons";
import type { EntityState } from "@/lib/recruiting/presentation";

export type TriageItem = {
  id: string;
  company: string;
  role: string | null;
  opportunityKey: string;
  possible: boolean;
  weak: boolean;
  tier: "important" | "routine";
  why: string;
  date: string;
  sentence: string;
  entity: EntityState;
  reasons: string[];
  source: string;
  /** The Gmail conversation to open, or null (sample mailbox). The link itself is built client-side for the connected account. */
  gmailThread: string | null;
};

/**
 * Needs review, as a triage: only the reviews that matter to live recruiting are the flow, one decision at a time, most important first, resolved
 * from the keyboard (Y, F, N, S). Housekeeping and weak suggestions are folded below and never counted, so this reads as "three decisions", not
 * "sixty-seven chores". Ranked by impact on live recruiting (lib/recruiting/review.ts). "Skip" defers without deciding.
 */
export function Triage({ items, editors }: { items: TriageItem[]; editors: Record<string, ReactNode> }) {
  const important = items.filter((i) => !i.weak && i.tier === "important");
  const housekeeping = items.filter((i) => !i.weak && i.tier === "routine");
  const suggestions = items.filter((i) => i.weak);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [fixingFor, setFixingFor] = useState<string | null>(null);
  const confirmForm = useRef<HTMLFormElement>(null);
  const ignoreForm = useRef<HTMLFormElement>(null);
  const editorId = useId();

  const ordered = useMemo(() => [...important.filter((i) => !skipped.includes(i.id)), ...important.filter((i) => skipped.includes(i.id))], [important, skipped]);
  const current = items.find((i) => i.id === picked) ?? ordered[0];
  const position = current ? ordered.findIndex((i) => i.id === current.id) : -1;
  const rest = ordered.filter((i) => i.id !== current?.id);
  const fixing = fixingFor !== null && fixingFor === current?.id;
  const toggleFix = () => setFixingFor((v) => (current && v !== current.id ? current.id : null));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!current || e.metaKey || e.ctrlKey || e.altKey || (t && /^(input|textarea|select)$/i.test(t.tagName))) return;
      if (e.key === "y" || e.key === "Y") { e.preventDefault(); confirmForm.current?.requestSubmit(); }
      else if (e.key === "n" || e.key === "N") { e.preventDefault(); ignoreForm.current?.requestSubmit(); }
      else if (e.key === "f" || e.key === "F") { e.preventDefault(); setFixingFor((v) => (v !== current.id ? current.id : null)); }
      else if (e.key === "s" || e.key === "S") { e.preventDefault(); setSkipped((s) => [...s, current.id]); setPicked(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  const below = (
    <>
      {housekeeping.length > 0 ? <div className="mt-10"><FoldedList title="Housekeeping" note="Smaller questions that keep your history accurate. None of them affects what needs you now." items={housekeeping} editors={editors} confirmLabel="Looks right" /></div> : null}
      {suggestions.length > 0 ? <div className="mt-6"><FoldedList title="Also possibly recruiting" note="Mail that looks a little like hiring but that we are less sure about. None of it is in your pipeline." items={suggestions} editors={editors} confirmLabel="Yes, it is recruiting" /></div> : null}
    </>
  );

  if (!current) {
    return (
      <div>
        <div className="panel p-6">
          <h2 className="t-title">Nothing important to review.</h2>
          <p className="mt-2 max-w-[44ch] text-ink-2">Everything that could change what you do next is settled. New doubts will wait here, most important first.</p>
        </div>
        {below}
      </div>
    );
  }

  const isImportant = current.tier === "important" && !current.weak;
  return (
    <div>
      <p className="t-meta tnum text-ink-3" aria-live="polite">
        {isImportant ? `${position + 1} of ${important.length} important ${important.length === 1 ? "review" : "reviews"}` : "Housekeeping"}
      </p>
      <div className="triage-rail mt-3" aria-hidden>
        <span style={{ width: `${isImportant ? Math.max(4, ((position + 1) / Math.max(1, important.length)) * 100) : 4}%` }} />
      </div>

      <article className="triage mt-6 p-5 sm:p-6" aria-label="Item to review">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <EntityMark name={current.company} state={current.entity} size="md" />
            <div className="min-w-0">
              <p className="truncate text-[1.0625rem] font-medium tracking-tight">
                {current.possible || !current.opportunityKey ? current.company : (
                  <Link className="link" href={`/opportunities/${encodeURIComponent(current.opportunityKey)}`}>{current.company}</Link>
                )}
              </p>
              <p className="t-meta truncate text-ink-2">{current.role ?? (current.entity === "likely" ? "Likely company" : current.entity === "unknown" ? "Company unknown" : "No role detected")}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3"><span className="pill" data-tone="warn">Uncertain</span><p className="t-meta tnum text-ink-3">{current.date}</p></div>
        </div>

        <p className="mt-5 text-[1.125rem] font-medium leading-snug tracking-tight">{current.sentence}</p>
        <p className="t-meta mt-2"><span className="chip">{current.why}</span></p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="t-meta text-ink-3">Why we are unsure</p>
            <p className="mt-1 text-ink-2">{current.reasons.join(" ")}</p>
          </div>
          <div className="min-w-0">
            <p className="t-meta text-ink-3">From the email</p>
            <p className="mt-1 truncate text-ink-2">{current.source}</p>
            {current.gmailThread ? (
              <GmailLink className="link-quiet t-meta mt-1 inline-block" threadId={current.gmailThread}>Open in Gmail</GmailLink>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-3 border-t border-line pt-5">
          <form ref={confirmForm} action={confirmEventAction}>
            <input type="hidden" name="eventId" value={current.id} />
            <button type="submit" className="btn-primary inline-flex items-center gap-2">
              <IconCheck />{current.possible ? "Yes, it is recruiting" : "Looks right"} <span className="keyhint ml-1 !border-white/30 !text-white/80" aria-hidden>Y</span>
            </button>
          </form>
          <button type="button" className="btn-soft inline-flex items-center gap-2" aria-expanded={fixing} aria-controls={editorId} onClick={toggleFix}>
            <IconPencil />{fixing ? "Close" : "Fix details"} <span className="keyhint ml-1" aria-hidden>F</span>
          </button>
          <form ref={ignoreForm} action={ignoreEventAction}>
            <input type="hidden" name="eventId" value={current.id} />
            <button type="submit" className="btn-soft inline-flex items-center gap-2">
              <IconSlash />Not recruiting <span className="keyhint ml-1" aria-hidden>N</span>
            </button>
          </form>
          {ordered.length > 1 ? (
            <button type="button" className="link-quiet ml-auto" onClick={() => { setSkipped((s) => [...s, current.id]); setPicked(null); }}>
              Skip <span className="keyhint ml-1" aria-hidden>S</span>
            </button>
          ) : null}
        </div>
        <div id={editorId} className="disclose" data-open={fixing} aria-hidden={!fixing} inert={!fixing}>
          <div>{editors[current.id]}</div>
        </div>
      </article>

      {isImportant && rest.length > 0 ? (
        <section className="mt-10" aria-label="Up next">
          <h2 className="t-heading">Up next <span className="tnum ml-1 font-normal text-ink-3">{rest.length}</span></h2>
          <ul className="list mt-2">
            {rest.map((i) => (
              <li key={i.id}>
                <button type="button" className="row !items-center !py-2.5 w-full text-left" onClick={() => setPicked(i.id)}>
                  <span className="flex min-w-0 items-center gap-3">
                    <EntityMark name={i.company} state={i.entity} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-[0.9375rem] font-medium tracking-tight">{i.company}{i.role ? <span className="font-normal text-ink-2"> {i.role}</span> : null}</span>
                      <span className="t-meta block truncate text-ink-3">{i.why}</span>
                    </span>
                  </span>
                  <span className="t-meta tnum shrink-0 text-ink-3">{i.date}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {below}
    </div>
  );
}

/** Quiet lists: offered, folded, never counted. Each can still be settled in place. */
function FoldedList({ title, note, items, editors, confirmLabel }: { title: string; note: string; items: TriageItem[]; editors: Record<string, ReactNode>; confirmLabel: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <button type="button" className="link-quiet inline-flex items-center gap-1.5" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: open ? "rotate(90deg)" : "none" }}>
          <path d="M3 1.5 6 4.5 3 7.5" />
        </svg>
        {title} · {items.length}
      </button>
      <div id={id} className="disclose" data-open={open} aria-hidden={!open} inert={!open}>
        <div>
          <p className="t-meta mb-2 mt-3 max-w-[52ch] text-ink-3">{note}</p>
          <ul className="list border-y border-line">
            {items.map((i) => (
              <li key={i.id} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-x-6">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <EntityMark name={i.company} state={i.entity} size="sm" />
                    <p className="truncate font-medium tracking-tight">{i.company}</p>
                  </div>
                  <p className="t-meta tnum text-ink-3">{i.date}</p>
                </div>
                <p className="t-meta mt-1 truncate text-ink-3">{i.source}</p>
                <InlineActions id={i.id} editor={editors[i.id]} confirmLabel={confirmLabel} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function InlineActions({ id, editor, confirmLabel }: { id: string; editor: ReactNode; confirmLabel: string }) {
  const [fix, setFix] = useState(false);
  const eid = useId();
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <form action={confirmEventAction}>
          <input type="hidden" name="eventId" value={id} />
          <button type="submit" className="btn-soft">{confirmLabel}</button>
        </form>
        <button type="button" className="link-quiet" aria-expanded={fix} aria-controls={eid} onClick={() => setFix((v) => !v)}>
          {fix ? "Close" : "Fix details"}
        </button>
        <form action={ignoreEventAction}>
          <input type="hidden" name="eventId" value={id} />
          <button type="submit" className="link-quiet">Not recruiting</button>
        </form>
      </div>
      <div id={eid} className="disclose" data-open={fix} aria-hidden={!fix} inert={!fix}>
        <div>{editor}</div>
      </div>
    </div>
  );
}
