# Catalog maintenance review — 2026-10-01

This review records the catalog trim to its core components and three block
revisions. Decisions from the [2026-08-15](catalog-review-2026-08-15.md),
[2026-09-07](catalog-review-2026-09-07.md), and
[2026-09-26](catalog-review-2026-09-26.md) reviews otherwise stand.

## Trim

The catalog keeps the components its maintainer uses as a core set. Removed
entries are rejected for the current catalog, not deprecated; re-adding one
requires a new review.

| Component | Decision |
|---|---|
| `block/ci-production-parity` | **Remove.** |
| `skill/audit-code` | **Remove.** |
| `skill/review-pr` | **Remove.** |
| `skill/verify-frontend` | **Remove.** |
| `skill/debug-issue` | **Remove.** The 2026-09-07 addition is withdrawn. |
| `skill/database-migration` | **Remove.** The 2026-09-07 addition is withdrawn. |
| `command/verify-work` | **Remove.** |
| `skill/audit-docs` | **Shorten**, version `1.1.0`. The description no longer forbids edits unless explicitly asked. |

## Block revisions

| Component | Change | Decision |
|---|---|---|
| `block/tdd` | The trim had reduced the cycle to "follow TDD", which no longer said to write the test first. The text now requires a test that fails for the expected reason before the change (a reproduction for bugs), the smallest passing change, and refactoring limited to the touched code. Mocking is limited to external boundaries, and an impractical test-first case is reported instead of skipped. The "run the relevant checks after each change" clause is dropped because completion evidence and minimal implementation own verification. | **Retain**, version `1.3.0`. |
| `block/secure-defaults` | Adds injection-safe construction (parameterized queries; no shell commands, SQL, or HTML built from untrusted strings) and keeps secrets out of code, logs, and error messages. "Results" becomes "result counts". | **Retain**, version `1.2.0`. |
| `block/focused-changes` | "Preserve unrelated user work" becomes "Do not revert, stash, or overwrite changes you did not make", naming the destructive actions the rule exists to prevent. | **Retain**, version `1.1.0`. |

Each addition targets a common agent failure that the earlier wording did not
name. Aggregate always-loaded block text grows from 365 to 438 words (about 739
tokens) when all blocks are installed. These are editorial decisions, not measured behavioral improvements.
