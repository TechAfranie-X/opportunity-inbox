"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Mark } from "@/app/components/brand";
import { PipelineExplorer } from "@/app/components/pipeline-explorer";
import { WorkspaceProvider, useWorkspace } from "@/app/components/workspace";
import { STAGE_LABEL } from "@/lib/recruiting/format";
import { PULSE_STAGES } from "@/lib/recruiting/history";
import type { Opportunity } from "@/lib/recruiting/types";

/**
 * The 30-second story, as a script. Times are milliseconds from the start.
 * Everything on screen is the real product UI (Today, the inspector, the pipeline explorer, the
 * history page) fed by a synthetic mailbox; this file only decides *when* each thing happens.
 */
const SCRIPT = {
  cueHero: 4300, //        a quiet cue on "View history"
  openInspector: 5000, //  Today -> inspector glides in
  scrollInspector: 9000, // ...and scrolls on to the interview, whatever the window height
  closeInspector: 12000, // inspector leaves; Pipeline fades in
  stages: [
    [12000, "applied"],
    [13800, "assessment"],
    [15400, "interview"],
    [17000, "offer"],
  ] as const,
  history: 20000, //       Pipeline -> one rich history
  historyFirstEmail: 500, // first timeline entry settles this long after the scene starts
  historyEmailEvery: 400, // ...and one more every 400ms
  scrollHistory: [1500, 4600] as const, // the page glides down the timeline: [start offset, duration]
  closing: 27000, //       clean final frame
  done: 30400, //          Replay becomes available
} as const;

