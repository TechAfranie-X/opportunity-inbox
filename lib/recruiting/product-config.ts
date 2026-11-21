import type { IdentityContext } from "../lifecycle/identity.ts";
import type { ReviewOptions } from "./review.ts";

/**
 * The personal-MVP defaults, each with a one-word rollback (set the variable to "off" and restart). They are VIEW-TIME behaviours: they change how stored events are grouped, which of
 * them enter the pipeline, and which questions are asked, and never rewrite a stored event or a person's correction.
 *   ENTRY_POLICY     a model-only reading cannot CREATE an application (real-mailbox verification: almost none of those were the student's own applications)
 *   IDENTITY_V3      the identity options that need no extra model calls (fewer wrong merges: 64 to 33 on the development set)
 *   REVIEW_PRIORITY  "needs you" versus collapsed suggestions, repeated questions folded
 */
const on = (name: string) => process.env[name] !== "off";
export const entryPolicyOn = () => on("ENTRY_POLICY");
export const reviewOptions = (): ReviewOptions => ({ prioritize: on("REVIEW_PRIORITY"), investigate: on("INVESTIGATE") });
export const identityContext = (): IdentityContext | undefined => (on("IDENTITY_V3") ? { weakEmployerThreads: true, distinctThreadReceipts: true, confirmEndings: true, attribution: true, borrowedCycle: true, cycleEnded: true } : undefined);
