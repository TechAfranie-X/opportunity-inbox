import { SEMANTIC_GUIDE_V3_COMPACT } from "./guide-v3.ts";

/**
 * Semantic guide v4: guide v3 plus how to read a message whose parts were SEPARATED before the model saw it (lib/gmail/message-parts.ts). Same output schema, so verification is unchanged; the
 * only addition is temporal and speaker grounding. A quote must come from "body" (what the sender wrote now, plus any forwarded block), which the verifier enforces: a quote found only in
 * "context.quoted_history" cannot verify, so history can never become a new event.
 */
export const SEMANTIC_GUIDE_V4_VERSION = "semantic-guide-v4";

export const SEMANTIC_GUIDE_V4 = `${SEMANTIC_GUIDE_V3_COMPACT}

How to read each input (the input may carry a "context" object):
- "body" is ONLY what the sender wrote in THIS message (plus a forwarded block, marked "[forwarded message]", when someone forwarded an employer's message as evidence). Report the event this message performs, now.
- "context.quoted_history" is EARLIER messages quoted below the reply. It tells you what the conversation is about and who is who. NEVER report an event that appears only in quoted_history, and never copy a quote from it: whatever happened there happened before this message.
- "context.signature" says who is speaking and for which organization. Use it to tell the employer's recruiter from the applicant or a third party; it is not an event.
- A sentence about what MIGHT happen ("if you need to withdraw", "if we are not moving forward we will tell you"), a description of the process ahead, or a policy is not an event that has happened.
- A short reply ("Thanks", "See you Monday", an out-of-office) inside an existing process is "status_update", whatever the quoted history said.`;
