import type { ReaderInput, VerifiedOutput } from "../recruiting/reader/types.ts";

/**
 * The second, semantic reader as a port. The product does not know or care what sits behind it (a hosted model, a local model, a
 * development worker); it only defines what may go in and what may come back.
 *
 * Contract (every adapter must honour it):
 *  - IN: only `ReaderInput`: redacted (links, addresses, long numbers and the account holder's name removed), truncated to 1,400
 *    characters, and only for messages that passed the veto-only triage. Raw bodies never cross this boundary.
 *  - OUT: only `VerifiedOutput`: every value already checked against the message text or the candidate list (lib/recruiting/reader/verify.ts).
 *    Anything unverified, invalid or low-certainty is treated as an abstention and has no effect.
 *  - The reader NEVER writes a structured field. It can only change what is asked of a person: recognise mail the rules missed, or doubt a
 *    confident rules reading. Company, role and date always come from the deterministic, grounded path.
 *  - An adapter that sends anything off the machine needs an explicit, separate privacy decision (a no-retention endpoint, opt-in). None exists.
 */
export interface SemanticReader {
  readonly id: string;
  /** Opinions keyed by `ReaderInput.key`. Missing keys mean "no opinion". */
  opine(inputs: ReaderInput[]): Promise<Map<string, VerifiedOutput>>;
}

/** An opinion that may influence anything: verified, and not a guess. */
export const usable = (o: VerifiedOutput | undefined): o is VerifiedOutput => !!o && o.status === "ok" && o.certainty !== "low";
