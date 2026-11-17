import type { ReaderInput, VerifiedOutput } from "../recruiting/reader/types.ts";
import type { SemanticReader } from "./port.ts";

/**
 * A SCRIPTED stand-in for the second reader, for the synthetic sample mailbox only (SEMANTIC_READER=sample, development, sample users).
 * It is not a model and recognises nothing: it answers a fixed way for the few sample messages written to show what a semantic reader changes
 * (unfamiliar mail the rules cannot see, and a confident rules reading it would doubt). It lets the product, its review screen and its tests
 * be exercised end to end without any model.
 */
const YES = [/references? for your application/i];
const NO = [/data course/i];

export function sampleSemanticReader(): SemanticReader {
  return {
    id: "sample-script",
    async opine(inputs: ReaderInput[]) {
      const out = new Map<string, VerifiedOutput>();
      for (const i of inputs) {
        const text = `${i.subject} ${i.body}`;
        const recruiting = YES.some((r) => r.test(text)) ? true : NO.some((r) => r.test(text)) ? false : null;
        if (recruiting === null) continue;
        out.set(i.key, { key: i.key, status: "ok", recruiting, type: null, stage: null, company: null, companySource: null, role: null, dateText: null, certainty: "high", evidence: null, rejections: [] });
      }
      return out;
    },
  };
}
