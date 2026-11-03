/**
 * Identifies the extraction logic that produced a prediction. Bump it whenever a change can alter output
 * (rules, resolver, policy defaults). Predictions, eval runs and labels reference it, so an old prediction can
 * always be attributed to the code that made it.
 *
 * Format: <year>.<month>.<n>-<note>. The note is free text for humans.
 */
export const EXTRACTOR_VERSION = "2026.11.1-generalization";
