# Catalog maintenance review — 2026-09-26

This review revises existing components and adds none. Decisions from the
[2026-08-15](catalog-review-2026-08-15.md) and
[2026-09-07](catalog-review-2026-09-07.md) reviews otherwise stand.

| Component | Change | Decision |
|---|---|---|
| `block/tdd` | The cycle repeats until the requirements are met, and refactoring is limited to the code the change touched. The earlier wording could read as a single pass and as permission to refactor beyond the change, contradicting `block/focused-changes`. | **Retain**, version `1.1.0`. |
| `block/ponytail` | Verification uses the shared "smallest relevant checks" wording. The installed text ends with a one-line attribution to the MIT-licensed upstream, because adopting repositories do not receive the package's notices. | **Retain**, version `1.0.1`. |
| `block/completion-evidence` | Reports the checks run instead of the commands run, matching the shared wording. | **Retain**, version `1.0.1`. |
| `block/ci-production-parity` | The CI-equivalent check joins the relevant checks and is reported as skipped when it cannot run, rather than introducing separate reporting wording. | **Retain**, version `1.0.1`. |
| `block/transparent-shortcuts` | Deferred work goes to the handoff when the repository has no task system, so the rule applies in every repository. | **Retain**, version `1.1.0`. |
| `block/secure-defaults` | The risk of a relaxed protection is recorded in the task system or the handoff, matching transparent shortcuts. | **Retain**, version `1.1.0`. |
| `skill/terraform-skill` | Pinned to upstream revision `0a3a4a66e99001347d36a41e10260a825be3ab62` instead of following `master`. The estimated cost is re-derived from the pinned content with its overlay (about 5,300 tokens). | **Retain**; bump the pin deliberately. |
| `skill/fastapi` | Pinned to upstream revision `192b12197eb04c2b4a691cce7d87261b21716714` instead of following `master`. The estimate is unchanged at about 2,700 tokens. | **Retain**; bump the pin deliberately. |
| `command/verify-work` | The catalog now declares its App Meerkat upstream, revision, and license, matching third-party notices. | **Retain**, metadata only. |

Every component with content now declares a license; first-party entries use
Apache-2.0. Aggregate always-loaded block text grows from 411 to 456 words
(about 781 tokens) when all blocks are installed. The additions resolve
conflicts and gaps between blocks rather than adding new obligations. As in
earlier reviews, these are editorial decisions, not measured behavioral
improvements.

## Delivery change: blocks move to `.agents/rules.md`

Blocks are no longer embedded in `AGENTS.md`. They are written to
`.agents/rules.md`, and `AGENTS.md` carries one managed line:
`Project rules: read and follow @.agents/rules.md before starting any task.`
Block text is unchanged. The descriptions of `block/tdd` (version `1.1.1`) and
`block/ponytail` (version `1.0.2`) no longer say they live in `AGENTS.md`.

Smoke checks on 2026-09-26, not paired evaluations:

- Claude Code 2.1.283 (Haiku, file tools disabled) quoted the TDD block from
  context, so the `@` import loaded it at session start. It also listed the
  linked `review-pr` skill and hid the slash-only `verify-work` command.
- Codex CLI 0.157.1 (default model, read-only sandbox) opened `.agents/rules.md`
  unprompted before planning an unrelated task, and planned test-first.
- Grok Build was not exercised: its project instructions and skills require a
  trusted folder. Its documentation and source show no import expansion.
