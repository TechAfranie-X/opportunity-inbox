import { EXTRACTOR_VERSION } from "./version.ts";

/**
 * Identifies the PRODUCT's reading pipeline: the frozen rule reader plus everything the product adds around it (body decoding,
 * continuity, verification, abstention). It is the key of the product's "already evaluated" memory, so changing it makes the
 * next sync revisit every message (nothing is stored of the mail, so that means reading it from Gmail again), keep what the
 * person corrected or confirmed, and re-derive the rest.
 *
 * It is separate from EXTRACTOR_VERSION on purpose: that constant is pinned to the frozen prospective-evaluation candidate
 * (lib/recruiting/shadow/frozen.ts, checked by shadow/protocol.test.ts) and must not move for product work.
 *
 * Bump the suffix whenever a product change can alter what is shown for a message that was already read.
 */
export const PRODUCT_READER_VERSION = `${EXTRACTOR_VERSION}+product-integrity-5`;
