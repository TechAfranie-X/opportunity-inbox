import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyOrgName } from "../identity/classify.ts";
import { domainEvidence, resolveDomain } from "../identity/domain.ts";
import { learnedMappings } from "../identity/learned.ts";
import { applyIdentity } from "../identity/reconcile.ts";
import type { EffectiveEvent, ExtractedEvent, Opportunity, RecruitingEmail } from "../recruiting/types.ts";
import { cachedBrandUrls, readIndex, shouldFetch } from "./cache.ts";
import { ensureFirstPartyBrands } from "./ensure.ts";
import { inertSvg, lightOnlySvg, pageNamesCompany, privateIp } from "./first-party.ts";

const ev = (over: Partial<EffectiveEvent>): EffectiveEvent => ({ id: "e", gmailMessageId: "m", gmailThreadId: "t", occurredAt: new Date("2026-11-10"), outbound: false, senderName: "Acme Recruiting", senderDomain: "acmerobotics.com", subject: "s", type: "applied", company: "Acme Robotics", role: null, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, fieldConfidence: { type: 0.9, company: 0.9, role: 0.5 }, signals: [], corrected: false, ...over });
const opp = (company: string, events: EffectiveEvent[]): Opportunity => ({ key: company, company, role: null, stage: "applied", outcome: null, status: "active", firstActivityAt: new Date(), lastActivityAt: new Date(), events, needsReview: false } as unknown as Opportunity);

test("program and event names are classified structurally; the sponsor is what precedes the head noun", () => {
  assert.equal(classifyOrgName("Kleiner Perkins Fellows").kind, "program");
  assert.equal(classifyOrgName("Kleiner Perkins Fellows").sponsor, "Kleiner Perkins");
  assert.equal(classifyOrgName("Deloitte Digital’s Salesforce Academy").sponsor, "Deloitte Digital");
  assert.equal(classifyOrgName("Heidelberg Laureate Forum").kind, "program");
  assert.equal(classifyOrgName("Claude Corps Fellowship").kind, "program");
  for (const n of ["Datadog", "Two Sigma", "Hudson River Trading", "Khan Academy Inc"]) assert.equal(classifyOrgName(n).kind === "program" && n !== "Khan Academy Inc", false, n);
});

test("domain: graph first, sender evidence only when trustworthy, never from string concatenation", () => {
  assert.equal(resolveDomain("Two Sigma", {})?.source, "graph");
  assert.equal(resolveDomain("Amazon Web Services", {})?.domain.endsWith("amazon.com"), true, "AWS recruits as Amazon");
  assert.equal(resolveDomain("Unseen Startup Inc", {}), null, "no evidence, no domain: a name is never glued to .com");
  const own = domainEvidence([ev({ company: "Acme Robotics", senderDomain: "acmerobotics.com" })]);
  assert.deepEqual(resolveDomain("Acme Robotics", { evidence: own })?.domain, "acmerobotics.com");
  assert.equal(resolveDomain("Acme Robotics", { evidence: own })?.needsPageCheck, true, "sender-derived domains must pass the page check");
  // platforms and shared senders are never an employer's domain
  const ats = domainEvidence([ev({ senderDomain: "greenhouse-mail.io" })]);
  assert.equal(resolveDomain("Acme Robotics", { evidence: ats }), null);
  const shared = domainEvidence([ev({ company: "Acme Robotics", senderDomain: "acmerobotics.com" }), ev({ company: "Other Co", senderDomain: "acmerobotics.com" })]);
  assert.equal(resolveDomain("Acme Robotics", { evidence: shared }), null, "a domain serving two companies is a platform");
  const mismatch = domainEvidence([ev({ company: "Acme Robotics", senderDomain: "totallydifferent.com" })]);
  assert.equal(resolveDomain("Acme Robotics", { evidence: mismatch }), null, "an unrelated sender domain is not the employer's");
  assert.equal(resolveDomain("Heidelberg Laureate Forum", {}), null, "a program without a resolvable sponsor has no domain");
  assert.equal(resolveDomain("Khan Academy", {})?.domain, "khanacademy.org", "a known organization is not a program just because of its name");
});

test("a confirmed mapping (learned) supplies the domain with high trust and is per person", () => {
  const confirmed = ev({ company: "Quillhaven", senderDomain: "quillhaven.io", senderName: "Quillhaven Recruiting", confirmed: true });
  const learned = learnedMappings([confirmed]);
  const d = resolveDomain("Quillhaven", { learnedCompanyDomains: new Map([...learned.byDomain].map(([dom, co]) => [co.toLowerCase(), dom])) });
  assert.equal(d?.source, "learned");
});

