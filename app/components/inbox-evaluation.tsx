"use client";

import { InboxMessageRow } from "@/app/components/inbox-messages";
import { type GmailInboxMessage } from "@/lib/gmail/inbox-message";
import {
  buildBenchmarkExport,
  computeEvaluationMetrics,
  filterEvaluationMessages,
  formatAccuracy,
  formatRate,
  GROUND_TRUTH_STORAGE_KEY,
  isBenchmarkComplete,
  nextUnlabeledMessageId,
  parseGroundTruthStore,
  previousUnlabeledMessageId,
  serializeGroundTruthStore,
  setGroundTruthLabel,
  type EvaluationFilter,
  type GroundTruthLabel,
} from "@/lib/opportunities/evaluate";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

const FILTERS: Array<{ id: EvaluationFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unlabeled", label: "Unlabeled" },
  { id: "opportunity", label: "Opportunity prediction" },
  { id: "not_opportunity", label: "Not opportunity prediction" },
  { id: "needs_review", label: "Needs review" },
  { id: "false_positives", label: "False positives" },
  { id: "false_negatives", label: "False negatives" },
  { id: "needs_review_opportunity", label: "Needs review → Opportunity" },
  { id: "needs_review_not_opportunity", label: "Needs review → Not opportunity" },
  { id: "skipped", label: "Skipped" },
];

const GROUND_TRUTH_CHANGE_EVENT = "opportunity-inbox:eval:ground-truth-change";

type HistoryEntry = {
  messageId: string;
  previous: GroundTruthLabel | undefined;
};

function subscribeToGroundTruth(onStoreChange: () => void) {
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(GROUND_TRUTH_CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(GROUND_TRUTH_CHANGE_EVENT, handler);
  };
}

function getGroundTruthSnapshot() {
  return window.localStorage.getItem(GROUND_TRUTH_STORAGE_KEY);
}

function getGroundTruthServerSnapshot() {
  return null;
}

function saveGroundTruth(store: Record<string, GroundTruthLabel>) {
  window.localStorage.setItem(
    GROUND_TRUTH_STORAGE_KEY,
    serializeGroundTruthStore(store),
  );
  window.dispatchEvent(new Event(GROUND_TRUTH_CHANGE_EVENT));
}

