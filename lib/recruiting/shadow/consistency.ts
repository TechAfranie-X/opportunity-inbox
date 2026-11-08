import { FROZEN } from "./frozen.ts";

/**
 * The protocol document is the human-readable freeze; frozen.ts is what the code uses. They must say the same thing.
 * `protocolTokens` lists, for every frozen parameter, the exact text the document must contain; `missingFromProtocol`
 * returns what it lacks. Used by a unit test and by `shadow freeze-check`, so a drift is caught mechanically.
 */
export function protocolTokens(): Array<[string, string]> {
  const c = FROZEN.claims, m = FROZEN.minimumEvidence;
  const iso = (s: string) => s.replace(".000Z", "Z");
  return [
    ["cutoff", iso(FROZEN.cutoff)],
    ["hard stop", iso(FROZEN.hardStop)],
    ["eligible-through", iso(FROZEN.eligibleThrough)],
    ["tag deadline", iso(FROZEN.tagDeadline).slice(0, 10)],
    ["tag name", FROZEN.freezeTag],
    ["reader version", FROZEN.readerVersion],
    ["pipeline version", FROZEN.pipelineVersion],
    ["extractor version", FROZEN.extractorVersion],
    ["sampling rate", `${FROZEN.uniformRate * 100}%`],
    ["S2 weight", `weight ${FROZEN.s2Weight}`],
    ["arm hash", FROZEN.armHash],
    ["bootstrap resamples", FROZEN.bootstrap.resamples.toLocaleString("en-US")],
    ["bootstrap seed", String(FROZEN.bootstrap.seed)],
    ["minimum weeks", `${FROZEN.minWeeksAfterCutoff} weeks`],
    ["recall target", `${c.strictRecall.target * 100}%`],
    ["interval floor", `${c.precision.lowerMin * 100}%`],
    ["agreement error", `${c.agreementError.target * 100}%`],
    ["agreement upper bound", `${c.agreementError.upperMax * 100}%`],
    ["review rate", `${c.reviewRate.target * 100}%`],
    ["review upper bound", `${c.reviewRate.upperMax * 100}%`],
    ["min evidence: recall positives", `${m.recallPositives} effective positives`],
    ["min evidence: precision decisions", `${m.precisionDecisions} effective decisions`],
    ["min evidence: type decisions", `${m.typeDecisions} effective type decisions`],
    ["min evidence: agreement rows", `${m.agreementRows} agreement-region rows`],
    ["min evidence: review reads", `${m.reviewReads} model reads`],
    ["dataset prefix", FROZEN.datasetPrefix],
  ];
}

export function missingFromProtocol(doc: string): string[] {
  return protocolTokens().filter(([, token]) => !doc.includes(token)).map(([name, token]) => `${name} ("${token}")`);
}
