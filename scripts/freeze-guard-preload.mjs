// Loaded with `node --import` ahead of scripts/shadow.ts. Runs the freeze guard before the CLI does anything.
import { guardMessage, needsGuard, verifyFrozen } from "./freeze-guard.mjs";

const [, , cmd, ...flags] = process.argv;
if (cmd && needsGuard(cmd, flags)) {
  const { ok, reasons } = verifyFrozen();
  if (!ok) {
    console.error(guardMessage(cmd, reasons));
    process.exit(2);
  }
}
