# Catalog maintenance review — 2026-10-01

This review records the catalog trim to its core components, four block
revisions, and two block additions. Decisions from the [2026-08-15](catalog-review-2026-08-15.md),
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
| `block/completion-evidence` | Handoffs lead with anything waiting on the user, and research or analysis states what could not be found or checked and where the agent looked. Both belong to the handoff this block already owns, so they extend it instead of forming a separate block. | **Retain**, version `1.1.0`. |
| `block/focused-changes` | "Preserve unrelated user work" becomes "Do not revert, stash, or overwrite changes you did not make", naming the destructive actions the rule exists to prevent. | **Retain**, version `1.1.0`. |

Each addition targets a common agent failure that the earlier wording did not
name. These are editorial decisions, not measured behavioral improvements.

## Block additions

Both additions, and the completion-evidence extension above, apply guidance from
Anthropic's [Getting the most out of Opus 5.5](https://claude.dev/blog/getting-the-most-out-of-opus-5-5/)
in original agent-suitup wording. The guidance targets Claude Code; both rules
are worded for any agent.

| Component | Rationale | Decision |
|---|---|---|
| `block/autonomy` | The guide's recommended standing instruction for autonomous work: continue through steps that need no input, put status notes with the next action, and stop only when blocked or before destructive actions. The guide reverses this for pair programming, so the block is an explicit policy choice and its selection text says when to skip it. | **Add**, version `1.0.0`. |
| `block/task-list` | The guide recommends keeping a long run's task list in a file and updating it as work proceeds, so progress survives context summarization. The file is `TASKS.md` at the repository root; an existing file keeps its other entries, and the agent removes its own section when done. Agents with built-in task tracking may not need it. | **Add**, version `1.0.0`. |

Rejected from the same guide: splitting work across subagents (agent-specific,
not portable), blocking-only code review (a workflow, not a standing rule),
design-habit exclusion lists (project taste; `plugin/frontend-design` covers
design), and prompt hygiene such as removing "think carefully" lines (no block
contains such filler).

Aggregate always-loaded block text grows from 365 to 591 words (about 963
tokens) when all blocks are installed.
