# Evaluation: Karpathy-inspired coding guidelines

- Date: 2026-08-15
- Candidate: `karpathy-guidelines`
- Canonical community source evaluated:
  [`multica-ai/andrej-karpathy-skills`](https://github.com/multica-ai/andrej-karpathy-skills)
  (the former `forrestchang` URL redirects there)
- Canonical candidate file:
  [`skills/karpathy-guidelines/SKILL.md`](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/skills/karpathy-guidelines/SKILL.md)
- Authorship: community packaging derived from, but not authored or published by,
  Andrej Karpathy
- Declared license: MIT in the skill frontmatter and README
- License caveat: the repository had no top-level `LICENSE` file and GitHub's
  repository metadata reported no detected license at review time
- Status: routing and overlap review; rejected, installs nothing

## Candidate behavior

The candidate combines four general coding behaviors: surface uncertainty,
prefer simple implementations, avoid unrelated edits, and define verifiable
success criteria. Its description triggers on writing, reviewing, or
refactoring code, so the advertised on-demand skill applies to nearly every
coding task rather than a recognizable specialist workflow.

## Baseline comparison

| Candidate behavior | Baseline in this project/catalog | Distinct value found |
|---|---|---|
| Surface uncertainty and alternatives | Current agents already receive repository instructions to make scoped assumptions and stop before material scope changes. | No representative evidence that another general block improves current-model behavior. |
| Simplicity first | `block/ponytail` already expresses the smallest safe implementation outcome with attribution and lifecycle coverage. | Substantial duplication. |
| Surgical changes | Root `AGENTS.md` already requires focused changes and preservation of existing user work; modern coding agents also receive this base safety behavior. | No distinct task workflow. |
| Verifiable goals | `block/tdd`, `block/completion-evidence`, and `command/verify-work` cover test-first work, completion evidence, and explicit validation separately. | Substantial duplication with poorer selectability. |

The bundle adds maintenance and prompt overlap without a distinct outcome. As a
single skill it also routes broadly applicable behavior to a trigger that would
either fire almost always or be absent when needed. Splitting it would recreate
components already present except for the unsupported uncertainty block.

## Decision

**Reject; install nothing.** Do not add the community skill, a Claude plugin,
or a copied always-loaded bundle. The candidate lacks incremental behavioral
evidence, overlaps three existing portable surfaces, and has weaker license
packaging than this catalog requires for redistributed remote content.

Reconsider an individual principle only after a paired evaluation demonstrates
a current-model baseline gap on representative tasks. Any accepted content must
use an immutable source revision, include the complete upstream license and
attribution, and be routed independently rather than reintroducing the bundle.

## Later policy extraction — 2026-09-07

The full bundle remains rejected. A separate
[`block/focused-changes` review](2026-09-07-focused-changes.md) adopts only edit
scope as an explicit project policy in original agent-suitup wording. Its rationale
corrects an important limit of the baseline above: this repository's `AGENTS.md`
is not installed into consuming projects. This decision establishes an opt-in
working agreement; it does not establish a measured improvement in model
behavior or redistribute the upstream skill.
