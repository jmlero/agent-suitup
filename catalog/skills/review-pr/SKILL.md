---
name: review-pr
description: Review a pull request or supplied change set for correctness, regressions, security, tests, compatibility, and project conventions. Use when asked to review a PR; do not use for a whole-codebase production audit.
---

# Pull request review

Use the PR number, URL, or local change set supplied by the user.

## Workflow

1. Read repository instructions and relevant code.
2. Gather the PR description, diff, commits, checks, and existing review comments
   with available read-only tools. If GitHub CLI is configured, useful commands
   include `gh pr view`, `gh pr diff`, and `gh pr checks`.
3. Trace changed behavior into callers, tests, schemas, configuration, and docs.
4. Run narrow, relevant checks when permitted.

Review for:

- correctness, error cases, and backward compatibility;
- injection, authorization, secrets, unsafe input, and information exposure;
- sufficient tests for successful and failing behavior;
- consistency with framework and repository conventions;
- focused scope, migrations, configuration, and user-visible documentation.

## Report

Lead with findings, ordered by severity. Each finding must include:

- severity: blocking or non-blocking;
- `file:line` when available;
- the concrete failure mode and why it matters;
- a practical correction.

Then give a short summary, verification performed, and verdict: APPROVE,
REQUEST_CHANGES, or COMMENT. Do not invent findings to fill categories. If no
issues are found, say so and name any residual risks or checks not run.
