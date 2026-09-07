# Evaluation: `block/focused-changes`

- Date: 2026-09-07
- Review type: editorial applicability and overlap review
- Candidate: [canonical block](../../../catalog/blocks/focused-changes.md),
  version `1.0.0`; original agent-suitup wording under Apache-2.0
- Policy inspiration: the change-scope principle in the community
  [Karpathy guidelines](https://github.com/multica-ai/andrej-karpathy-skills/blob/64723a49ea6117894304eb491f0d32a60570bf45/skills/karpathy-guidelines/SKILL.md),
  revision `64723a49ea6117894304eb491f0d32a60570bf45`
- Loading and scope: always loaded, project only, explicitly selected
- Normalized cost: 57 words, approximately 99 tokens
- Status: policy design review; no behavioral trial or efficacy measurement

## Policy and distinct purpose

Adopting projects choose to keep edits within the requested outcome, preserve
unrelated work, and distinguish cleanup caused by a change from incidental
cleanup. Necessary supporting refactors and requested cleanup remain allowed.
The policy adds no clarification gate, test requirement, or repository-wide
cleanup audit.

Ponytail governs implementation complexity; this block makes edit scope and
cleanup boundaries explicit. Equivalent existing project instructions can make
it redundant. The agent-suitup repository's own `AGENTS.md` is not distributed to
adopting projects, so it cannot establish that those projects already have the
policy. The complete Karpathy bundle remains rejected for overlap and overly
broad routing; this block does not copy or install its text.

## Applicability cases

These are hypothetical interpretation checks, not generated model outputs.
No control/treatment runs, independent scoring, or raw execution traces exist.

| Case | Intended policy decision |
|---|---|
| Fix a parser while nearby comments and an unrelated user draft could be edited | Change the parser and necessary supporting code; preserve the unrelated material. |
| Replace an implementation and leave its import unused | Remove the newly unused import; leave unrelated pre-existing dead code alone. |
| A requested refactor requires changes to callers and removal of obsolete helpers | Complete the supporting changes and needed cleanup; do not interpret focus as a ban on refactoring. |
| Negative case: the user explicitly requests formatting or dead-code cleanup | Perform that requested cleanup without asking for redundant permission or inventing a narrower bug-fix scope. |

The wording distinguishes these decisions during editorial review. This does
not show whether models actually follow them more reliably with the block.
CLI lifecycle tests cover project-only scope, exact content installation,
preview, idempotency, drift protection, and removal preserving user text.

## Decision

**Retain** as an opt-in working agreement with no automatic suggestion. Its
justification is the explicit edit-scope policy, not an observed baseline gap
or a claim that more instructions improve coding outcomes.

Run the paired protocol before making an efficacy claim or recommending it
automatically. Shorten or remove it if it duplicates adopting projects' rules,
or if observed use blocks necessary supporting work, adds needless questions,
or expands a focused task into a cleanup audit. Attribution is recorded in
[third-party notices](../../../THIRD_PARTY_NOTICES.md#focused-changes-source-of-the-policy-idea).
