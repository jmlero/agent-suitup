# Catalog evaluation

Evaluation asks whether a component changes representative task outcomes enough
to justify its loading and maintenance cost. Token count is a cost, not a
quality score.

## When to evaluate

Evaluate a candidate before adding it, before making it a recommendation, after
a material content change, and during catalog review. Re-run relevant records
when a model generation changes or when repository context makes the guidance
newly inferable.

## Paired protocol

1. Identify the candidate version, normalized word/token cost, target
   repositories, hypothesis, and failure mode.
2. Choose at least three representative tasks plus one negative case where the
   component should not cause extra work.
3. Run each task in a fresh context with the same repository, model, settings,
   and tools. The control has no candidate; the treatment adds only the
   candidate. Randomize order and use at least three repetitions when the
   result will support an automatic recommendation.
4. Preserve the prompts, raw outputs, tool results, and run metadata. Have a
   reviewer score outputs without knowing which condition produced them when
   practical.
5. Score task success first, then correctness, safety, useful evidence,
   unnecessary behavior, and concision. Record failures and uncertainty; do
   not substitute prompt inspection for behavior evidence.
6. Compare the observed benefit with always-loaded context and maintenance
   cost. A conditional repository signal establishes relevance, not efficacy.
7. Choose exactly one outcome: **retain**, **shorten**, **demote**, **replace**,
   **remove**, or **reject**. State what evidence would reverse the decision.

Use [template.md](template.md) for new records. A non-blinded calibration may
exercise the format, but it cannot justify an automatic recommendation. Such a
record must say so plainly.

## Review rule

Every catalog review must revisit each component's form and choose a deletion-
pressure outcome. Blocks receive the highest scrutiny because they are always
loaded. A block is demoted to a skill when its value is task-recognizable, and
removed when current models plus repository context reliably produce the same
behavior. Unsupported candidates are recorded as rejected rather than kept as
aspirational catalog entries.
