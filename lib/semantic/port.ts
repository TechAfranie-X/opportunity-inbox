import type { ReaderInput, VerifiedOutput } from "../recruiting/reader/types.ts";
import type { VerifiedReading } from "./reading.ts";

/**
 * The second, semantic reader as a port. The product does not know or care what sits behind it (a hosted model, a local model, a
 * development worker); it only defines what may go in and what may come back.
 *
 * Contract (every adapter must honour it):
 *  - IN: only `ReaderInput`: redacted (links, addresses, long numbers and the account holder's name removed), truncated to 1,400
 *    characters, and only for messages that passed the veto-only triage. Raw bodies never cross this boundary.
 *  - OUT: only `VerifiedOutput`: every value already checked against the message text or the candidate list (lib/recruiting/reader/verify.ts).
 *    Anything unverified, invalid or low-certainty is treated as an abstention and has no effect.
 *  - The reader proposes; the program decides. A plain `opine` reader can only change what is asked of a person (recognise mail the rules missed,
 *    or doubt a confident reading). A `readings` reader may also propose the employer and role, which are adopted only if verified against the
 *    message (lib/semantic/reading.ts) and then only as "likely, needs confirmation" (lib/semantic/employer.ts). Dates and stage stay deterministic.
 *  - An adapter that sends anything off the machine needs an explicit, separate privacy decision (a no-retention endpoint, opt-in). None exists.
 */
export interface SemanticReader {
  readonly id: string;
  /** Opinions keyed by `ReaderInput.key`. Missing keys mean "no opinion". */
  opine(inputs: ReaderInput[]): Promise<Map<string, VerifiedOutput>>;
  /**
   * Optional, richer answer: who is who in the message (typed entities and a verified employer relationship). When present the engine uses it
   * for the employer and role as well as for recognition; the employer is adopted only as a LIKELY value (see lib/semantic/employer.ts).
   */
  readings?(inputs: ReaderInput[]): Promise<Map<string, VerifiedReading>>;
}

/** An opinion that may influence anything: verified, and not a guess. */
export const usable = (o: VerifiedOutput | undefined): o is VerifiedOutput => !!o && o.status === "ok" && o.certainty !== "low";
