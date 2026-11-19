/**
 * Re-reads one account's stored "possibly recruiting" mail with the LOCAL model (loopback only). Gmail is read-only; message text stays in memory.
 *   node --no-warnings --import ./scripts/loader/register.mjs scripts/reassess-possible.ts <google-sub>
 */
import { reassessPossible } from "../lib/recruiting/reassess.ts";
import { SEMANTIC_GUIDE_V3_COMPACT } from "../lib/semantic/guide-v3.ts";
import { createModelReader } from "../lib/semantic/hosted.ts";
import { localTransport } from "../lib/semantic/local.ts";

const reader = createModelReader({ transport: localTransport({ baseUrl: process.env.LOCAL_MODEL_URL }), model: process.env.LOCAL_MODEL ?? "mlx-community/Qwen3-4B-Instruct-2507-4bit", guide: SEMANTIC_GUIDE_V3_COMPACT, batch: 4, idPrefix: "local" });
const selfNames = (process.env.READER_SELF_NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
console.log(await reassessPossible(process.argv[2], reader, selfNames));
process.exit(0);
