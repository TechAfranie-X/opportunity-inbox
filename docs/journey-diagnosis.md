# One Email -> Complete Journey: why only 59%? (diagnosis, 2026-11-22)

Tool: `scripts/journey-diagnose.ts <sub> [--details]` (blind mode: the seed is removed from its journey and given alone; DEVELOPMENT truth = the frozen validation set, so nothing here is accuracy evidence). For each of the 22 seeds it asks, in order: was the evidence stored; did the product itself split the journey; was the right application among the candidates; did identity choose it; was the seed's stored type right; was the final state right; was vendor/programme/requisition/cycle information involved.

## Failure families at the start (11 of 22 succeeded = 50% under the strict "decided and complete and right state" rule; the earlier 59% was recall alone)
| Family | Seeds | What it was |
|---|---|---|
| Success | 11 | |
| I2 identity ambiguous although the right application survived the comparison | 6 | the lone message got a "currently grouped here" prior (it carried no grouping evidence), which tied it with the right application; margin never reached |
| E evidence "not stored" | 3 | stored, but kept outside the pipeline by design (portal codes, non-receipt notices); the journey timeline simply did not list them |
| I1 resolved to the wrong application | 1 | a kickoff message typed "applied" triggered the one-receipt-per-application veto though it is not a receipt |
| L lifecycle wrong although identity right | 1 | the frozen label is outdated: the candidate withdrew and the employer acknowledged it; the product's Closed/Withdrawn is right |
| Retrieval miss (right application not among candidates) | 0 | retrieval of candidates was 1.00 throughout |
| Grouping fragmentation (the product itself splits the journey) | 0 on these 22 | but see the leave-one-out below |

So the proven bottleneck was identity weighing, not retrieval or semantics.

## Changes (each general; none tuned to a seed)
1. No "stay here" prior for a lone message (a prior is for groups the product built from evidence); lone messages are not rivals for the margin.
2. One-receipt veto only for receipt-like seeds.
3. Supporting history: admin/logistics/non-receipt mail tied by thread, requisition or the employer inside the application's active window is listed with the journey as `supporting`, never as lifecycle.
4. Sequence reasoning: an application that ended more than 60 days before a message is unlikely to be what it continues when another is open (-4); outcomes belong to applications still open (+1) and to the one most recently active (+1, +2 when it directly follows within 3 days); recency is measured from the application's own ending.
5. A role the reader carried over from the thread is soft evidence (+1/-2), not counted when the thread itself already counts; a borrowed role is never identity.
Result on the 22 (development): 11 -> 19 successes at one point, 18-19 after the last changes (one case traded for another when the succession weight rose); remaining: 2 identity-ambiguous (one precise question each) and the outdated label.

## Generalisation, separately (label-free leave-one-out, `scripts/journey-loo.ts`, 215 events of well-evidenced applications, not tuned on)
Returned to its own application 61.9%; resolved to a SIBLING with the same company and role 20.9% (the product holds one journey, or distinct receipts, in several identical groups, mostly the Project Destined / "Spring 2026 Building AI Agents Program" family: a product fragmentation / host-vs-partner identity problem, not an investigator error); ambiguous 16.7% (mostly `applied` receipts that have identical siblings; one precise question); resolved ELSEWHERE 1 event (the Harvey November reply: the investigator is right, the product's 2026 group is wrong). Raising the succession weight from 1 to 2 improved the return rate by 5 events with no new wrong placements.

## Open families (largest first)
1. Product-level fragmentation / partner-programme identity (Project Destined, an "Unknown company" programme): ~21% of well-evidenced events have an identical-role sibling group. Needs host/partner/programme identity, not more scoring.
2. Receipt-vs-receipt ambiguity among identical siblings (a message cannot separate them; ask one question or use the receipt's requisition).
3. Stale frozen labels (SLAC): update the labels only in a new frozen version, never silently.
