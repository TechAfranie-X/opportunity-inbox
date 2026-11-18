import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { gmailAccountForLinks, gmailThreadUrl } from "./format.ts";

const url = (thread: string, account?: string | null) => new URL(gmailThreadUrl(thread, account));

test("a link names the connected account, never a numbered slot, so it works in any browser profile and after accounts are added or removed", () => {
  const a = url("19abc", "alex@example.com"), b = url("19abc", "robin@school.edu");
  assert.equal(a.origin + a.pathname, "https://mail.google.com/mail/");
  assert.equal(a.searchParams.get("authuser"), "alex@example.com");
  assert.equal(b.searchParams.get("authuser"), "robin@school.edu");
  assert.equal(a.hash, "#all/19abc");
  for (const u of [a, b]) assert.ok(!/\/u\/\d+/.test(u.pathname), "no /u/<slot>/");
  // two connected accounts, same conversation id (ids are per account): each opens in its own account
  assert.notEqual(gmailThreadUrl("19abc", "alex@example.com"), gmailThreadUrl("19abc", "robin@school.edu"));
});

test("the same account always yields the same link whatever slot the browser currently gives it", () => {
  // slots change when a person signs in or out; nothing in the URL depends on them
  assert.equal(gmailThreadUrl("t1", "alex@example.com"), gmailThreadUrl("t1", "alex@example.com"));
  assert.ok(!gmailThreadUrl("t1", "alex@example.com").includes("/u/"));
});

test("addresses are encoded exactly once; plus-addressing and apostrophes survive", () => {
  assert.equal(url("t", "alex+jobs@example.com").searchParams.get("authuser"), "alex+jobs@example.com");
  assert.ok(gmailThreadUrl("t", "alex+jobs@example.com").includes("authuser=alex%2Bjobs%40example.com"));
  assert.equal(url("t", "o'brien@example.co.uk").searchParams.get("authuser"), "o'brien@example.co.uk");
  assert.equal(url("a b/c?d", "x@example.com").hash, "#all/a%20b%2Fc%3Fd");
});

test("a missing or malformed account never injects anything: the link just carries no account hint", () => {
  for (const bad of [null, undefined, "", "   ", "not-an-address", "a@b", "a b@example.com", "a@example.com#x", "a@example.com&authuser=evil@x.com", "a@example.com?x=1", "<script>@example.com", "a@evil.com/@example.com", "x".repeat(80) + "@example.com"]) {
    const u = url("t1", bad as string | null);
    assert.equal(u.searchParams.get("authuser"), null, String(bad));
    assert.equal(u.origin + u.pathname + u.hash, "https://mail.google.com/mail/#all/t1");
  }
});

test("the account for links: the connected address of a real user, nothing for the sample mailbox", () => {
  assert.equal(gmailAccountForLinks(" alex@example.com "), "alex@example.com");
  assert.equal(gmailAccountForLinks("alex@example.com", true), null);
  assert.equal(gmailAccountForLinks(undefined), null);
});

test("no source file builds a slot-numbered Gmail link", () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === "node_modules" || name === ".next") continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && /mail\.google\.com\/mail\/u\/|\/mail\/u\/\d/.test(readFileSync(p, "utf8"))) hits.push(p);
    }
  };
  walk(join(import.meta.dirname, "../../app"));
  walk(join(import.meta.dirname, ".."));
  assert.deepEqual(hits, []);
});
