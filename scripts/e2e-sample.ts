/**
 * End-to-end check of the signed-in product against a SCRATCH Postgres database, using the synthetic sample mailbox.
 * Run:  npm run e2e:sample      (creates scratch_mvp_e2e, migrates, runs, drops it). Refuses any database not named scratch_*.
 * Never touches the real database or Gmail.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL is required (it is only used to reach the server; the scratch database is separate)");
const SCRATCH = "scratch_mvp_e2e";
const url = new URL(base);
const admin = new URL(base);
url.pathname = `/${SCRATCH}`;
assert.ok(url.pathname.slice(1).startsWith("scratch_"), "refusing to run outside a scratch database");

const psql = (db: string, sql: string) =>
  execFileSync("docker", ["exec", "opportunity-inbox-db-1", "psql", "-U", decodeURIComponent(admin.username), "-d", db, "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: ["ignore", "pipe", "pipe"] });

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
  const { buildReviewQueue } = await import("../lib/recruiting/review.ts");
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

  // 5. correct one item: it leaves the queue and the correction survives a re-sync
  const target = queue[0].event;
  await store.editEvent(SAMPLE_SUB, target.id, { type: target.type, company: "Acme Robotics", role: "Software Engineer Intern", eventDate: target.eventDate });
  await syncRecruitingMail(SAMPLE_SUB);
  const after = await store.loadWorkspace(SAMPLE_SUB, real);
  assert.equal(buildReviewQueue(after.opportunities).some((i) => i.event.id === target.id), false);
  assert.ok(after.opportunities.some((o) => o.company === "Acme Robotics"), "corrected company appears");
  step("correction removes the item and survives a re-sync");

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
  const dump = execFileSync("docker", ["exec", "opportunity-inbox-db-1", "psql", "-U", decodeURIComponent(admin.username), "-d", SCRATCH, "-At", "-c", "select * from recruiting_events"]).toString();
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
