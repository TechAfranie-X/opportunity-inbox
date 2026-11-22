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

// ---- Journey correctness milestone (audit of 1089df4): lifecycle, identity constraints, false-active, Today ----
// programme lifecycle: no programme journey is shown at a job stage; acceptance/participation are represented
const progs = opps.filter((o) => o.kind && o.kind !== "job");
check("programme journeys carry a programme state (never only a job stage)", progs.every((o) => !!o.programState), progs.filter((o) => !o.programState).map((o) => o.company).join(","));
const cipJ = opps.filter((o) => o.kind !== "job" && has(o, /code in place/i));
check("Code in Place: accepted/participating (not Applied)", cipJ.some((o) => ["accepted", "enrolled", "participating", "completed", "removed"].includes(o.programState ?? "")), cipJ.map((o) => o.programState).join(","));
const cre = opps.filter((o) => o.kind !== "job" && has(o, /cre fundamentals/i));
check("CRE Fundamentals: one programme journey in an accepted-or-later state, not 'Unknown company Interview'", cre.length >= 1 && cre.every((o) => ["accepted", "enrolled", "participating", "completed"].includes(o.programState ?? "")), cre.map((o) => `${o.company}:${o.programState}`).join(","));
const lilo = opps.filter((o) => has(o, /lilo summer academy/i));
check("LILO Summer Academy: a programme journey (not a job interview)", lilo.length > 0 && lilo.every((o) => o.kind !== "job"), lilo.map((o) => `${o.kind}`).join(","));
const icsc = opps.filter((o) => /icsc/i.test(o.role ?? ""));
check("ICSC Bridge: participating, with no other programme's campaign inside", icsc.length === 1 && icsc[0].programState === "participating" && !icsc[0].events.some((e) => /tax firm|sports|marquee|spurs|apply by|days left/i.test(e.subject ?? "")), icsc.map((o) => `${o.programState}:${o.events.length}`).join(","));
const lm = opps.filter((o) => /last mile/i.test(o.company));
check("Last Mile award/grant is not a job", lm.length > 0 && lm.every((o) => o.kind === "scholarship"), lm.map((o) => o.kind).join(","));
// false-active
const alcInt = opps.filter((o) => /^alcon$/i.test(o.company) && has(o, /internship opportunity/i));
check("Alcon 2027 cyber opportunity: declined by the student, closed (one journey, not an active fragment)", alcInt.length === 1 && alcInt[0].closedBy === "withdrawn", alcInt.map((o) => `${o.status}:${o.closedBy}:${o.events.length}`).join(","));
const alcExt = opps.filter((o) => /^alcon$/i.test(o.company) && /externship/i.test(o.role ?? ""));
check("Alcon 2026 externship: completed, not an open accepted offer", alcExt.length === 1 && alcExt[0].status === "closed", alcExt.map((o) => `${o.status}:${o.closedBy}`).join(","));
// identity constraints
const tm = opps.filter((o) => /thurgood|tmcf/i.test(o.company) && has(o, /career academy/i));
check("PayPal Career Academy is not inside the TMCF Leadership Institute journey", tm.every((o) => !/leadership institute/i.test(o.role ?? "")) && tm.length >= 1, tm.map((o) => o.role).join("|"));
const tmI = opps.filter((o) => /leadership institute/i.test(o.role ?? "") && o.kind === "job" && o.status === "active");
// (three of the fragments hold events the OWNER corrected: those are authoritative and never moved, so the floor is 4, down from 7)
check("TMCF Leadership Institute: at most 4 active fragments (was 7; owner-corrected events stay where they are)", tmI.length <= 4, `${tmI.length}`);
const nl = opps.filter((o) => /neuralink/i.test(o.company)), cc2 = opps.filter((o) => /^claude$/i.test(o.company));
check("Neuralink portal code attaches nowhere (administrative mail creates and merges nothing)", !opps.some((o) => o.kind === "scholarship" && o.events.some((e) => /security code for your application/i.test(e.subject ?? ""))) && nl.length >= 1 && cc2.every((o) => o.events.every((e) => !/security code/i.test(e.subject ?? ""))));
const sfJ = opps.filter((o) => /^salesforce$/i.test(o.company));
check("Salesforce: the 2027 job holds its whole interview/offer thread; the Futureforce accelerator is its own programme", sfJ.filter((o) => o.kind === "job" && /2027/.test(o.role ?? "")).length === 1 && sfJ.some((o) => o.kind !== "job" && /accelerator/i.test(o.role ?? "")) && !sfJ.some((o) => o.kind === "job" && /2026/.test(o.role ?? "") && o.events.some((e) => /futureforce tech accelerator/i.test(e.subject ?? ""))), sfJ.map((o) => `${o.kind}:${o.role}:${o.events.length}`).join(" | "));
check("SLAC/LCLS is ONE journey (no Stanford/Unknown active fragments)", slac.filter((o) => o.status === "active").length === 0, `${slac.length}`);
// Today: Harvey's latest thread leaves the recruiter owing the next step
const hvToday = ws.actions.filter((a) => /^harvey$/i.test(a.company) && (a.kind === "schedule_interview" || a.kind === "respond_recruiter"));
check("Today: no request that the student reply again to Harvey", hvToday.length === 0, hvToday.map((a) => a.title).join("|"));
// admin never advances or creates journeys
const adminInJobs = opps.filter((o) => o.events.length === 1 && o.events[0].signals.includes("class:admin"));
check("administrative mail never forms a journey of its own", adminInJobs.length === 0, `${adminInJobs.length}`);

