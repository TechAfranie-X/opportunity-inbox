/**
 * Evaluation safeguard. While BLIND_SETUP_LOCK=1, nothing in the app may read a mailbox:
 * `/today` does not auto-start the first sync and `syncAction` refuses to run.
 *
 * Why it exists: connecting a mailbox used to trigger an automatic first sync, which ran the extractor over a
 * mailbox that was meant to stay unseen for the pre-registered blind-1 evaluation. Off by default, so normal
 * product behaviour is unchanged. Lives outside lib/recruiting on purpose: the frozen extraction candidate is untouched.
 */
export const isSyncLocked = () => process.env.BLIND_SETUP_LOCK === "1";
