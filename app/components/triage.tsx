"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { confirmEventAction, ignoreEventAction } from "@/app/actions";

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
  reasons: string[];
  source: string;
  gmailHref: string | null;
};

/**
 * Check, as a triage: the most consequential uncertainty first, one decision at a time, resolved from the keyboard.
 * Ranked by impact on live recruiting (see lib/recruiting/review.ts), so ten housekeeping questions never bury the one that
 * might be a rejection. "Skip" defers without deciding. Anything weak is folded and never counted.
 */
export function Triage({ items, editors }: { items: TriageItem[]; editors: Record<string, ReactNode> }) {
  const counted = items.filter((i) => !i.weak);
  const folded = items.filter((i) => i.weak);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [fixingFor, setFixingFor] = useState<string | null>(null);
  const confirmForm = useRef<HTMLFormElement>(null);
  const ignoreForm = useRef<HTMLFormElement>(null);
  const editorId = useId();

  const ordered = useMemo(() => [...counted.filter((i) => !skipped.includes(i.id)), ...counted.filter((i) => skipped.includes(i.id))], [counted, skipped]);
  const current = ordered.find((i) => i.id === picked) ?? ordered[0];
  const rest = ordered.filter((i) => i.id !== current?.id);
  const important = counted.filter((i) => i.tier === "important").length;

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

  if (!current) {
    return (
      <div className="panel p-6">
        <h2 className="t-title">All clear.</h2>
        <p className="mt-2 max-w-[44ch] text-ink-2">Everything we were unsure about is settled. New doubts will wait here, most important first.</p>
        {folded.length > 0 ? <Folded items={folded} editors={editors} /> : null}
      </div>
    );
  }

  const confirmLabel = current.possible ? "Yes, it is recruiting" : "Looks right";
  return (
    <div>
      <p className="t-meta tnum text-ink-3" aria-live="polite">
        {counted.length} to check{important > 0 ? ` · ${important} on active recruiting` : ""}
      </p>
      <div className="triage-rail mt-3" aria-hidden>
        <span style={{ width: `${Math.max(4, 100 / Math.max(1, counted.length))}%` }} />
      </div>

      <article className="triage mt-6 p-5 sm:p-6" aria-label="Item to check">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="text-[1.0625rem] font-medium tracking-tight">
            {current.possible ? current.company : (
              <Link className="link" href={`/opportunities/${encodeURIComponent(current.opportunityKey)}`}>
                {current.company}
              </Link>
            )}
            {current.role ? <span className="ml-2 font-normal text-ink-2">{current.role}</span> : null}
          </p>
          <p className="t-meta tnum text-ink-3">{current.date}</p>
        </div>
        <p className="mt-1"><span className="chip">{current.why}</span></p>
        <p className="mt-4 text-[1.0625rem]">{current.sentence}</p>
        <p className="mt-2 max-w-[60ch] text-ink-2">{current.reasons.join(" ")}</p>
        <p className="t-meta mt-3 flex items-baseline gap-x-4 text-ink-3">
          <span className="min-w-0 truncate">{current.source}</span>
          {current.gmailHref ? (
            <a className="link-quiet t-meta shrink-0" href={current.gmailHref} target="_blank" rel="noreferrer">
              Open in Gmail
            </a>
          ) : null}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-3 border-t border-line pt-5">
          <form ref={confirmForm} action={confirmEventAction}>
            <input type="hidden" name="eventId" value={current.id} />
            <button type="submit" className="btn-primary">
              {confirmLabel} <span className="keyhint ml-1 !border-white/30 !text-white/80" aria-hidden>Y</span>
            </button>
          </form>
          <button type="button" className="btn-soft" aria-expanded={fixing} aria-controls={editorId} onClick={toggleFix}>
            {fixing ? "Close" : "Fix details"} <span className="keyhint ml-1" aria-hidden>F</span>
          </button>
          <form ref={ignoreForm} action={ignoreEventAction}>
            <input type="hidden" name="eventId" value={current.id} />
            <button type="submit" className="btn-soft">
              Not recruiting <span className="keyhint ml-1" aria-hidden>N</span>
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

      {rest.length > 0 ? (
        <section className="mt-10" aria-label="Up next">
          <h2 className="t-heading">
            Up next <span className="tnum ml-1 font-normal text-ink-3">{rest.length}</span>
          </h2>
          <ul className="list mt-2">
            {rest.map((i) => (
              <li key={i.id}>
                <button type="button" className="row !items-center !py-2.5 w-full text-left" onClick={() => setPicked(i.id)}>
                  <span className="min-w-0">
                    <span className="block truncate text-[0.9375rem] font-medium tracking-tight">{i.company}{i.role ? <span className="font-normal text-ink-2"> {i.role}</span> : null}</span>
                    <span className="t-meta block truncate text-ink-3">{i.why}</span>
                  </span>
                  <span className="t-meta tnum shrink-0 text-ink-3">{i.date}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {folded.length > 0 ? <div className="mt-10"><Folded items={folded} editors={editors} /></div> : null}
    </div>
  );
}

/** Weak suggestions: offered, folded, never counted. Each can still be settled. */
function Folded({ items, editors }: { items: TriageItem[]; editors: Record<string, ReactNode> }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <button type="button" className="link-quiet inline-flex items-center gap-1.5" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: open ? "rotate(90deg)" : "none" }}>
          <path d="M3 1.5 6 4.5 3 7.5" />
        </svg>
        Also possibly recruiting · {items.length}
      </button>
      <div id={id} className="disclose" data-open={open} aria-hidden={!open} inert={!open}>
        <div>
          <p className="t-meta mb-2 mt-3 max-w-[52ch] text-ink-3">Mail that looks a little like hiring but that we are less sure about. None of it is in your pipeline.</p>
          <ul className="list border-y border-line">
            {items.map((i) => (
              <li key={i.id} className="py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6">
                  <p className="font-medium tracking-tight">{i.company}</p>
                  <p className="t-meta tnum text-ink-3">{i.date}</p>
                </div>
                <p className="t-meta mt-0.5 truncate text-ink-3">{i.source}</p>
                <WeakActions id={i.id} editor={editors[i.id]} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function WeakActions({ id, editor }: { id: string; editor: ReactNode }) {
  const [fix, setFix] = useState(false);
  const eid = useId();
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <form action={confirmEventAction}>
          <input type="hidden" name="eventId" value={id} />
          <button type="submit" className="btn-soft">Yes, it is recruiting</button>
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
