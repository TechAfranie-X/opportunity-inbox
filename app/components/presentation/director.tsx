"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Mark } from "@/app/components/brand";
import { PipelineExplorer } from "@/app/components/pipeline-explorer";
import { WorkspaceProvider, useWorkspace } from "@/app/components/workspace";
import { CUES } from "@/app/demo/presentation/cues";
import { STAGE_LABEL } from "@/lib/recruiting/format";
import { PULSE_STAGES } from "@/lib/recruiting/history";
import type { Opportunity } from "@/lib/recruiting/types";

/**
 * The scripted tour. All timing comes from CUES (generated from the narration), so the picture lands on
 * the words. Everything on screen is the real product UI fed by a synthetic mailbox; this file only
 * decides *when* each thing happens.
 *
 * Modes:
 *  - "button": an idle screen with "Play 30-second demo". Clicking starts narration and the tour together
 *    (audio is never started without a click).
 *  - "auto":   starts silently on load (used for silent recordings).
 *  - "film":   starts on load with every overlay off (captions, intro, closing) so a clean capture can be
 *    composed elsewhere (demo-video/).
 */
export type DirectorMode = "button" | "auto" | "film";

const SOUNDTRACK = "/demo/soundtrack.mp3";

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

type DirectorProps = {
  opportunities: Opportunity[];
  now: Date;
  heroKey: string;
  historyKey: string;
  emailCount: number;
  /** Server-rendered real views, passed through untouched. */
  todayNode: ReactNode;
  historyNode: ReactNode;
  mode: DirectorMode;
  /** Test aid: 1 is real time. */
  speed: number;
};

export function PresentationDirector(props: DirectorProps) {
  return (
    <WorkspaceProvider opportunities={props.opportunities} now={props.now} basePath="/demo" editable persistSelection={false}>
      <Stage {...props} />
    </WorkspaceProvider>
  );
}

/** Subject-line fragments: the inbox as it is without the product. Quiet, in the product's own type. */
const FRAGMENTS = [
  { t: "Thank you for applying to Brightwater Labs", x: 7, y: 26, s: 15, o: 0.5, d: 0.2 },
  { t: "Your online assessment", x: 58, y: 20, s: 17, o: 0.42, d: 0.55 },
  { t: "Quick chat?", x: 33, y: 40, s: 19, o: 0.36, d: 0.9 },
  { t: "Re: Your interview is confirmed", x: 60, y: 47, s: 14, o: 0.5, d: 1.2 },
  { t: "Update on your application", x: 10, y: 58, s: 16, o: 0.4, d: 1.5 },
  { t: "Reminder: your coding challenge closes tomorrow", x: 41, y: 64, s: 14, o: 0.46, d: 1.8 },
  { t: "Schedule your interview", x: 72, y: 72, s: 18, o: 0.34, d: 2.1 },
  { t: "Interview availability", x: 8, y: 77, s: 15, o: 0.4, d: 2.4 },
  { t: "Your offer letter", x: 46, y: 30, s: 15, o: 0.36, d: 2.7 },
  { t: "Thanks for completing your assessment", x: 22, y: 70, s: 13, o: 0.3, d: 3.0 },
];

function Chaos({ leaving }: { leaving: boolean }) {
  return (
    <div className={`chaos ${leaving ? "chaos-out" : ""}`} aria-hidden>
      {FRAGMENTS.map((f) => (
        <span
          key={f.t}
          className="chaos-fragment"
          style={{ left: `${f.x}%`, top: `${f.y}%`, fontSize: f.s, ["--o" as string]: f.o, animationDelay: `${f.d / 1.6}s` } as CSSProperties}
        >
          {f.t}
        </span>
      ))}
    </div>
  );
}