test("first-party safety: inert SVG only; the page must name an inferred company", () => {
  assert.equal(inertSvg('<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>'), true);
  for (const bad of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><image href="https://evil.example/a.png"/></svg>', '<svg><foreignObject/></svg>']) assert.equal(inertSvg(bad), false, bad);
  assert.equal(pageNamesCompany("<title>Acme Robotics | Home</title>", ["acmerobotics"]), true);
  assert.equal(pageNamesCompany("<title>Domain for sale</title>", ["acmerobotics"]), false);
});

test("negative results are cached and not retried inside the window", () => {
  const at = new Date("2026-11-01").toISOString();
  assert.equal(shouldFetch(undefined), true);
  assert.equal(shouldFetch({ status: "ok", file: "x.png", kind: "png", width: 1, height: 1, from: "icon", source: "graph", at }), false);
  assert.equal(shouldFetch({ status: "none", reason: "r", source: "graph", at }, Date.parse(at) + 5 * 86_400_000), false);
  assert.equal(shouldFetch({ status: "none", reason: "r", source: "graph", at }, Date.parse(at) + 40 * 86_400_000), true);
});

test("ensure: only KNOWN employers with no bundled mark and a trustworthy domain are fetched, once; only the domain is passed; identity never changes", async () => {
  process.env.BRAND_CACHE_DIR = mkdtempSync(join(tmpdir(), "oi-brand-"));
  const calls: string[] = [];
  const fetcher = async (domain: string, o: { source: string; companyKeys: string[]; needsPageCheck: boolean }) => {
    calls.push(`${domain}|${o.needsPageCheck}|${Object.keys(o).sort().join(",")}`);
    return { entry: { status: "ok" as const, file: `${domain}.png`, kind: "png" as const, width: 180, height: 180, from: "icon" as const, source: o.source as "graph", at: new Date().toISOString() }, data: Buffer.from("x"), file: `${domain}.png` };
  };
  const known = ev({ company: "Acme Robotics", senderDomain: "acmerobotics.com" });
  const likely = ev({ company: "Likely Startup", senderDomain: "likelystartup.com", fieldConfidence: { type: 0.9, company: 0.5, role: 0.5 } });
  const bundled = ev({ company: "Datadog", senderDomain: "datadoghq.com" });
  const program = ev({ company: "Heidelberg Laureate Forum", senderDomain: "heidelberg-laureate-forum.org" });
  const opps = [opp("Acme Robotics", [known]), opp("Likely Startup", [likely]), opp("Datadog", [bundled]), opp("Heidelberg Laureate Forum", [program])];
  const r = await ensureFirstPartyBrands(opps, { fetcher: fetcher as never });
  assert.deepEqual(calls.map((c) => c.split("|")[0]), ["acmerobotics.com"]);
  assert.match(calls[0], /true\|companyKeys,needsPageCheck,source$/, "the fetcher is given a domain and the checks, nothing about the user");
  assert.equal(r.fetched, 1);
  assert.equal(r.skipped["bundled mark exists"], 1);
  assert.equal(r.skipped["not a known employer"], 1);
  assert.equal(readIndex().companies["acmerobotics"], "acmerobotics.com");
  assert.deepEqual(cachedBrandUrls([]), {}, "no company keys, no marks: another person's employers are never returned");
  assert.deepEqual(cachedBrandUrls(["someoneelse"]), {});
  assert.match(cachedBrandUrls(["acmerobotics"])["acmerobotics"], /^\/brands\/cache\/acmerobotics\.com\.png\?v=\d+$/);
  assert.ok(existsSync(join(process.env.BRAND_CACHE_DIR!, "acmerobotics.com.png")));
  const again = await ensureFirstPartyBrands(opps, { fetcher: fetcher as never });
  assert.equal(calls.length, 1, "never fetched twice");
  assert.equal(again.cachedOk, 1);
});

test("identity: a program run by a known organization resolves to that organization (likely); an unsponsored program is never Known", () => {
  const ctx = { known: [], learned: learnedMappings([]) };
  const mail: RecruitingEmail = { id: "m1", threadId: "t1", from: "Fellows <fellows@kleinerperkins.com>", subject: "Your application", receivedAt: new Date("2026-11-10"), outbound: false, bodyText: "Thank you for applying." };
  const base = (company: string): ExtractedEvent => ({ gmailMessageId: "m1", gmailThreadId: "t1", occurredAt: new Date("2026-11-10"), outbound: false, senderName: "Fellows", senderDomain: "kleinerperkins.com", subject: "s", type: "applied", company, role: null, eventDate: null, eventDateHasTime: false, dateKind: null, confidence: 0.9, fieldConfidence: { type: 0.9, company: 0.9, role: 0 }, signals: [] });
  const unsponsored = applyIdentity([base("Heidelberg Laureate Forum")], new Map([["m1", mail]]), new Map(), ctx)[0];
  assert.equal(unsponsored.company, "Heidelberg Laureate Forum");
  assert.ok((unsponsored.fieldConfidence?.company ?? 1) < 0.6);
  assert.match((unsponsored.reviewReasons ?? []).join(" "), /program or event/);
});

test("dark-scheme blocks are removed from fetched SVGs so a mark never turns white-on-white on the fixed light tile", () => {
  const svg = '<svg viewBox="0 0 1 1"><style>path{fill:#111}@media (prefers-color-scheme: dark){path{fill:#fff}.a{opacity:.5}}circle{fill:red}</style><path d="M0 0"/></svg>';
  const out = lightOnlySvg(svg);
  assert.ok(!/prefers-color-scheme/.test(out));
  assert.ok(out.includes("path{fill:#111}") && out.includes("circle{fill:red}"));
});

test("SSRF filter: every non-public address form is refused, including IPv4-mapped IPv6", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "2001:db8::1", "not-an-ip"]) assert.equal(privateIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "151.101.1.1", "2606:4700::1111", "2a00:1450:4001::200e"]) assert.equal(privateIp(ip), false, ip);
});
