# Catalog maintenance

The catalog is curated, not append-only. Use the routing table in
[VISION.md](../VISION.md#guidance-routing) before considering implementation,
then record the editorial rationale. Use the paired format in
[evaluations](evaluations/README.md) to evaluate claims of behavioral improvement.

For every addition or periodic review:

1. Name the intended users, the recurring problem or explicit policy choice,
   when the instruction applies, its exceptions, and its tradeoffs. Explain what
   it adds beyond existing repository and agent guidance. Scoped framework or
   provider workflows are eligible when they do not depend on private project
   assumptions.
   Keep the catalog's `selection.when`, `selection.consider`, and
   `selection.example` fields useful to someone choosing the component for the
   first time. These are installer explanations, not extra installed instructions
   or evidence of improved model behavior.
2. Select the narrowest truthful form: block, skill, explicit command,
   integration, reference inside a skill, or nothing.
3. Verify source, immutable revision where applicable, license, attribution,
   supported scope, loading behavior, prerequisites, and lifecycle operations.
4. For blocks, derive normalized context cost and require nonempty content, an
   always-on outcome, and justification. There is no word or token validity
   range. Review length alongside necessary conditions and exceptions. A
   repository signal may establish relevance, but representative paired
   behavior evidence is required before treating guidance as effective. Label
   editorial preferences and calibration examples honestly; installer tests do
   not establish instruction efficacy.
5. Review overlap, conflicts, ordering assumptions, and operational ownership.
6. Choose and record one deletion-pressure outcome: retain, shorten, demote,
   replace, remove, or reject. Do this even when no catalog file changes.
7. Update lifecycle tests, README user guidance, evaluation records, review
   date, and third-party notices as applicable. For block additions or changes,
   keep the [selection guide](choosing-blocks.md) aligned with the canonical
   instruction's applicability and tradeoffs. Clearly distinguish hypothetical
   adoption examples from observed behavior.

Component decisions are recorded in the
[2026-08-15 catalog review](catalog-review-2026-08-15.md), with focused changes,
debugging, and migration additions in the [2026-09-07 review](catalog-review-2026-09-07.md).
Rejected candidates remain documentation, not dormant catalog entries.