/** Eased, cancellable page scroll with a fixed duration (the browser's own smooth scroll has none). */
function glideTo(getTarget: () => number, durationMs: number, cancelled: { current: boolean }) {
  const from = window.scrollY;
  const to = getTarget();
  const start = performance.now();
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const frame = (now: number) => {
    if (cancelled.current) return;
    const t = Math.min(1, (now - start) / durationMs);
    window.scrollTo(0, from + (to - from) * ease(t));
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

type SceneId = "today" | "pipeline" | "history";
type Layer = { id: SceneId; leaving: boolean; key: number };

export function PresentationDirector(props: DirectorProps) {
  return (
    <WorkspaceProvider opportunities={props.opportunities} now={props.now} basePath="/demo" editable persistSelection={false}>
      <Stage {...props} />
    </WorkspaceProvider>
  );
}

type DirectorProps = {
  opportunities: Opportunity[];
  now: Date;
  heroKey: string;
  historyKey: string;
  emailCount: number;
  /** Server-rendered real views, passed through untouched. */
  todayNode: ReactNode;
  historyNode: ReactNode;
  /** Test aid: 1 is real time. */
  speed: number;
};

function Stage({ opportunities, heroKey, historyKey, emailCount, todayNode, historyNode, speed }: DirectorProps) {
  const { open, close } = useWorkspace();
  const [runId, setRunId] = useState(0);
  const [layers, setLayers] = useState<Layer[]>([{ id: "today", leaving: false, key: 0 }]);
  const [stage, setStage] = useState<string>("applied");
  const [emails, setEmails] = useState(0);
  const [closing, setClosing] = useState(false);
  const [done, setDone] = useState(false);
  const layerKey = useRef(1);

  const historyOpp = opportunities.find((o) => o.key === historyKey);
  const historyTotal = historyOpp?.events.length ?? 0;
  const activeCount = opportunities.length;

  // The script. Re-runs from scratch on every replay.
  useEffect(() => {
    const timers: number[] = [];
    const cancelled = { current: false };
    window.scrollTo(0, 0);
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms / speed));
    const root = document.documentElement;

    const goto = (id: SceneId) =>
      setLayers((prev) => {
        if (prev.some((l) => l.id === id && !l.leaving)) return prev;
        const next: Layer[] = prev.map((l) => ({ ...l, leaving: true }));
        next.push({ id, leaving: false, key: layerKey.current++ });
        return next;
      });
    // Leaving layers are removed once their fade has played.
    const sweep = () => setLayers((prev) => prev.filter((l) => !l.leaving));

    // The story starts in light mode whatever the saved preference is; the saved value is untouched.
    root.dataset.theme = "light";
    root.dataset.presentation = "running";
    delete root.dataset.presentationDone;
    root.style.overflow = "hidden";

    at(SCRIPT.cueHero, () => (root.dataset.demoCue = "hero-history"));
    at(SCRIPT.openInspector, () => {
      delete root.dataset.demoCue;
      open(heroKey);
    });
    at(SCRIPT.scrollInspector, () => {
      const body = document.querySelector<HTMLElement>(".inspector-body");
      body?.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
    });
    at(SCRIPT.closeInspector, () => {
      close();
      goto("pipeline");
      timers.push(window.setTimeout(sweep, 700 / speed));
    });
    for (const [ms, id] of SCRIPT.stages) at(ms, () => setStage(id));
    at(SCRIPT.history, () => {
      goto("history");
      timers.push(window.setTimeout(sweep, 700 / speed));
    });
    for (let i = 1; i <= historyTotal; i += 1) {
      at(SCRIPT.history + SCRIPT.historyFirstEmail + (i - 1) * SCRIPT.historyEmailEvery, () => setEmails(i));
    }
    at(SCRIPT.history + SCRIPT.scrollHistory[0], () =>
      glideTo(() => document.documentElement.scrollHeight - window.innerHeight, SCRIPT.scrollHistory[1] / speed, cancelled),
    );
    at(SCRIPT.closing, () => setClosing(true));
    at(SCRIPT.done, () => {
      setDone(true);
      root.dataset.presentationDone = "true";
    });

    return () => {
      cancelled.current = true;
      timers.forEach((t) => window.clearTimeout(t));
      window.scrollTo(0, 0);
      close();
      delete root.dataset.presentation;
      delete root.dataset.presentationDone;
      delete root.dataset.demoCue;
      root.style.overflow = "";
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("oi-theme");
      } catch {
        /* storage unavailable: fall back to the default */
      }
      root.dataset.theme = saved === "dark" || saved === "system" ? saved : "light";
    };
  }, [runId, speed, heroKey, historyTotal, open, close]);

  const replay = () => {
    setLayers([{ id: "today", leaving: false, key: layerKey.current++ }]);
    setStage("applied");
    setEmails(0);
    setClosing(false);
    setDone(false);
    setRunId((n) => n + 1);
  };

  const current = layers.find((l) => !l.leaving)?.id ?? "today";
  const navActive = current === "today" ? "today" : "pipeline";

  return (
    <div style={{ "--speed": speed } as CSSProperties}>
      {/* dev-only chrome has no place in a recording */}
      <style>{`nextjs-portal{display:none!important}`}</style>

      <div className="presentation-root" aria-hidden={closing}>
        <header className="nav glass">
          <div className="mx-auto flex h-full w-full max-w-[75rem] items-center justify-between px-6 lg:px-10">
            <div className="flex items-center gap-7">
              <span className="flex items-center gap-2.5 text-[0.9375rem] font-semibold tracking-tight">
                <Mark />
                <span className="max-sm:hidden">Opportunity Inbox</span>
              </span>
              <nav className="flex items-center gap-1" aria-label="Primary">
                {(["today", "pipeline", "activity"] as const).map((id) => (
                  <span key={id} className="nav-link" aria-current={navActive === id ? "page" : undefined}>
                    {id === "today" ? "Today" : id === "pipeline" ? "Pipeline" : "Activity"}
                  </span>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <span className="t-meta tnum hidden text-ink-3 lg:inline">Updated 8:02 AM</span>
              <span className="search-pill" aria-hidden>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <circle cx="5.5" cy="5.5" r="4" />
                  <path d="m8.6 8.6 3 3" />
                </svg>
                <span className="pr-6">Search</span>
                <kbd>⌘K</kbd>
              </span>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-tint text-sm font-medium text-ink">M</span>
            </div>
          </div>
        </header>
        <div className="scroll-edge" aria-hidden />

        <div className="workspace flex-1" style={{ paddingTop: "calc(var(--nav-h) + 2.75rem)", paddingBottom: "4rem" }}>
          <main className="mx-auto w-full max-w-[75rem] px-6 lg:px-10">
            <div className="scene-stack">
              {layers.map((layer) => (
                <section key={layer.key} className={`scene ${layer.leaving ? "scene-out" : "scene-in"}`}>
                  {layer.id === "today" ? todayNode : null}
                  {layer.id === "pipeline" ? (
                    <div>
                      <h1 className="t-display">Pipeline</h1>
                      <p className="t-lead mt-3 max-w-[44ch] text-ink-2">
                        {emailCount} recruiting emails, rebuilt into {activeCount} opportunities.
                      </p>
                      <div className="mt-10">
                        <PipelineExplorer controlledStage={stage} />
                      </div>
                    </div>
                  ) : null}
                  {layer.id === "history" ? (
                    <div className="history-stage relative">
                      <div className="pointer-events-none absolute right-0 top-1 text-right">
                        <p className="text-[1.75rem] font-medium leading-none tracking-tight tnum" aria-live="off">
                          {emails} <span className="text-[1.0625rem] font-normal text-ink-2">emails</span>
                        </p>
                        <p className="t-meta mt-1.5 text-ink-3">read into one timeline</p>
                      </div>
                      {historyNode}
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          </main>
        </div>
      </div>

      {closing ? (
        <div className="closing" role="img" aria-label="Opportunity Inbox. Your recruiting life, organized automatically.">
          <div className="closing-line">
            <span className="closing-track" />
            {PULSE_STAGES.map((s, i) => (
              <div key={s} className="closing-stop" style={{ left: `${i * 25}%`, ["--i" as string]: i } as CSSProperties}>
                <i className="closing-dot" data-last={i === PULSE_STAGES.length - 1} />
                <span className="t-meta closing-label">{STAGE_LABEL[s]}</span>
              </div>
            ))}
          </div>
          <h1 className="t-display closing-title">Opportunity Inbox</h1>
          <p className="t-lead closing-tag">Your recruiting life, organized automatically.</p>
        </div>
      ) : null}

      <button type="button" onClick={replay} className="replay link-quiet" data-visible={done} tabIndex={done ? 0 : -1} aria-hidden={!done}>
        Replay
      </button>
    </div>
  );
}
