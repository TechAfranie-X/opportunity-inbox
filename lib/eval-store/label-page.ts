import { EVENT_TYPES, STAGES, type RecruitingEmail } from "../recruiting/types.ts";
import { parseLabelsJsonl, type LabelInput } from "./labels-io.ts";
import type { DatasetKind } from "../recruiting/ground-truth.ts";

/**
 * Pure rendering and parsing for the local labeling page. It knows about messages and labels and nothing else:
 * no extractor, no predictions, no evaluator. (A test scans this file and the server for forbidden imports.)
 */

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type ThreadItem = { from: string; subject: string; receivedAt: Date; outbound: boolean; bodyText: string };
export type Existing = Partial<Record<string, unknown>>;

const STYLE = `
:root{color-scheme:light dark;--bg:#f8f6f2;--ink:#1b1a18;--ink2:#5a564f;--line:rgba(27,26,24,.14);--card:#fff;--accent:#1f6e6b}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--ink:#ece9e3;--ink2:#a39e94;--line:rgba(236,233,227,.16);--card:#1f1e1b;--accent:#5fb3ae}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,system-ui,sans-serif}
main{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:28px;max-width:1280px;margin:0 auto;padding:24px}
@media (max-width:900px){main{grid-template-columns:1fr}}
h1{font-size:15px;font-weight:600;margin:0 0 4px}.meta{color:var(--ink2);font-size:13px}
pre{white-space:pre-wrap;word-break:break-word;font:13.5px/1.55 ui-monospace,Menlo,monospace;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;max-height:62vh;overflow:auto}
.ctx{margin-top:14px;font-size:13px;color:var(--ink2)}.ctx details{margin:6px 0}
form{position:sticky;top:16px;align-self:start;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
fieldset{border:0;margin:0 0 14px;padding:0}legend,label.f{display:block;font-size:12.5px;color:var(--ink2);margin-bottom:4px}
select,input[type=text],input[type=date]{width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit}
.row{display:flex;gap:14px;flex-wrap:wrap}.row label{font-size:14px}
.bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:13px;color:var(--ink2)}
button{font:inherit;padding:8px 14px;border-radius:7px;border:1px solid var(--line);background:var(--ink);color:var(--bg);cursor:pointer}button.alt{background:transparent;color:var(--ink)}
.err{color:#b3261e;font-size:13px;margin-bottom:8px}.note{font-size:12.5px;color:var(--ink2);margin-top:10px}
`;

const opt = (values: readonly string[], selected?: unknown) => values.map((v) => `<option value="${esc(v)}"${selected === v ? " selected" : ""}>${esc(v.replace(/_/g, " "))}</option>`).join("");
const radio = (name: string, choices: Array<[string, string]>, current: string) =>
  choices.map(([v, label]) => `<label><input type="radio" name="${name}" value="${v}"${current === v ? " checked" : ""}> ${esc(label)}</label>`).join(" ");

