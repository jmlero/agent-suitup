---
name: debug-issue
description: Diagnose a reported bug, regression, or unexplained failure by testing hypotheses against code and runtime evidence. Use for investigating a concrete symptom; general audits and verification-only requests have separate workflows.
license: Apache-2.0
---

# Debug Issue

Establish why the reported behavior occurs and, when a fix is requested, correct
the cause within the task's scope. A diagnosis-only request should leave the
implementation unchanged. Use existing authorization for requested fixes.

## Establish the failure

- Identify expected and actual behavior, affected inputs, and the conditions
  under which the failure occurs. Read relevant repository instructions and
  discover reproduction commands from the project's configuration or docs.
- Reproduce with the smallest useful case in an appropriate local or test
  environment. For intermittent failures, preserve failing inputs, timing, seed,
  runtime, and logs when available; a passing retry does not explain a failure.
- If reproduction is unavailable, distinguish observations from assumptions and
  continue with the evidence available. Ask for missing evidence only when it
  prevents the next useful investigation step.

## Isolate the cause

- Trace the failing path through callers, state, configuration, and recent
  changes. Find the earliest point where actual behavior diverges from the
  expected result; the last error in a log may only be a downstream symptom.
- Choose plausible competing explanations and a check whose outcomes distinguish
  them. Change one relevant condition at a time where practical and use the
  result to discard or refine hypotheses. An obvious cause needs only a focused
  confirmation, not a formal investigation report.
- Preserve useful diagnostics before restarting, clearing state, or changing
  configuration. Avoid blind retries and speculative edits. If another attempt
  would repeat the same evidence, report what is missing and the next useful
  check rather than cycling through guesses.
- During an active incident, follow the project's incident procedure and
  prioritize an authorized mitigation when needed. Preserve evidence and track
  unresolved causes; do not delay recovery solely to finish diagnosis.

## Fix and verify

When a fix is requested, use the supported explanation to make a focused change.
Do not hide the symptom by suppressing errors, weakening assertions, skipping
tests, or raising timeouts unless evidence establishes that the original
behavior or limit was wrong. Preserve unrelated working-tree changes.

Re-run the reproduction and relevant checks. Add a regression test when the
failure has a practical, meaningful test surface, following project test policy.
Remove temporary instrumentation introduced for the investigation unless it is
part of the intended fix. Report the cause and supporting evidence, changes
made, checks run, and anything unresolved. Qualify an unconfirmed diagnosis.