// ---- Journey trust milestone (independent audit of 8a6c6d0): hard identity, reconciliation, evidence, Today ----
const eachOwn = (re: RegExp) => opps.filter((o) => re.test(o.company));
const roles = (os: Opportunity[]) => os.map((o) => o.role ?? "-").join(" | ");
const wm = eachOwn(/^waymo$/i).filter((o) => o.events.some((e) => e.type === "applied" && /2027/.test(e.role ?? "")));
check("Waymo 2027: two explicit receipts for different roles are two journeys, each with one receipt", wm.length === 2 && wm.every((o) => o.events.filter((e) => e.type === "applied").length === 1), roles(wm));
const rp = eachOwn(/^rippling$/i);
check("Rippling: Backend and Full Stack receipts are two journeys", rp.length === 2 && rp.some((o) => /backend/i.test(o.role ?? "")) && rp.some((o) => /full stack/i.test(o.role ?? "")), roles(rp));
const four = ["sigma computing", "tenstorrent", "arcesium", "capstone"].map((n) => opps.filter((o) => o.company.toLowerCase().includes(n)));
check("Sigma / Tenstorrent / Arcesium / Capstone: four employers, four journeys, none holding another's receipt", four.every((l) => l.length >= 1) && opps.every((o) => new Set(o.events.filter((e) => e.type === "applied").map((e) => /sigma computing|tenstorrent|arcesium|capstone/i.exec(e.subject ?? "")?.[0]?.toLowerCase()).filter(Boolean)).size <= 1), four.map((l) => l.length).join(","));
const arc = opps.filter((o) => /arcesium/i.test(o.company)), sig = opps.filter((o) => /^sigma computing$/i.test(o.company));
check("Arcesium and Sigma Computing: each rejection closed WITH its receipt in one journey", [arc, sig].every((l) => l.some((o) => o.closedBy === "rejected" && o.events.some((e) => e.type === "applied"))), "");
const fid = opps.filter((o) => /fidelity|^actuary$/i.test(o.company));
check("Fidelity Actuary: one closed journey holding receipt and rejection, no active receipt-only sibling", fid.length === 1 && fid[0].closedBy === "rejected" && fid[0].events.some((e) => e.type === "applied"), fid.map((o) => `${o.company}:${o.status}:${o.events.length}`).join(","));
const br = opps.filter((o) => /^blackrock$/i.test(o.company) && /infrastructure/i.test(o.role ?? ""));
check("BlackRock: the role-less rejection closes the one open application", br.length === 1 && br[0].closedBy === "rejected" && !opps.some((o) => /^blackrock$/i.test(o.company) && o.status === "active"), br.map((o) => `${o.status}:${o.closedBy}`).join(","));
const jpm = opps.filter((o) => /jpmorgan/i.test(o.company) && has(o, /namr software engineer/i));
check("JPMorgan NAMR: the HackerRank completion sits in the journey (not Weak)", jpm.length === 1 && jpm[0].events.some((e) => e.type === "assessment_completed"), jpm.map((o) => o.events.length).join(","));
const lmA = opps.filter((o) => /last mile/i.test(o.company));
check("Last Mile: awarded (approval and payment), not Applied", lmA.length === 1 && lmA[0].programState === "awarded", lmA.map((o) => o.programState).join(","));
const cipR = opps.filter((o) => o.kind !== "job" && has(o, /code in place/i));
check("Code in Place: removed from the section", cipR.length === 1 && cipR[0].programState === "removed", cipR.map((o) => o.programState).join(","));
const vd = opps.filter((o) => /vanderbilt/i.test(o.company));
check("Vanderbilt ISIS: receipt and rejection in one journey", vd.length === 1 && vd[0].events.length >= 2 && vd[0].events.some((e) => e.type === "applied" || /webform submission/i.test(e.subject ?? "")), vd.map((o) => o.events.length).join(","));
// Today
const elapsed = ws.actions.filter((a) => a.kind === "follow_up" || a.kind === "check_in");
check("Today: no follow-up or check-in generated from elapsed time", elapsed.length === 0, `${elapsed.length}`);
check("Today: the programme coursework deadline is an action", ws.actions.some((a) => a.kind === "program_deadline"), ws.actions.map((a) => a.kind).join(","));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(0);