export function renderPage(opts: {
  token: string; index: number; total: number; labeled: number; dataset: string; kind: DatasetKind; asOf: string;
  message: RecruitingEmail; thread: ThreadItem[]; existing: Existing; refs: string[]; error?: string;
}) {
  const { message: m, existing: e } = opts;
  const rec = e.is_recruiting === true ? "yes" : e.is_recruiting === false ? "no" : "";
  const company = typeof e.company === "string" ? e.company : "";
  const roleVal = typeof e.role === "string" ? e.role : "";
  const roleMode = e.role === "unknown" ? "unknown" : e.role === "not_applicable" ? "na" : roleVal ? "value" : "";
  const dateVal = typeof e.event_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(e.event_date) ? e.event_date.slice(0, 10) : "";
  const dateMode = e.event_date === "unknown" ? "unknown" : e.event_date === "not_applicable" ? "na" : dateVal ? "value" : "";
  const body = m.bodyText.length > 20000 ? `${m.bodyText.slice(0, 20000)}\n\n[truncated for display]` : m.bodyText;
  const thread = opts.thread
    .map((t) => `<details><summary>${t.outbound ? "You" : esc(t.from)} · ${esc(t.subject)} · ${esc(t.receivedAt.toISOString().slice(0, 10))}</summary><pre>${esc(t.outbound ? "(your reply; text not kept)" : t.bodyText.slice(0, 4000))}</pre></details>`)
    .join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Label ${opts.index + 1} of ${opts.total}</title><style>${STYLE}</style>
<main>
<section>
  <div class="bar"><span>${esc(opts.dataset)} (${esc(opts.kind)}) · message ${opts.index + 1} of ${opts.total} · ${opts.labeled} labeled</span><span>
    ${opts.index > 0 ? `<a href="/m/${opts.index - 1}?t=${opts.token}">prev</a> · ` : ""}${opts.index + 1 < opts.total ? `<a href="/m/${opts.index + 1}?t=${opts.token}">skip</a>` : ""}</span></div>
  <h1>${esc(m.subject || "(no subject)")}</h1>
  <div class="meta">From ${esc(m.from)} · ${esc(m.receivedAt.toISOString().replace("T", " ").slice(0, 16))} UTC</div>
  <pre>${esc(body)}</pre>
  ${thread ? `<div class="ctx">Other messages in this thread (context only, not labeled):${thread}</div>` : ""}
</section>
<form method="post" action="/m/${opts.index}?t=${opts.token}">
  ${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ""}
  <fieldset><legend>Is this message recruiting activity for the reader?</legend><div class="row">${radio("recruiting", [["yes", "Yes"], ["no", "No"]], rec)}</div></fieldset>
  <div id="detail">
  <fieldset><legend>Event type</legend><select name="type"><option value="">choose…</option><option value="unknown"${e.type === "unknown" ? " selected" : ""}>unknown (cannot tell)</option>${opt(EVENT_TYPES, e.type)}</select></fieldset>
  <fieldset><legend>Employer (the company the opportunity is with; never the ATS or platform)</legend>
    <input type="text" name="company" value="${esc(company === "unknown" ? "" : company)}" maxlength="120"> <label><input type="checkbox" name="company_unknown" value="1"${company === "unknown" ? " checked" : ""}> cannot tell</label></fieldset>
  <fieldset><legend>Role</legend><input type="text" name="role" value="${esc(roleVal === "unknown" || roleVal === "not_applicable" ? "" : roleVal)}" maxlength="160">
    <div class="row">${radio("role_mode", [["value", "as typed"], ["na", "none stated"], ["unknown", "cannot tell"]], roleMode)}</div></fieldset>
  <fieldset><legend>Opportunity (same value = same application; any short id you choose, reuse it across messages)</legend>
    <input type="text" name="opportunity_ref" list="refs" value="${esc(typeof e.opportunity_ref === "string" ? e.opportunity_ref : "")}" maxlength="64"><datalist id="refs">${opts.refs.map((r) => `<option value="${esc(r)}">`).join("")}</datalist></fieldset>
  <fieldset><legend>Stage of the opportunity after this message</legend><select name="stage"><option value="unknown">unknown</option>${opt(STAGES, e.stage)}</select></fieldset>
  <fieldset><legend>Deadline or scheduled time stated in this message (as of ${esc(opts.asOf.slice(0, 10))})</legend>
    <input type="date" name="event_date" value="${esc(dateVal)}">
    <div class="row">${radio("date_mode", [["value", "date above"], ["na", "none stated"], ["unknown", "cannot tell"]], dateMode)}</div></fieldset>
  <fieldset><legend>Does this message need the reader to act?</legend><div class="row">${radio("actionable", [["yes", "Yes"], ["no", "No"]], e.actionable === true ? "yes" : e.actionable === false ? "no" : "")}</div>
    <label class="f" style="margin-top:8px">How soon, as of ${esc(opts.asOf.slice(0, 10))}</label><select name="urgency"><option value="">choose…</option>${opt(["today", "soon", "none"], e.urgency)}</select></fieldset>
  </div>
  <div class="row"><button type="submit">Save and next unlabeled</button><button type="submit" class="alt" name="skip" value="1" formnovalidate>Skip for now</button></div>
  <div class="note">No predictions are loaded in this tool. Leave anything you genuinely cannot determine as “cannot tell”.</div>
</form>
</main>
<script>
const f=document.querySelector("form"),d=document.getElementById("detail");
function sync(){const v=f.recruiting.value;d.style.display=v==="no"?"none":"block"}f.addEventListener("change",sync);sync();
</script></html>`;
}

/** Turn a submitted form into validated label rows, or an error message for the labeler. */
export function formToLabels(
  form: URLSearchParams,
  ctx: { kind: DatasetKind; messageId: string; labeler: string },
): { rows: LabelInput[] } | { error: string } | { skip: true } {
  if (form.get("skip")) return { skip: true };
  const rec = form.get("recruiting");
  if (rec !== "yes" && rec !== "no") return { error: "Choose whether this is recruiting activity." };
  const out: Array<{ field: string; value: unknown }> = [{ field: "is_recruiting", value: rec === "yes" }];
  if (rec === "yes") {
    const type = form.get("type") ?? "";
    if (!type) return { error: "Choose an event type (or “unknown”)." };
    out.push({ field: "type", value: type });
    const company = (form.get("company") ?? "").trim();
    if (form.get("company_unknown")) out.push({ field: "company", value: "unknown" });
    else if (company) out.push({ field: "company", value: company });
    else return { error: "Enter the employer, or tick “cannot tell”." };
    const roleMode = form.get("role_mode") ?? "";
    const role = (form.get("role") ?? "").trim();
    if (roleMode === "na") out.push({ field: "role", value: "not_applicable" });
    else if (roleMode === "unknown") out.push({ field: "role", value: "unknown" });
    else if (roleMode === "value" && role) out.push({ field: "role", value: role });
    else return { error: "Say what the role is, or that none is stated, or that you cannot tell." };
    const ref = (form.get("opportunity_ref") ?? "").trim();
    if (!ref) return { error: "Give this message an opportunity id (reuse it for the same application)." };
    out.push({ field: "opportunity_ref", value: ref });
    out.push({ field: "stage", value: form.get("stage") || "unknown" });
    const dateMode = form.get("date_mode") ?? "";
    const date = (form.get("event_date") ?? "").trim();
    if (dateMode === "na") out.push({ field: "event_date", value: "not_applicable" });
    else if (dateMode === "unknown") out.push({ field: "event_date", value: "unknown" });
    else if (dateMode === "value" && date) out.push({ field: "event_date", value: date });
    else return { error: "Give the date, or say none is stated, or that you cannot tell." };
    const actionable = form.get("actionable");
    if (actionable !== "yes" && actionable !== "no") return { error: "Say whether the reader needs to act." };
    out.push({ field: "actionable", value: actionable === "yes" });
    const urgency = form.get("urgency") ?? "";
    if (!urgency) return { error: "Choose how soon (or “none”)." };
    out.push({ field: "urgency", value: urgency });
  }
  const text = out.map((o) => JSON.stringify({ gmailMessageId: ctx.messageId, ...o, labeler: ctx.labeler })).join("\n");
  const parsed = parseLabelsJsonl(text, { kind: ctx.kind, memberIds: new Set([ctx.messageId]), defaultLabeler: ctx.labeler });
  if (parsed.errors.length > 0) return { error: parsed.errors[0].replace(/^line \d+: /, "") };
  return { rows: parsed.rows };
}
