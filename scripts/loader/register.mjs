// Lets a plain `node` CLI import the app's own modules: resolves the "@/" alias and neutralises "server-only".
// Used only by offline tooling (scripts/eval.ts); the Next.js build does not use it.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
