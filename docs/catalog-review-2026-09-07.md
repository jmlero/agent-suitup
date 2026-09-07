# Catalog additions review — 2026-09-07

This review adds a project instruction block and two bundled, on-demand skills
to the decisions in the [2026-08-15 catalog review](catalog-review-2026-08-15.md).
Other components retain their previous decisions. No integration, command, or
subagent component is added.

| Component | Distinct purpose and loading form | Decision |
|---|---|---|
| `block/focused-changes` | A standing policy for edit scope and preservation of unrelated work. Ponytail focuses on implementation complexity; this policy explicitly distinguishes necessary cleanup from incidental edits. Agent Suitup's own repository instructions do not reach adopting projects. | **Retain** as an opt-in project block; no automatic suggestion. See the [review record](evaluations/records/2026-09-07-focused-changes.md). |
| `skill/debug-issue` | Investigate a concrete failure through reproduction and checks that distinguish hypotheses. TDD defines implementation order, audits survey risks, and verification reports check results; none supplies this diagnosis workflow. Load only for a reported issue. | **Retain** as an opt-in skill; no automatic suggestion. See the [evaluation record](evaluations/records/2026-09-07-debug-issue.md). |
| `skill/database-migration` | Prepare schema and data transitions with deployment compatibility, existing data, locks, partial progress, and recovery. Code audit can flag migration risks and CI parity aligns builds; this skill guides the transition itself. Load for migration work. | **Retain** as an opt-in skill; no automatic suggestion. See the [evaluation record](evaluations/records/2026-09-07-database-migration.md). |

Both skills start at version `1.0.0`, support project and user scope, and use
the existing portable skill lifecycle and optional Claude bridge. Canonical
sources live under `catalog/skills/`; content cost is derived from those files.
They are original agent-suitup instructions under Apache-2.0, with no copied
third-party implementation or bundled upstream documentation. External references
are reading aids, not downloaded managed content or executable instructions.

Focused changes starts at version `1.0.0` and is always loaded from a project's
managed `AGENTS.md` block. Its canonical source is
`catalog/blocks/focused-changes.md`, with context cost derived from that file.
The new wording is Apache-2.0; its policy inspiration is pinned and credited in
[third-party notices](../THIRD_PARTY_NOTICES.md#focused-changes-source-of-the-policy-idea).
The complete Karpathy bundle remains rejected. This narrow policy does not
import its clarification, simplicity, or testing instructions.

The selection guides explain applicability, examples, and limits. Debugging
must stay brief for obvious issues and respect diagnosis-only requests.
Migrations must adapt to disposable databases and maintenance windows, and
preparation must not imply authorization to mutate production.

The evaluation records distinguish scoped forward checks from paired efficacy
trials; the focused-changes record is an editorial policy review with
hypothetical cases, not a behavioral trial. Installer tests verify discovery,
supported installation scopes, adapter delivery, idempotency, repair, and
removal; they do not measure whether an agent performs better with these
components. No automatic recommendation is justified by these checks alone.
