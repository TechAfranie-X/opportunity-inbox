import { FROZEN } from "../recruiting/shadow/frozen.ts";

/**
 * Evaluation embargo. From the prospective cutoff, mail that arrives is evidence for the architecture v2 evaluation, and the
 * protocol forbids showing any pipeline output for it (docs/prospective-evaluation-protocol.md, section 3). The product therefore
 * never fetches, extracts or displays mail at or after the cutoff. Before the cutoff this changes nothing (all mail is earlier).
 *
 * The cutoff is the frozen constant, not a setting. The only switch is EVAL_EMBARGO=off, meant for after the evaluation is finished
 * (or for an owner who has consciously decided to end the evaluation window); see docs/mvp.md.
 */
export const EMBARGO_CUTOFF = new Date(FROZEN.cutoff);

export const embargoActive = (env: Record<string, string | undefined> = process.env) => env.EVAL_EMBARGO !== "off";

/** The instant before which mail may be used, or null when the embargo is lifted. */
export const embargoBefore = (env: Record<string, string | undefined> = process.env): Date | null => (embargoActive(env) ? EMBARGO_CUTOFF : null);

/** A Gmail search restricted to mail from before the cutoff (epoch seconds, which Gmail's `before:` accepts). */
export function applyEmbargo(query: string, env: Record<string, string | undefined> = process.env): string {
  const before = embargoBefore(env);
  return before ? `${query} before:${Math.floor(before.getTime() / 1000)}` : query;
}

/** True once the embargo is actually hiding something, i.e. the cutoff has passed. Used to tell the user why newer mail is absent. */
export const embargoHidingMail = (now: Date, env: Record<string, string | undefined> = process.env) => embargoActive(env) && now.getTime() >= EMBARGO_CUTOFF.getTime();
