import { getCached } from "../recruiting/reader/cache.ts";
import type { ReaderInput, VerifiedOutput } from "../recruiting/reader/types.ts";
import type { SemanticReader } from "./port.ts";

/**
 * DEVELOPMENT ADAPTER. Serves verified outputs that an in-session worker produced earlier for exactly these redacted inputs (the shadow
 * harness cache, outside the repository, keyed by a hash of the input). It calls nothing, sends nothing and has no opinion about mail it
 * has not seen. It exists so the whole architecture (port, consensus, review) can be exercised end to end without any model hosting.
 */
export function cacheSemanticReader(slot = "A"): SemanticReader {
  return {
    id: `cache-${slot}`,
    async opine(inputs: ReaderInput[]) {
      const out = new Map<string, VerifiedOutput>();
      for (const i of inputs) {
        const hit = getCached(i, slot);
        if (hit) out.set(i.key, hit);
      }
      return out;
    },
  };
}
