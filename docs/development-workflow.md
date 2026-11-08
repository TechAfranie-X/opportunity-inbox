# Development workflow: product work vs. the frozen evaluation

Architecture v2 is being evaluated prospectively from 2026-12-01 (`docs/prospective-evaluation-protocol.md`). The evidence is only
valid if every row is produced by exactly the frozen code (git tag `arch-v2-shadow-candidate-2`). Product development therefore
happens somewhere the evaluation cannot be touched.

| | Evaluation environment | Product environment |
|---|---|---|
| Folder | `~/Projects/opportunity-inbox` | `~/Projects/opportunity-inbox-mvp` (a git worktree) |
| Branch | `main` | `mvp` |
| What may change | documentation and the guard tooling only | everything product |
| Runs | `npm run shadow -- ...` (collect, label-set, analyze), `npm run eval:label` | `npm run dev`, tests, build |

Both folders share one Git repository and one local Postgres database. Product migrations are additive and never touch the
`shadow_reads` table or the evaluation datasets.

## How accidents are prevented
1. **Commit hook.** On `main`, `.githooks/pre-commit` refuses any staged path other than `docs/`, the hooks, `scripts/freeze-guard*`,
   `README.md`, `package.json`, `.gitignore`. Enable once per clone: `git config core.hooksPath .githooks`.
2. **Push hook.** `.githooks/pre-push` refuses to push a `main` whose evaluation-critical paths differ from the tag, and refuses to
   move or delete a `arch-v2-shadow-candidate-*` tag.
3. **Provenance guard.** `npm run shadow` loads `scripts/freeze-guard-preload.mjs` first. For every command that writes evidence
   (`collect`, `export`, `import`, `label-set`, `analyze`; dry runs excluded) it verifies the checkout is byte-identical to the tag in
   `lib/recruiting`, `lib/opportunities`, `lib/gmail`, `lib/db`, `lib/eval-store`, `drizzle`, `scripts/shadow.ts`, `scripts/loader`,
   and refuses otherwise. Running a collection from the product worktree is impossible: the CLI never starts.
   (`npm run test:guard` exercises this against a scratch checkout of the tag.)
4. **Embargo in the product.** The product ignores mail arriving at or after the evaluation cutoff, so using it never displays
   pipeline output for evaluation mail (protocol section 3). See `docs/mvp.md`.
5. **Overrides** (`FREEZE_OVERRIDE=1`) exist for the owner and are meant to be used only after the evaluation is finished.

## Typical commands
```bash
# product
cd ~/Projects/opportunity-inbox-mvp && npm run dev

# evaluation (from December 1, every 3 days)
cd ~/Projects/opportunity-inbox && npm run shadow -- collect --user <mailbox hash>
```

## Ending the freeze
After the single analysis has been recorded, the owner may merge `mvp` into `main` (`FREEZE_OVERRIDE=1`). Until then, never.

## Do not merge `mvp` into `main` until the evaluation analysis is done
`mvp` changes `lib/recruiting`, `lib/gmail` and other frozen paths, so merging it (or tagging it) before the single analysis would
end the prospective evaluation, and the push hook on `main` will refuse it. Ship the product from `mvp` until then. The product
never collects evaluation evidence (`lib/product-isolation.test.ts`); that stays a guarded CLI job on the frozen checkout.