function Stage({ opportunities, heroKey, historyKey, emailCount, todayNode, historyNode, mode, speed }: DirectorProps) {
  const { open, close } = useWorkspace();
  const film = mode === "film";
  const [started, setStarted] = useState(mode !== "button");
  const [runId, setRunId] = useState(0);
  // Start only once fonts are loaded and two frames have painted, so animations begin with the script clock.
  const [ready, setReady] = useState(false);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [stage, setStage] = useState<string>("applied");
  const [emails, setEmails] = useState(0);
  const [chaos, setChaos] = useState<"off" | "in" | "out">("off");
  const [caption, setCaption] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [done, setDone] = useState(false);
  const layerKey = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  const historyTotal = opportunities.find((o) => o.key === historyKey)?.events.length ?? 0;

  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled) return;
          setReady(true);
        }),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // The script. Re-runs from scratch on every start/replay.
  useEffect(() => {
    if (!ready || !started) return;
    const P = CUES.product;
    const timers: number[] = [];
    const cancelled = { current: false };
    window.scrollTo(0, 0);
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms / speed));
    const root = document.documentElement;
    const narration = audio.current;

    const goto = (id: SceneId) =>
      setLayers((prev) => {
        if (prev.some((l) => l.id === id && !l.leaving)) return prev;
        const next: Layer[] = prev.map((l) => ({ ...l, leaving: true }));
        next.push({ id, leaving: false, key: layerKey.current++ });
        return next;
      });
    const sweep = () => setLayers((prev) => prev.filter((l) => !l.leaving));

    // The story starts in light mode whatever the saved preference is; the saved value is untouched.
    root.dataset.theme = "light";
    root.dataset.presentation = "running";
    delete root.dataset.presentationDone;
    root.style.overflow = "hidden";
    // Reveal pacing for the inspector and the history, from the cues.
    root.style.setProperty("--speed", String(speed));
    root.style.setProperty("--insp-first", `${P.inspectorEntryFirstS}s`);
    root.style.setProperty("--insp-step", `${P.inspectorEntryStepS}s`);
    root.style.setProperty("--hist-first", `${P.historyFirstS}s`);
    root.style.setProperty("--hist-step", `${P.historyStepS}s`);

    performance.mark("presentation-start"); // time zero, for anything recording this
    if (!film) {
      // Narration is only ever started from a click (browsers require it, and we never autoplay sound).
      if (mode === "button" && narration) {
        narration.currentTime = 0;
        narration.playbackRate = speed;
        void narration.play().catch(() => undefined);
      }
      at(CUES.film.chaos.in * 1000, () => setChaos("in"));
      at(CUES.film.chaos.outStart * 1000, () => setChaos("out"));
      at(CUES.film.chaos.outEnd * 1000 + 600, () => setChaos("off"));
      for (const c of CUES.captions) {
        at(c.start * 1000, () => setCaption(c.text));
        at(c.end * 1000, () => setCaption((cur) => (cur === c.text ? null : cur)));
      }
      at(CUES.film.closingStart * 1000, () => setClosing(true));
      at(CUES.duration * 1000 + 500, () => {
        setDone(true);
        root.dataset.presentationDone = "true";
      });
    }

    at(P.todayMountMs, () => goto("today"));
    at(P.inspectorOpenMs, () => open(heroKey));
    at(P.pipelineStartMs, () => {
      close();
      goto("pipeline");
      timers.push(window.setTimeout(sweep, 700 / speed));
    });
    for (const [ms, id] of P.stagesMs as Array<[number, string]>) at(ms, () => setStage(id));
    at(P.historyStartMs, () => {
      goto("history");
      timers.push(window.setTimeout(sweep, 700 / speed));
    });
    for (let i = 1; i <= historyTotal; i += 1) {
      at(P.historyStartMs + (P.historyFirstS + (i - 1) * P.historyStepS) * 1000, () => setEmails(i));
    }
    at(P.historyStartMs + P.historyScrollMs[0], () =>
      glideTo(() => document.documentElement.scrollHeight - window.innerHeight, P.historyScrollMs[1] / speed, cancelled),
    );

    return () => {
      cancelled.current = true;
      timers.forEach((t) => window.clearTimeout(t));
      narration?.pause();
      window.scrollTo(0, 0);
      close();
      delete root.dataset.presentation;
      delete root.dataset.presentationDone;
      for (const v of ["--speed", "--insp-first", "--insp-step", "--hist-first", "--hist-step"]) root.style.removeProperty(v);
      root.style.overflow = "";
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("oi-theme");
      } catch {
        /* storage unavailable: fall back to the default */
      }
      root.dataset.theme = saved === "dark" || saved === "system" ? saved : "light";
    };
  }, [ready, started, runId, speed, heroKey, historyTotal, mode, film, open, close]);

  const begin = useCallback(() => {
    setLayers([]);
    setStage("applied");
    setEmails(0);
    setChaos("off");
    setCaption(null);
    setClosing(false);
    setDone(false);
    setStarted(true);
    setRunId((n) => n + 1);
  }, []);

  const current = layers.find((l) => !l.leaving)?.id;
  const navActive = current === "pipeline" || current === "history" ? "pipeline" : "today";

  return (
    <div style={{ "--speed": speed } as CSSProperties}>
      {/* dev-only chrome has no place in a recording */}
      <style>{`nextjs-portal{display:none!important}`}</style>
      {mode === "button" ? <audio ref={audio} src={SOUNDTRACK} preload="auto" /> : null}

      <div className="presentation-root" aria-hidden={closing || (mode === "button" && !started)}>
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
              {(ready && started ? layers : []).map((layer) => (
                <section key={layer.key} className={`scene ${layer.leaving ? "scene-out" : layer.id === "today" && layer.key === 0 ? "scene-first" : "scene-in"}`}>
                  {layer.id === "today" ? todayNode : null}
                  {layer.id === "pipeline" ? (
                    <div>
                      <h1 className="t-display">Pipeline</h1>
                      <p className="t-lead mt-3 max-w-[44ch] text-ink-2">
                        {emailCount} recruiting emails, rebuilt into {opportunities.length} opportunities.
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
                          {emails} <span className="text-[1.0625rem] font-normal text-ink-2">{emails === 1 ? "email" : "emails"}</span>
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

      {chaos !== "off" ? <Chaos leaving={chaos === "out"} /> : null}

      {caption ? (
        <div className="caption" role="status" aria-live="polite">
          <span>{caption}</span>
        </div>
      ) : null}

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

      {mode === "button" && !started ? (
        <div className="idle">
          <div className="idle-line" aria-hidden>
            <Mark />
          </div>
          <h1 className="t-display">Opportunity Inbox</h1>
          <p className="t-lead mt-3 text-ink-2">Your recruiting life, organized automatically.</p>
          <button type="button" className="btn-primary mt-9" onClick={begin}>
            Play 30-second demo
          </button>
          <p className="t-meta mt-4 text-ink-3">Narrated. Turn your sound on.</p>
        </div>
      ) : null}

      <button type="button" onClick={begin} className="replay link-quiet" data-visible={done} tabIndex={done ? 0 : -1} aria-hidden={!done}>
        Replay
      </button>
    </div>
  );
}
