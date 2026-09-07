# Catalog review — 2026-08-15

This review applies the block/skill/command/integration/nothing routing rule to
every surviving component. `init` never installs a recommendation
automatically. Unless noted, **retain** means retain in its current form while
requiring stronger paired evidence before automatic recommendation.

## Portable blocks

| Component | Why this form and loading behavior | Review outcome |
|---|---|---|
| `block/tdd` | Implementation order affects most feature and defect work. It is an opt-in team policy, not an inferred default. | Retain as a compact block; no automatic suggestion. |
| `block/ponytail` | The constraint governs implementation choices throughout a task; the longer upstream skill duplicated the same outcome. | Retain the attributed block; duplicate skill removed. |
| `block/completion-evidence` | Evidence quality matters at every handoff, not only in a named workflow. | Provisionally retain, with [calibration](evaluations/records/2026-08-15-completion-evidence.md); no automatic suggestion. |
| `block/transparent-shortcuts` | Deferral decisions occur throughout planning and implementation. | Retain as opt-in; reassess against capable-model baseline. |
| `block/secure-defaults` | New trust boundaries require preventive choices before task-specific security review. Repository detection is too weak for consent. | Retain as opt-in; no automatic suggestion. |
| `block/ci-production-parity` | Parity affects dependencies, runtimes, builds, and deployments across repositories that have CI. | Retain with a conditional `hasCI` relevance signal; the signal is not efficacy evidence and never auto-installs. |
| `block/no-unfinished-ui` | This is a cross-cutting product policy for teams that choose it, not a universal frontend fact. | Retain as opt-in; no automatic suggestion. |

## On-demand and explicit workflows

| Component | Why this form and loading behavior | Review outcome |
|---|---|---|
| `skill/audit-code` | Production-readiness review is a recognizable, detailed task and should not consume every session. | Retain on demand. |
| `skill/audit-docs` | Documentation audit has a bounded trigger and multi-step procedure. | Retain on demand; suggest only when documentation exists. |
| `skill/review-pr` | Pull-request review is a distinct task with a structured rubric. | Retain on demand. |
| `skill/verify-frontend` | Viewports, states, and browser checks are task-specific procedures. | Retain on demand; suggest only for detected frontend frameworks. |
| `skill/terraform-skill` | Version-sensitive framework detail and references are large but valuable during Terraform work. | Retain remote and on demand, pinned with license; never always loaded. |
| `skill/fastapi` | Official version-sensitive framework guidance belongs beside FastAPI tasks only. | Retain remote and on demand, pinned with license. |
| `command/verify-work` | Validation is user-invoked and must not unexpectedly change an implementation. | Retain as explicit-only Agent Skill. |
| `command/commit-work` | Creating a commit is an external state change requiring explicit intent. | Retain as explicit-only Agent Skill. |

## Claude integrations

| Component | Why this form and loading behavior | Review outcome |
|---|---|---|
| `plugin/frontend-design` | This is a Claude-native capability, not portable prompt guidance. | Retain as optional Claude integration. |
| `plugin/typescript-lsp` | Language-server access is agent-specific and operationally depends on `typescript-language-server`. | Retain with prerequisite enforcement. |
| `plugin/pyright-lsp` | Language-server access is agent-specific and operationally depends on `pyright-langserver`. | Retain with prerequisite enforcement. |
| `plugin/github` | GitHub tool access and authentication are Claude-native operational concerns. | Retain as optional; repository detection signals relevance only. |
| `plugin/codex` | Delegation from Claude requires an existing Codex CLI and has no portable equivalent. | Retain with prerequisite enforcement. |

## Removed forms

The audit removed the duplicate Ponytail skill, the command-rewriting
`slim-cli` hook, invalid or overlapping Terraform and Superpowers plugin
mappings, and external tool records the CLI did not manage. They remain absent
until a new evaluation proves distinct value and the full lifecycle is honest.

The [Karpathy-inspired guidelines](evaluations/records/2026-08-15-karpathy-guidelines.md)
were rejected because their community bundle overlaps the catalog's existing
minimality, TDD, evidence, and focused-change guidance and lacks incremental
behavior evidence. The [agent memory block](evaluations/records/2026-08-15-agent-memory.md)
was rejected because a second durable store would duplicate authoritative
project artifacts and introduce staleness, ownership, and secret-handling risk.
Both decisions intentionally install nothing.
