/**
 * End-to-end check of the signed-in product against a SCRATCH Postgres database, using the synthetic sample mailbox.
 * Run:  npm run e2e:sample      (creates scratch_mvp_e2e, migrates, runs, drops it). Refuses any database not named scratch_*.
 *       DISCOVERY=sweep npm run e2e:sample   the same journey with recall-first discovery (lib/discovery/strategy.ts).
 *       DB_CONTAINER=<name> if the Postgres container is not called opportunity-inbox-db-1.
 * Never touches the real database or Gmail.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL is required (it is only used to reach the server; the scratch database is separate)");
const SCRATCH = "scratch_mvp_e2e";
const CONTAINER = process.env.DB_CONTAINER ?? "opportunity-inbox-db-1";
const SWEEP = process.env.DISCOVERY === "sweep";
const url = new URL(base);
const admin = new URL(base);
url.pathname = `/${SCRATCH}`;
assert.ok(url.pathname.slice(1).startsWith("scratch_"), "refusing to run outside a scratch database");

const psql = (db: string, sql: string) =>
  execFileSync("docker", ["exec", CONTAINER, "psql", "-U", decodeURIComponent(admin.username), "-d", db, "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: ["ignore", "pipe", "pipe"] });

psql("postgres", `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
psql("postgres", `CREATE DATABASE ${SCRATCH}`);
try {
  execFileSync("npx", ["drizzle-kit", "migrate"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "ignore" });
  process.env.DATABASE_URL = url.toString();
  process.env.SAMPLE_LOGIN = "1";

  const { SAMPLE_SUB, SAMPLE_EMAIL } = await import("../lib/gmail/sample.ts");
  const { saveGmailConnection, findGmailConnection } = await import("../lib/gmail/credentials.ts");
  const { syncRecruitingMail } = await import("../lib/recruiting/sync.ts");
  const store = await import("../lib/recruiting/store.ts");
  const { buildBriefing } = await import("../lib/recruiting/briefing.ts");
  const { buildReviewQueue, attentionCount } = await import("../lib/recruiting/review.ts");
  const { toFloating } = await import("../lib/recruiting/actions.ts");
  const step = (name: string) => console.log("ok -", name);

  // 1. connect the sample mailbox (what the landing button does)
  await saveGmailConnection({ userGoogleSub: SAMPLE_SUB, gmailEmail: SAMPLE_EMAIL, refreshToken: "sample", scope: "sample" });
  assert.ok(await findGmailConnection(SAMPLE_SUB));
  step("sample connection seeded");

  // 2. first sync, with a small budget request loop like the browser's auto-continue
  let result = await syncRecruitingMail(SAMPLE_SUB);
  assert.equal(result.ok, true);
  for (let i = 0; i < 8 && result.ok && result.remaining > 0; i++) result = await syncRecruitingMail(SAMPLE_SUB);
  assert.ok(result.ok && result.remaining === 0 && result.events >= 70, `events ${result.ok ? result.events : result.reason}`);
  step(`first sync: ${result.ok ? result.events : 0} events`);

  // 3. an immediate second sync fetches nothing new (incremental)
  const again = await syncRecruitingMail(SAMPLE_SUB);
  assert.ok(again.ok && again.fetched === 0, `refetched ${again.ok ? again.fetched : "?"}`);
  step("second sync is a no-op");

  // 3b. discovery mode: provenance and retention are what the mode promises
  const sql = (q: string) => {
    try {
      return execFileSync("docker", ["exec", CONTAINER, "psql", "-U", decodeURIComponent(admin.username), "-d", SCRATCH, "-At", "-v", "ON_ERROR_STOP=1", "-c", q], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
    } catch (error) {
      throw new Error(`sql failed: ${String((error as { stderr?: Buffer }).stderr ?? error).slice(0, 300)}`);
    }
  };
  if (SWEEP) {
    assert.ok(Number(sql(`select count(*) from recruiting_events where signals @> '["via:sweep"]'`)) >= 1, "the sweep found mail the keyword search cannot");
    assert.equal(sql(`select count(*) from recruiting_events where signals::text like '%quick chat%'`), "0");
    assert.equal(sql(`select count(*) from event_predictions where decision = 'not_recruiting' and signals @> '["via:sweep"]' and sender_domain <> ''`), "0", "rejected sweep mail keeps no sender domain");
    assert.ok(Number(sql(`select count(*) from event_predictions where decision = 'not_recruiting' and signals @> '["via:sweep"]'`)) >= 1, "and the sweep did read and reject some");
    assert.equal(sql(`select count(*) from event_predictions where sender_domain ilike '%chase%'`), "0", "a bank alert read by the sweep is not remembered by sender");
    step("sweep: found extra mail, labelled it, retained no sender domain for rejected mail");
  } else {
    assert.equal(sql(`select count(*) from event_predictions where signals::text like '%via:%'`), "0", "keyword mode writes no provenance");
    step("keyword mode: no provenance written (unchanged behavior)");
  }

  // 4. the workspace: opportunities, briefing, review queue
  const real = new Date();
  const ws = await store.loadWorkspace(SAMPLE_SUB, real);
  assert.ok(ws.opportunities.length >= 35, `${ws.opportunities.length} opportunities`);
  const now = toFloating(real);
  const briefing = buildBriefing(ws.opportunities, ws.actions, now);
  assert.ok(briefing.needsYou.length >= 1 && briefing.waiting.length >= 1);
  step(`workspace: ${ws.opportunities.length} opportunities; ${briefing.needsYou.length} need attention`);
  const queue = buildReviewQueue(ws.opportunities);
  assert.ok(queue.length >= 1);
  step(`review queue: ${queue.length} to check`);

  // 4b. reliability: uncertainty is visible and recoverable, never silent
  const full = buildReviewQueue(ws.opportunities, undefined, ws.possible);
  assert.ok(full.some((i) => !i.possible && i.reasons.some((r) => /goodbye/.test(r))), "a goodbye read as an update is in review");
  assert.equal(sql(`select count(*) from event_predictions where decision = 'recruiting' and signals @> '["near-miss"]'`), "0", "a near miss is never logged as a recruiting decision");
  let strong: (typeof full)[number] | undefined;
  if (SWEEP) {
    // These messages have no search keywords: only the sweep can reach them, which is exactly what it is for.
    assert.ok(ws.possible.length >= 2, `near misses surfaced: ${ws.possible.length}`);
    const inPipeline = new Set(ws.opportunities.flatMap((o) => o.events.map((e) => e.gmailMessageId)));
    assert.ok(ws.possible.every((e) => !inPipeline.has(e.gmailMessageId)), "a near miss is not in the pipeline");
    assert.ok(full.some((i) => i.possible && !i.weak), "a strong near miss is in the review queue");
    assert.ok(full.some((i) => i.weak), "a weak near miss is offered");
    assert.equal(attentionCount(full), full.filter((i) => !i.weak && i.tier === "important").length, "weak suggestions and housekeeping are not counted");
    step(`reliability: ${ws.possible.length} near misses surfaced outside the pipeline, goodbye flagged`);
    if (process.env.SEMANTIC_READER === "sample") {
      // The scripted stand-in recognises the reference-request mail the rules cannot see, and doubts the course promotion.
      const second = ws.possible.filter((e) => (e.reviewReasons ?? []).some((r) => /second reader/.test(r)) && !e.signals.includes("near-miss:weak"));
      assert.equal(second.length >= 1, true, "the second reader surfaced mail the rules could not see");
      assert.ok(second.every((e) => !inPipeline.has(e.gmailMessageId)), "and it is not in the pipeline");
      assert.ok(ws.opportunities.some((o) => o.events.some((e) => (e.reviewReasons ?? []).some((r) => /second reader read this as not recruiting/.test(r)))), "a confident reading it doubts is in review");
      assert.equal(sql(`select count(*) from event_predictions where decision = 'recruiting' and signals @> '["semantic:yes"]'`), "0", "the second reader's yes is never logged as a recruiting decision");
      step("second reader (scripted stand-in): surfaced invisible mail and doubted a confident reading, structured values untouched");
    }

    // 4c. a person's word brings a near miss into the pipeline
    strong = full.find((i) => i.possible && !i.weak)!;
    await store.confirmEvent(SAMPLE_SUB, strong.event.id);
    const ws2 = await store.loadWorkspace(SAMPLE_SUB, real);
    assert.ok(!ws2.possible.some((e) => e.id === strong!.event.id) && ws2.opportunities.some((o) => o.events.some((e) => e.id === strong!.event.id)), "confirmed: it joins the pipeline");
    step("confirming a near miss moves it into the pipeline");

    // 4d. hiding a near miss keeps nothing about what it was
    const weakItem = full.find((i) => i.weak)!;
    await store.ignoreEvent(SAMPLE_SUB, weakItem.event.id);
    assert.equal(sql(`select subject || sender_name || sender_domain from recruiting_events where id = '${weakItem.event.id}'`), "", "a hidden near miss retains no subject or sender");
    assert.ok(!(await store.loadWorkspace(SAMPLE_SUB, real)).possible.some((e) => e.id === weakItem.event.id), "and is not offered again");
    step("hiding a near miss forgets its subject and sender");
  } else {
    assert.equal(ws.possible.length, 0, "keyword mode never reads that mail, so there is nothing to surface (the known recall gap the sweep closes)");
    step("reliability: goodbye flagged; near misses need the sweep to be reached");
  }

  // 5. correct one item: it leaves the queue and the correction survives a re-sync
  const target = queue[0].event;
  await store.editEvent(SAMPLE_SUB, target.id, { type: target.type, company: "Acme Robotics", role: "Software Engineer Intern", eventDate: target.eventDate });
  await syncRecruitingMail(SAMPLE_SUB);
  const after = await store.loadWorkspace(SAMPLE_SUB, real);
  assert.equal(buildReviewQueue(after.opportunities).some((i) => i.event.id === target.id), false);
  assert.ok(after.opportunities.some((o) => o.company === "Acme Robotics"), "corrected company appears");
  step("correction removes the item and survives a re-sync");

  // 5b. a reader upgrade revisits every message (nothing of the mail is stored, so it is read from Gmail again) and keeps what the person decided
  const judged = Number(sql(`select count(*) from event_predictions`));
  let reread = await syncRecruitingMail(SAMPLE_SUB, { readerVersion: "next-reader" });
  for (let i = 0; i < 8 && reread.ok && reread.remaining > 0; i++) reread = await syncRecruitingMail(SAMPLE_SUB, { readerVersion: "next-reader" });
  assert.ok(reread.ok && reread.fetched > 0 && reread.remaining === 0, "a new reader version re-reads the mail");
  assert.equal(Number(sql(`select count(*) from event_predictions where extractor_version = 'next-reader'`)), judged, "every message was judged again, as a new row (history is append-only)");
  const upgraded = await store.loadWorkspace(SAMPLE_SUB, real);
  assert.ok(upgraded.opportunities.some((o) => o.company === "Acme Robotics"), "the person's correction survived the revisit");
  if (strong) assert.ok(upgraded.opportunities.some((o) => o.events.some((e) => e.id === strong!.event.id)), "and so did the near miss they confirmed");
  step("a reader upgrade revisits old decisions and keeps corrections and confirmations");

  // 6. confirm and ignore
  const next = buildReviewQueue(after.opportunities)[0];
  if (next) {
    await store.confirmEvent(SAMPLE_SUB, next.event.id);
    assert.equal(buildReviewQueue((await store.loadWorkspace(SAMPLE_SUB, real)).opportunities).some((i) => i.event.id === next.event.id), false);
    step("confirming settles an item");
  }

  // 7. close an opportunity by hand
  const victim = after.opportunities.find((o) => o.status === "active")!;
  await store.setOpportunityStatus(SAMPLE_SUB, victim.key, "closed");
  assert.equal((await store.loadWorkspace(SAMPLE_SUB, real)).opportunities.find((o) => o.key === victim.key)?.status, "closed");
  step("closing an opportunity sticks");

  // 8. privacy: the stored tables hold no message text from the sample bodies
  const dump = execFileSync("docker", ["exec", CONTAINER, "psql", "-U", decodeURIComponent(admin.username), "-d", SCRATCH, "-At", "-c", "select * from recruiting_events"]).toString();
  for (const marker of ["We received your application and will be in touch", "I'm a recruiter at", "Please complete it by", "pleased to extend you an offer"]) assert.equal(dump.includes(marker), false, `body text stored: ${marker}`);
  step("no message body text in the database");

  // 9. delete everything
  await store.deleteRecruitingData(SAMPLE_SUB);
  assert.equal((await store.loadWorkspace(SAMPLE_SUB, real)).opportunities.length, 0);
  step("delete my data empties the workspace");
  console.log("E2E PASSED");
} finally {
  psql("postgres", `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
}
process.exit(0);
