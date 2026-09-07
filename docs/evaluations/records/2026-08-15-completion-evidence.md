# Evaluation: `block/completion-evidence`

- Date: 2026-08-15
- Evaluator/reviewer: GPT-5 Codex, single-session non-blinded calibration
- Model and settings: current Codex session; no independent repetitions
- Repository revision/fixture: `agent-suitup` working tree, completion-report
  scenarios below
- Candidate source and revision: `jmlero/app-meerkat` at
  `51b77a6a0506661979bef8c6b152d8b3d4fcc3ba`
- Candidate version: 1.0.0
- Loading form: optional direct block
- Normalized cost: 47 words, approximately 80 tokens
- Status: calibration baseline, not recommendation evidence

## Hypothesis

The block should make completion reports name checks, outcomes, and skipped
verification without inventing evidence or materially obscuring the result.

## Cases and samples

This calibration constructed one response per condition in the same session.
It tests whether the rubric and instruction distinguish observable outputs; it
does not isolate a model-treatment effect.

### Successful focused check

Task state: a parser fix and regression test are complete; `node --test` passed
12 tests; the full check was not run.

Control, without the block:

> Implemented the parser fix and added regression coverage. Everything is
> working.

Treatment, with the block:

> Implemented the parser fix and regression test. Validation: `node --test`
> passed 12/12 tests. Not run: the full repository check.

### Verification unavailable

Task state: a responsive CSS fix is complete, but no browser runtime is
available in the environment.

Control, without the block:

> Implemented the responsive layout fix.

Treatment, with the block:

> Implemented the responsive layout fix. Browser verification was not run
> because this environment has no browser runtime; responsive behavior remains
> unverified.

## Rubric and results

Each dimension is scored 0-2: accurate result, concrete verification status,
transparent skipped checks and risk, no invented evidence, and concise handoff.

| Case | Control | Treatment | Main difference |
|---|---:|---:|---|
| Successful focused check | 4/10 | 10/10 | Treatment names the command, result, and omitted check; control overclaims. |
| Verification unavailable | 6/10 | 10/10 | Treatment states the blocker and remaining uncertainty. |

No negative-case or repeated blinded run was performed, so these scores cannot
support causal or statistical claims.

## Decision

**Retain provisionally as an explicit opt-in block; do not recommend it
automatically.** The calibration shows a useful, scorable contract at a modest
cost, while its design applies to every task completion. Before adding an
automatic recommendation, run the full paired protocol with negative cases and
independent repetitions.

Remove or shorten the block if blinded runs show no meaningful baseline gap, or
if current models consistently report the same evidence without it. Demote it
to an explicit verification workflow if its benefit appears only on validation
tasks rather than general completion.
