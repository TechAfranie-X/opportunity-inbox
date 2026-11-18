import { createHash } from "node:crypto";
import { companyKey } from "../recruiting/company.ts";
import { cycleOf, isRoleFragment, roleCore } from "./cycle.ts";
import type { Group } from "./identity.ts";

/**
 * Opportunity keys v2: `employer ~ cycle ~ role` built only from IDENTITY fields (never from iteration order), so the same application keeps its key when more
 * mail arrives, when mail is re-read, and when unrelated applications are added or regrouped. Components come from the group's earliest specific role (its anchor),
 * which later mail cannot change. Two distinct applications that share all three (two receipts for the same role in one cycle) are told apart by a short hash of
 * their earliest message id, in order of first appearance; the first keeps the plain key. Known limit: a person's edit of a role's identity words, or mail
 * older than a group's current anchor, can change a key; translation from the previous scheme and from earlier keys is by event membership (legacy.ts).
 */
export function identityKey(g: Group): string {
  const company = g.company ? companyKey(g.company) : "unknown";
  const anchor = g.events.find((e) => e.role && !isRoleFragment(e.role) && roleCore(e.role).length > 0);
  const years = anchor ? cycleOf(anchor.role).years : g.events.flatMap((e) => cycleOf(e.role).years).sort().slice(0, 1);
  const cycle = years.length > 0 ? `c${years.join("-")}` : "c0";
  const role = (anchor ? roleCore(anchor.role) : []).slice(0, 4).join("-") || "general";
  return `${company}~${cycle}~${role}`;
}

export function assignKeys(groups: Group[]): string[] {
  const order = groups.map((g, i) => ({ g, i, first: g.events[0] })).sort((a, b) => a.first.occurredAt.getTime() - b.first.occurredAt.getTime() || a.first.id.localeCompare(b.first.id));
  const used = new Set<string>();
  const keys = new Array<string>(groups.length);
  for (const { g, i, first } of order) {
    const base = identityKey(g);
    let key = base;
    if (used.has(key)) key = `${base}~${createHash("sha256").update(first.gmailMessageId).digest("hex").slice(0, 5)}`;
    for (let n = 2; used.has(key); n++) key = `${base}~${n}`;
    used.add(key);
    keys[i] = key;
  }
  return keys;
}
