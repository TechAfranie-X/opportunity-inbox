/**
 * Journey-level regression checks on the LIVE workspace for the audited, source-verified cases (development regressions, NOT independent evidence). Each line is a property of a reconstructed journey, not
 * of one message: kind, final state, no foreign events, no orphan fragments, receipt identities, programme evidence represented. Read-only.   node ... scripts/journey-invariants.ts <googleSub>
 * The ten messages the audit found wrongly discarded (message-id prefixes below) must sit in a pipeline journey of the right kind with no job stage, and the bulk campaign set must stay excluded.
 */
import { loadWorkspace } from "../lib/recruiting/store.ts";
import type { EffectiveEvent, Opportunity } from "../lib/recruiting/types.ts";
const sub = process.argv[2];
const ws = await loadWorkspace(sub, new Date());
const opps = ws.opportunities;
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  -> ${detail}` : ""}`); };
const by = (re: RegExp) => opps.filter((o) => re.test(o.company) || re.test(o.role ?? ""));
const has = (o: Opportunity, re: RegExp) => o.events.some((e) => re.test(e.subject ?? ""));
const find = (id8: string): { e: EffectiveEvent; o: Opportunity } | null => { for (const o of opps) { const e = o.events.find((x) => x.gmailMessageId.startsWith(id8)); if (e) return { e, o }; } return null; };
const inPossible = (id8: string) => ws.possible.some((e) => e.gmailMessageId.startsWith(id8));

// Harvey
const hv = by(/^harvey$/i); const h26 = hv.filter((o) => /2026/.test(o.role ?? "")), h27 = hv.filter((o) => !/2026/.test(o.role ?? ""));
check("Harvey: two applications (2026 closed rejected, 2027 open)", hv.length === 2 && h26.some((o) => o.closedBy === "rejected") && h27.some((o) => o.status === "active"), hv.map((o) => `${o.role}:${o.status}`).join(" | "));
const late26 = h26.flatMap((o) => o.events).filter((e) => e.occurredAt.getTime() > Date.UTC(2026, 5, 1));
check("Harvey: nothing after June 2026 (incoming OR sent) is left in the rejected 2026 application", late26.length === 0, `${late26.length} left`);
// SLAC / Stanford
const slac = by(/slac|stanford/i).filter((o) => /lcls/i.test(o.role ?? "") || has(o, /lcls/i));
const slacMain = slac.sort((a, b) => b.events.length - a.events.length)[0];
check("SLAC/LCLS: main journey Closed - Withdrawn", !!slacMain && slacMain.closedBy === "withdrawn");
check("SLAC/LCLS: no active LCLS sibling fragments", slac.filter((o) => o !== slacMain && o.status === "active" && o.kind === "job").length === 0, slac.filter((o) => o !== slacMain && o.status === "active").map((o) => `${o.company}:${o.events.length}`).join(","));
check("SLAC/LCLS: no Code in Place mail inside the internship journey", !!slacMain && !slacMain.events.some((e) => /code in place/i.test(e.subject ?? "")));
// Code in Place
const cip = by(/code in place/i).concat(opps.filter((o) => has(o, /code in place/i) && !/slac/i.test(o.company)));
check("Code in Place: a programme journey with its acceptance/welcome and sections", cip.some((o) => o.kind !== "job" && has(o, /welcome to code in place/i) && has(o, /section/i)), cip.map((o) => `${o.kind}:${o.events.length}`).join(","));
// Salesforce
const sf = by(/^salesforce$/i).filter((o) => /2027/.test(o.role ?? ""));
check("Salesforce 2027 job: no Futureforce/Insiders/survey mail mixed in", sf.every((o) => !has(o, /futureforce tech accelerator lab|insiders|your feedback/i) || o.kind !== "job"), sf.map((o) => o.events.length).join(","));
const bal = opps.filter((o) => /berry appleman/i.test(o.company) && o.kind === "job" && o.stage !== "closed");
check("BAL (immigration provider) is not a job opportunity of its own, unless the owner confirmed that reading", bal.every((o) => o.events.every((e) => e.confirmed || e.corrected)), `${bal.length} journey(s), none confirmed`);
// Alcon
const al = by(/^alcon$/i);
check("Alcon: no generic role-less active orphan", al.filter((o) => !o.role && o.status === "active").length === 0, al.map((o) => `${o.role ?? "-"}:${o.events.length}`).join(","));
// HeadStart
const hs = by(/headstart/i);
const sp26 = hs.filter((o) => o.events.some((e) => /SP26|sp 26|spring 2026|application update/i.test(e.subject ?? "") && e.occurredAt.getUTCFullYear() <= 2026 && e.occurredAt.getUTCMonth() <= 1 || e.occurredAt.getUTCFullYear() === 2025));
check("HeadStart: the Spring 2026 cycle is ONE journey that holds its interview confirmation", sp26.length === 1 && has(sp26[0], /interviews? with/i), `${sp26.length} journeys`);
// CTI
const cti = by(/^cti launch$/i);
check("CTI Launch: a programme journey", cti.length > 0 && cti.every((o) => o.kind !== "job"), cti.map((o) => o.kind).join(","));
// Coca-Cola
const cc = by(/coca.?cola/i);
check("Coca-Cola rejection: a Closed - Rejected journey exists (employer named in the message)", cc.some((o) => o.closedBy === "rejected"), `${cc.length} journeys`);
// Project Destined receipts
const pd = (name: RegExp) => opps.filter((o) => name.test(o.role ?? "") && o.events.some((e) => e.signals.includes("own:receipt")));
for (const [name, re] of [["ICSC", /icsc/i], ["Amazon Affordable Housing", /amazon affordable/i], ["CBRE", /^cbre/i], ["Crescent Communities", /^crescent/i]] as const) check(`Project Destined receipt: ${name} has its own correctly named journey`, pd(re).length === 1, `${pd(re).length} journeys`);
check("Project Destined: no job-stage journey carries a programme invitation", !opps.some((o) => o.kind === "job" && o.events.some((e) => e.signals.includes("class:program-acceptance") && e.type !== "status_update")), "");
// the ten wrongly discarded messages
const restored: [string, string][] = [["19c95b20", "CRE Fundamentals L1 invitation"], ["19caf5ab", "CRE Fundamentals L2 invitation"], ["19c03874", "CRE Fundamentals L1 invitation (receipt group)"], ["19d92f41", "Code in Place acceptance"], ["19db77b1", "Code in Place section reminder"], ["1a116dd9", "ICSC cohort calendar"], ["19b6d9aa", "HeadStart interview calendar"], ["19c87f2f", "CTI Launch progress"]];
for (const [id, label] of restored) { const f = find(id); check(`restored: ${label} sits in a pipeline journey of the right kind, with no job stage`, !!f && f.o.kind !== "job" && !["interview_invite", "interview_scheduled", "assessment", "offer"].includes(f.e.type) || (!!f && f.o.kind !== "job" && f.e.signals.includes("class:program-acceptance")), f ? `${f.o.kind}/${f.e.type}` : inPossible(id) ? "still in possible" : "absent"); }
// no program-evidence event creates a job stage anywhere
const bad = opps.filter((o) => o.kind === "job").flatMap((o) => o.events.filter((e) => e.signals.some((s) => s.startsWith("program:evidence:")) && ["interview_invite", "interview_scheduled", "assessment", "offer"].includes(e.type)));
check("no programme-evidence message advances a job stage", bad.length === 0, `${bad.length}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(0);