function Metric({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div>
      <dt className="text-zinc-500">{label}</dt>
      <dd
        className={
          emphasize
            ? "mt-0.5 text-base font-semibold text-red-800 dark:text-red-300"
            : "mt-0.5 font-medium text-zinc-800 dark:text-zinc-200"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function GroundTruthButtons({
  selected,
  onSelect,
}: {
  selected: GroundTruthLabel | undefined;
  onSelect: (label: GroundTruthLabel) => void;
}) {
  const buttonClass = (active: boolean) =>
    `rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
      active
        ? "border-zinc-800 bg-zinc-800 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900"
        : "border-zinc-300 bg-transparent text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
    }`;

  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-zinc-500">
        Ground truth (human only)
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass(selected === "opportunity")}
          aria-pressed={selected === "opportunity"}
          onClick={() => onSelect("opportunity")}
        >
          1 Opportunity
        </button>
        <button
          type="button"
          className={buttonClass(selected === "not_opportunity")}
          aria-pressed={selected === "not_opportunity"}
          onClick={() => onSelect("not_opportunity")}
        >
          2 Not opportunity
        </button>
        <button
          type="button"
          className={buttonClass(selected === "skip")}
          aria-pressed={selected === "skip"}
          onClick={() => onSelect("skip")}
        >
          3 Skip / unclear
        </button>
      </div>
    </div>
  );
}

function scrollRowIntoView(messageId: string) {
  const row = document.getElementById(`eval-row-${messageId}`);
  row?.scrollIntoView({ block: "nearest" });
}

export function InboxEvaluation({ messages }: { messages: GmailInboxMessage[] }) {
  const [filter, setFilter] = useState<EvaluationFilter>("all");
  const [blindLabeling, setBlindLabeling] = useState(true);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const storedGroundTruth = useSyncExternalStore(
    subscribeToGroundTruth,
    getGroundTruthSnapshot,
    getGroundTruthServerSnapshot,
  );
  const groundTruth = useMemo(
    () => parseGroundTruthStore(storedGroundTruth),
    [storedGroundTruth],
  );
  const resolvedActiveId =
    (activeId && messages.some((message) => message.id === activeId)
      ? activeId
      : null) ??
    nextUnlabeledMessageId(messages, groundTruth, null) ??
    messages[0]?.id ??
    null;

  const metrics = useMemo(
    () => computeEvaluationMetrics(messages, groundTruth),
    [messages, groundTruth],
  );
  const visibleMessages = useMemo(
    () => filterEvaluationMessages(messages, groundTruth, filter),
    [messages, groundTruth, filter],
  );
  const benchmarkReady = isBenchmarkComplete(metrics);

  function activate(messageId: string | null) {
    if (!messageId) {
      return;
    }
    setActiveId(messageId);
    requestAnimationFrame(() => scrollRowIntoView(messageId));
  }

  function assignGroundTruth(messageId: string, label: GroundTruthLabel) {
    setHistory((current) => [
      ...current,
      { messageId, previous: groundTruth[messageId] },
    ]);
    const nextStore = setGroundTruthLabel(groundTruth, messageId, label);
    saveGroundTruth(nextStore);
    activate(nextUnlabeledMessageId(messages, nextStore, messageId) ?? messageId);
  }

  function goToNextUnlabeled() {
    activate(nextUnlabeledMessageId(messages, groundTruth, resolvedActiveId));
  }

  function goToPreviousUnlabeled() {
    activate(previousUnlabeledMessageId(messages, groundTruth, resolvedActiveId));
  }

  function undoLastLabel() {
    const entry = history[history.length - 1];
    if (!entry) {
      return;
    }
    setHistory((current) => current.slice(0, -1));
    saveGroundTruth(
      setGroundTruthLabel(groundTruth, entry.messageId, entry.previous ?? null),
    );
    activate(entry.messageId);
  }

  function clearBenchmarkLabels() {
    const confirmed = window.confirm(
      "Clear all local benchmark labels? This cannot be undone.",
    );
    if (!confirmed) {
      return;
    }
    setHistory([]);
    saveGroundTruth({});
  }

  function exportBenchmark() {
    const payload = {
      name: "Opportunity Inbox Benchmark v1",
      exportedAt: new Date().toISOString(),
      metrics,
      rows: buildBenchmarkExport(messages, groundTruth),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "opportunity-inbox-benchmark-v1.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    function labelActive(label: GroundTruthLabel) {
      if (!resolvedActiveId) {
        return;
      }
      setHistory((current) => [
        ...current,
        { messageId: resolvedActiveId, previous: groundTruth[resolvedActiveId] },
      ]);
      const nextStore = setGroundTruthLabel(groundTruth, resolvedActiveId, label);
      saveGroundTruth(nextStore);
      const nextId =
        nextUnlabeledMessageId(messages, nextStore, resolvedActiveId) ??
        resolvedActiveId;
      setActiveId(nextId);
      requestAnimationFrame(() => scrollRowIntoView(nextId));
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable=true]")
      ) {
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        labelActive("opportunity");
      } else if (event.key === "2") {
        event.preventDefault();
        labelActive("not_opportunity");
      } else if (event.key === "3") {
        event.preventDefault();
        labelActive("skip");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [groundTruth, messages, resolvedActiveId]);

  return (
    <div className="mt-6 text-left">
      <section className="rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-zinc-500">
            Benchmark v1 (development only)
          </p>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">Blind labeling</span>
            <button
              type="button"
              aria-pressed={blindLabeling}
              onClick={() => setBlindLabeling(true)}
              className={`rounded-md px-2 py-1 font-medium ${
                blindLabeling
                  ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              On
            </button>
            <button
              type="button"
              aria-pressed={!blindLabeling}
              onClick={() => setBlindLabeling(false)}
              className={`rounded-md px-2 py-1 font-medium ${
                !blindLabeling
                  ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              Off
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {metrics.labeled} / {metrics.total} labeled
        </p>
        <p className="text-xs text-zinc-500">
          {metrics.unlabeled} remaining
          {metrics.skipped > 0 ? ` · ${metrics.skipped} skipped` : ""}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Keys: 1 Opportunity · 2 Not opportunity · 3 Skip / unclear. Classifier
          badges are predictions only and never prefill ground truth.
          {blindLabeling
            ? " Blind mode hides predictions on unlabeled messages."
            : ""}
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
          <Metric label="Total messages" value={String(metrics.total)} />
          <Metric label="Manually labeled" value={String(metrics.labeled)} />
          <Metric label="Remaining unlabeled" value={String(metrics.unlabeled)} />
          <Metric label="Skipped / unclear" value={String(metrics.skipped)} />
          <Metric
            label="Opportunity ground truth"
            value={String(metrics.opportunityGroundTruth)}
          />
          <Metric
            label="Not-opportunity ground truth"
            value={String(metrics.notOpportunityGroundTruth)}
          />
          <Metric
            label="Auto-resolution rate"
            value={formatRate(metrics.autoResolutionRate)}
          />
          <Metric
            label="Needs review / escalation"
            value={formatRate(metrics.escalationRate)}
          />
          <Metric label="True positives" value={String(metrics.truePositives)} />
          <Metric label="True negatives" value={String(metrics.trueNegatives)} />
          <Metric label="False positives" value={String(metrics.falsePositives)} />
          <Metric
            label="False negatives"
            value={String(metrics.falseNegatives)}
            emphasize
          />
        </dl>
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          Among auto-resolved labeled messages: accuracy{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {formatAccuracy(metrics.accuracy)}
          </span>
          {" · "}
          opportunity precision{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {formatAccuracy(metrics.precision)}
          </span>
          {" · "}
          opportunity recall{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {formatAccuracy(metrics.recall)}
          </span>
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div
            className={`rounded-md border px-3 py-2 ${
              metrics.missedOpportunities > 0
                ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40"
            }`}
          >
            <p
              className={`text-sm font-semibold ${
                metrics.missedOpportunities > 0
                  ? "text-red-800 dark:text-red-300"
                  : "text-zinc-700 dark:text-zinc-300"
              }`}
            >
              Missed opportunities: {metrics.missedOpportunities}
            </p>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              Ground truth Opportunity, classifier Not opportunity.
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              False opportunities: {metrics.falseOpportunities}
            </p>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              Ground truth Not opportunity, classifier Opportunity.
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Needs review: {metrics.needsReview}
          </p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Human ground truth: {metrics.needsReviewOpportunity} Opportunity ·{" "}
            {metrics.needsReviewNotOpportunity} Not opportunity ·{" "}
            {metrics.needsReviewSkipped} skipped
          </p>
        </div>

        {benchmarkReady ? (
          <div className="mt-3 rounded-md border border-zinc-300 px-3 py-3 dark:border-zinc-700">
            <p className="text-sm font-semibold">Benchmark v1</p>
            <dl className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              <div>Messages: {metrics.total}</div>
              <div>Labeled: {metrics.labeled}</div>
              <div>Skipped: {metrics.skipped}</div>
              <div>
                Deterministic auto-resolution:{" "}
                {formatRate(metrics.autoResolutionRate)}
              </div>
              <div>Needs review: {formatRate(metrics.escalationRate)}</div>
              <div>Among auto-resolved: accuracy {formatAccuracy(metrics.accuracy)}</div>
              <div>
                Opportunity precision: {formatAccuracy(metrics.precision)}
              </div>
              <div>Opportunity recall: {formatAccuracy(metrics.recall)}</div>
              <div>False positives: {metrics.falsePositives}</div>
              <div>False negatives: {metrics.falseNegatives}</div>
              <div>Missed opportunities: {metrics.missedOpportunities}</div>
              <div>
                Needs review breakdown: {metrics.needsReviewOpportunity}{" "}
                actually opportunity · {metrics.needsReviewNotOpportunity}{" "}
                actually noise
              </div>
            </dl>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={goToPreviousUnlabeled}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Previous unlabeled
          </button>
          <button
            type="button"
            onClick={goToNextUnlabeled}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Next unlabeled
          </button>
          <button
            type="button"
            onClick={undoLastLabel}
            disabled={history.length === 0}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Undo last label
          </button>
          <button
            type="button"
            onClick={exportBenchmark}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Export benchmark
          </button>
          <button
            type="button"
            onClick={clearBenchmarkLabels}
            className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            Clear benchmark labels
          </button>
        </div>
      </section>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((item) => {
          const active = filter === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(item.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {visibleMessages.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">
          {messages.length === 0
            ? "No messages in INBOX."
            : "No messages match this filter."}
        </p>
      ) : (
        <ul className="mt-6 w-full space-y-3">
          {visibleMessages.map((message) => (
            <InboxMessageRow
              key={message.id}
              message={message}
              active={message.id === resolvedActiveId}
              hideClassifier={
                blindLabeling && groundTruth[message.id] === undefined
              }
              onActivate={() => activate(message.id)}
            >
              <GroundTruthButtons
                selected={groundTruth[message.id]}
                onSelect={(label) => assignGroundTruth(message.id, label)}
              />
            </InboxMessageRow>
          ))}
        </ul>
      )}
    </div>
  );
}
