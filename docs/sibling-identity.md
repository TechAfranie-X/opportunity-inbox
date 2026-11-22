# Sibling opportunities: which are one journey, which are separate, and what changed (2026-11-22)

Tool: `scripts/sibling-families.ts <sub> [--details]` lists families of opportunities with the same company and role. Before this change: **9 families, 22 opportunities, 153 events** (of 208 opportunities). Decision per family, from requisition IDs, roles, programmes, cycles, employers, hosts, timelines and the source messages (read read-only):

| Family | What it really was | Decision / mechanism |
|---|---|---|
| Project Destined / "Unknown company" "Spring 2026 Building AI Agents Program" (6 groups, ~120 events) | A programme HOST. ~177 of its mails are weekly mass-mailing campaigns ("view this email in your browser", tracked list links, "CLICK HERE TO APPLY", "Powered By ...") that the readers typed applied/status; the role was the footer tagline. A few mails are real: receipts naming the opportunity applied to (CBRE Internship Opportunities, Crescent Communities, Amazon Affordable Housing Bridge Program, ICSC Foundation Bridge Program), a fellowship receipt, and invitations to JOIN a certificate programme. | Campaigns -> class `marketing` (deterministic `campaignFact`: bulk-mail platform AND an apply call-to-action AND no statement about the reader's own application). Invitations to join a programme -> `program-acceptance`. A receipt's own named opportunity ("Thank you for applying to the X") is the role of that message (`role:named`, `applyNamedRoles` before grouping), so one host yields one application per named opportunity. NOT merged because company and role matched. |
| HeadStart Fellowship (3 closed groups) | Two cycles (SP26 Dec-Jan; Fall 2026 Aug-Sep); each message is its own ending | left as is (small, closed) |
| Cornell astrophysics research (3) | Different programmes/senders (REU vs education programme), one with its own requisition | separate, correct |
| Robinhood (2) | The second mail ("Important information about your application") is not a receipt | `NOT_RECEIPT` extended; now one application |
| Coinbase (2), Microsoft (2, different requisition IDs), F5 (2, weeks apart) | Genuinely separate applications | separate, correct (a receipt cannot continue an application that has its own receipt) |
| CodePath (2) | Course promotions typed as applications | left (no campaign markers); one proposed ending remains |

After: **7 families, 16 opportunities, 34 events** (the rest are the legitimate separate applications above). No new table was needed: the persistent, evidence-backed identity facts (`role:named`, requisition, class, `relation:vendor_for`, `own:receipt`) are stamped signals in the existing `recruiting_events.signals` column, and identity is derived from them identically on every view.

## Product-level change (not just the investigator)
- `lib/investigate/reattach.ts` (rollback `INVESTIGATE_REATTACH=off`): events the product itself contradicts (a message more than 60 days after a closed application's ending, or flagged ambiguous/suggested) are re-asked of the investigator with the event removed; if it resolves a DIFFERENT application that outscores the current one by >= 2 with no veto, the event is linked there and the opportunities are rebuilt, so Today, Pipeline and Review show the corrected journey. Corrections and confirmations are never moved. Result: Harvey's November reply now sits in the 2027 application (29 events); 2026 stays Closed (27 events).
- `NAMED_ROLES=off` rolls back named-role-before-grouping.

## Measured (live account 1; development evidence, not accuracy)
| | before | after |
|---|---|---|
| Events in the pipeline / opportunities | 630 / 208 | 504 / 203 |
| Sibling families / their events | 9 / 153 | 7 / 34 |
| Leave-one-out (215 -> 138 events of well-evidenced applications): returned to own application | 61.9% | 87.0% |
| ... resolved to an identical sibling (product fragment) | 20.9% | 3.6% |
| ... ambiguous (one question) | 16.7% | 8.7% |
| ... resolved elsewhere | 1 (investigator right, product wrong) | 1 (the product now agrees: re-attached) |
| Frozen validation set: journeys split / opportunities merging journeys | 2 / 1 | 1 / 0 |
| Validation recall, false opportunities | 72/72, 0/14 | 72/72, 0/14 |
| Review: needs-you / housekeeping / weak / resolved by class | 2 / 79 / 187 / 123 | 2 / 66 / 180 / 247 |
| Pipeline: active / quiet / accepted / closed / programs | 24 / 90 / 2 / 75 / 17 | 24 / 86 / 2 / 75 / 16 |
| Corpus (895 provisional labels): recall | 96.0% | 83.6% |

The corpus recall drop is the ~62 Project Destined campaign mails the provisional labels counted as applications (55 of them "Unknown company"); by the audit's own definition (partner newsletters and invitations to apply are not candidate history) they are not applications. Precision stayed 99.3%, false offers 0/4, real offers kept 8/8.
