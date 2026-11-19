/**
 * Identity backfill for one account (Opportunity Intelligence v3): refreshes stored metadata with employer provenance. Gmail is read-only; text stays in memory;
 * the language model, when used, is the LOCAL one (loopback only). Idempotent and additive; see lib/recruiting/reassess.ts.
 *   node --no-warnings --import ./scripts/loader/register.mjs scripts/backfill-identity.ts <google-sub> [--no-model]
 */
import { backfillIdentity } from "../lib/recruiting/reassess.ts";
import { SEMANTIC_GUIDE_V3_COMPACT } from "../lib/semantic/guide-v3.ts";
import { createModelReader } from "../lib/semantic/hosted.ts";
import { localTransport } from "../lib/semantic/local.ts";

const reader = process.argv.includes("--no-model") ? null : createModelReader({ transport: localTransport({ baseUrl: process.env.LOCAL_MODEL_URL }), model: process.env.LOCAL_MODEL ?? "mlx-community/Qwen3-4B-Instruct-2507-4bit", guide: SEMANTIC_GUIDE_V3_COMPACT, batch: 4, idPrefix: "local" });
const selfNames = (process.env.READER_SELF_NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
console.log(await backfillIdentity(process.argv[2], reader, selfNames));
process.exit(0);
