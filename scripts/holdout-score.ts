/**
 * Scores reader A (production input) against reader B (context-separated) on the frozen holdout.
 *   node ... scripts/holdout-score.ts <googleSub> [--labels holdout-labels.json]
 * With --labels (an INDEPENDENT evaluator's blind labels from the review sheet) the scores are evidence. Without them, a PROVISIONAL reference is used for the messages that have one (the owner's own
 * correction, or a deterministic fact that needs no model); that is a development diagnostic and can never support promotion. Reports false offers and false terminal outcomes explicitly.
 * Promotion rule (printed): needs independent labels for >= 100 messages, B no worse than A on false offers AND false terminal outcomes, and B better overall by a margin.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { getGmailRefreshToken } from "../lib/gmail/credentials.ts";
import { refreshGmailAccessToken } from "../lib/gmail/oauth.ts";
import { fetchEmailsById } from "../lib/gmail/recruiting-source.ts";
import { loadWorkspace } from "../lib/recruiting/store.ts";
import { endingWording, ownApplicationStatement, ownEnding, withdrawalAcknowledged } from "../lib/reliability/evidence.ts";
import { messageClass } from "../lib/reliability/message-class.ts";
const sub = process.argv[2]; const dir = `${homedir()}/.opportunity-inbox-validation/holdout-v1`;
const draw = JSON.parse(readFileSync(`${dir}/draw.json`, "utf8")) as { items: { id: string; stratum: string }[] };
const rd = JSON.parse(readFileSync(`${homedir()}/.opportunity-inbox-sealed/holdout-readings.json`, "utf8")) as { drawHash: string; A: Record<string, R>; B: Record<string, R> };
type R = { status: string; recruiting: boolean; type: string | null; certainty: string };
if (rd.drawHash !== createHash("sha256").update(readFileSync(`${dir}/draw.json`, "utf8")).digest("hex")) { console.error("REFUSED: readings were made for a different draw"); process.exit(2); }
const labelsFile = process.argv.includes("--labels") ? process.argv[process.argv.indexOf("--labels") + 1] : null;
type Lab = { rec: boolean | null; types: string[] | null; kind: string };
const LABEL_TYPE: Record<string, string[]> = { "applied (application receipt)": ["applied"], "applied (receipt)": ["applied"], assessment: ["assessment"], interview_invite: ["interview_invite"], interview_scheduled: ["interview_scheduled", "interview_invite"], "job offer": ["offer"], "program or fellowship acceptance": ["status_update", "offer"], rejection: ["rejection"], withdrawn: ["withdrawn"], "other message inside the process": ["status_update", "applied", "recruiter_outreach"] };
const ref = new Map<string, Lab>();
if (labelsFile) {
  const L = JSON.parse(readFileSync(labelsFile, "utf8")) as { drawHash: string; labels: { id: string; recruiting: string; type: string }[] };
  if (L.drawHash !== createHash("sha256").update(readFileSync(`${dir}/draw.json`, "utf8")).digest("hex")) { console.error("REFUSED: labels were made against a different draw"); process.exit(2); }
  const unmapped = L.labels.filter((l) => l.recruiting && l.recruiting !== "unsure" && l.recruiting !== "no" && !l.type.startsWith("not part") && !LABEL_TYPE[l.type]);
  // a label the scorer cannot map must never vanish silently (seven receipts once did, from one vocabulary mismatch): refuse to score until every label is mapped
  if (unmapped.length > 0) { console.error(`REFUSED: ${unmapped.length} labels have a type the scorer does not know: ${[...new Set(unmapped.map((l) => l.type))].join(" | ")}`); process.exit(2); }
  for (const l of L.labels) { if (!l.recruiting || l.recruiting === "unsure") continue; if (l.recruiting === "no" || l.type.startsWith("not part")) ref.set(l.id, { rec: false, types: null, kind: "independent" }); else if (LABEL_TYPE[l.type]) ref.set(l.id, { rec: true, types: LABEL_TYPE[l.type], kind: "independent" }); }
} else {
  const ws = await loadWorkspace(sub, new Date());
  const corrected = new Map(ws.opportunities.flatMap((o) => o.events.filter((e) => e.corrected || e.confirmed).map((e) => [e.gmailMessageId, e.type] as const)));
  const token = await refreshGmailAccessToken((await getGmailRefreshToken(sub))!);
  const emails: Awaited<ReturnType<typeof fetchEmailsById>>["emails"] = [];
  for (let i = 0; i < draw.items.length; i += 20) emails.push(...(await fetchEmailsById(token, draw.items.slice(i, i + 20).map((x) => x.id))).emails);
  for (const m of emails) {
    if (corrected.has(m.id)) { ref.set(m.id, { rec: true, types: [corrected.get(m.id)!], kind: "person" }); continue; }
    const c = messageClass(m);
    if (c && c !== "program-acceptance") ref.set(m.id, { rec: false, types: null, kind: `class:${c}` });
    else if (withdrawalAcknowledged(m)) ref.set(m.id, { rec: true, types: ["withdrawn", "status_update"], kind: "fact:withdrawal" });
    else if (ownEnding(m)) ref.set(m.id, { rec: true, types: ["rejection"], kind: "fact:own-ending" });
    else if (ownApplicationStatement(m) && !endingWording(m)) ref.set(m.id, { rec: true, types: ["applied", "status_update", "assessment", "interview_invite", "interview_scheduled", "recruiter_outreach"], kind: "fact:receipt-no-ending" });
  }
}
const pred = (r: R | undefined) => (r && r.status === "ok" && r.certainty !== "low" ? { rec: r.recruiting, type: r.recruiting ? r.type : null } : { rec: false, type: null });
const ok = (l: Lab, p: { rec: boolean; type: string | null }) => (l.rec === false ? !p.rec : p.rec && !!p.type && (l.types ?? []).includes(p.type));
const stat = { A: { n: 0, ok: 0, falseOffer: 0, programAsOffer: 0, falseTerminal: 0, missedTerminal: 0, missedOffer: 0, offers: 0, terminals: 0 }, B: { n: 0, ok: 0, falseOffer: 0, programAsOffer: 0, falseTerminal: 0, missedTerminal: 0, missedOffer: 0, offers: 0, terminals: 0 } };
const strat = new Map<string, { n: number; A: number; B: number }>(); const errs: string[] = [];
for (const it of draw.items) {
  const l = ref.get(it.id); if (!l) continue;
  const pa = pred(rd.A[it.id]), pb = pred(rd.B[it.id]);
  const labelOffer = !!l.types?.includes("offer") && l.types.length === 1, labelTerm = !!l.types && l.types.every((t) => t === "rejection" || t === "withdrawn");
  for (const [k, p] of [["A", pa], ["B", pb]] as const) {
    const s = stat[k]; s.n++; if (ok(l, p)) s.ok++;
    // an EMPLOYMENT offer is a job offer; a programme selection may carry the offer type in the reader but is counted apart (programme acceptance is not a job offer)
    const programLabel = !!l.types?.includes("offer") && l.types.length > 1;
    if (p.type === "offer" && !l.types?.includes("offer")) s.falseOffer++;
    if (p.type === "offer" && programLabel) s.programAsOffer++;
    if (labelOffer) s.offers++;
    if (labelTerm) s.terminals++;
    if ((p.type === "rejection" || p.type === "withdrawn") && !labelTerm) s.falseTerminal++;
    if (labelOffer && p.type !== "offer") s.missedOffer++;
    if (labelTerm && !(p.type === "rejection" || p.type === "withdrawn")) s.missedTerminal++;
  }
  const g = strat.get(it.stratum) ?? { n: 0, A: 0, B: 0 }; g.n++; if (ok(l, pa)) g.A++; if (ok(l, pb)) g.B++; strat.set(it.stratum, g);
  if (ok(l, pa) !== ok(l, pb)) errs.push(`${ok(l, pb) ? "B-fixes" : "B-breaks"} ${it.id.slice(0, 8)} stratum=${it.stratum} ref=${l.kind} A=${pa.rec ? pa.type : "no"} B=${pb.rec ? pb.type : "no"}`);
}
const independent = !!labelsFile;
const marker = `${dir}/.assessed`;
if (independent) { if (existsSync(marker)) console.log(`NOTE: the initial independent assessment was already made (${readFileSync(marker, "utf8").trim()}); this holdout is now DEVELOPMENT data and must not support further claims.`); else writeFileSync(marker, new Date().toISOString()); }
console.log(`${independent ? "INDEPENDENT labels" : "PROVISIONAL references (person corrections and deterministic facts; NOT independent)"}: ${stat.A.n} of ${draw.items.length} messages scored`);
for (const k of ["A", "B"] as const) { const s = stat[k]; console.log(`  reader ${k}: correct ${s.ok}/${s.n}  FALSE OFFERS ${s.falseOffer}  programme acceptance typed as offer ${s.programAsOffer}  FALSE TERMINAL ${s.falseTerminal}  missed offers ${s.missedOffer}  missed terminal ${s.missedTerminal}`); }
for (const [k, v] of strat) console.log(`   ${k.padEnd(24)} n=${String(v.n).padStart(3)}  A ${v.A}  B ${v.B}`);
for (const e of errs) console.log(e);
const better = stat.B.ok - stat.A.ok, guard = stat.B.falseOffer <= stat.A.falseOffer && stat.B.falseTerminal <= stat.A.falseTerminal;
// ABSOLUTE floors (a relative gain over a poor reader is not a reason to promote it): exact decisions, no semantic false job offer or false ending, every job offer found, endings found
const exact = stat.B.n ? stat.B.ok / stat.B.n : 0, offerRecall = stat.B.offers ? 1 - stat.B.missedOffer / stat.B.offers : 1, endRecall = stat.B.terminals ? 1 - stat.B.missedTerminal / stat.B.terminals : 1;
const floors = exact >= 0.85 && stat.B.falseOffer === 0 && stat.B.falseTerminal === 0 && offerRecall === 1 && endRecall >= 0.9;
const failed = [exact < 0.85 ? `exact ${(exact * 100).toFixed(1)}% < 85%` : "", stat.B.falseOffer > 0 ? `${stat.B.falseOffer} false job offers` : "", stat.B.falseTerminal > 0 ? `${stat.B.falseTerminal} false terminal outcomes` : "", offerRecall < 1 ? `job-offer recall ${(offerRecall * 100).toFixed(0)}% < 100%` : "", endRecall < 0.9 ? `ending recall ${(endRecall * 100).toFixed(0)}% < 90%` : ""].filter(Boolean);
console.log(`PROMOTION: ${independent && stat.A.n >= 100 && guard && better >= 5 && floors ? "evidence supports READER_INPUT=parts for new mail (still shadow-confirm)" : `NOT PROMOTED (${independent ? "" : "no independent labels; "}${stat.A.n < 100 ? `only ${stat.A.n} labelled; ` : ""}${guard ? "" : "B is worse on false offers or false terminal outcomes; "}${better < 5 ? `gain ${better} < 5; ` : ""}${failed.length ? `absolute floors failed: ${failed.join(", ")}` : ""})`}`);
process.exit(0);
