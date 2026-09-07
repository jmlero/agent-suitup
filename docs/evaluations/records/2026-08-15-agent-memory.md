# Evaluation: durable agent memory block

- Date: 2026-08-15
- Candidate: a compact always-on rule that asks agents to preserve non-obvious
  project constraints, decisions and reasons, and durable corrections
- Proposed loading form: direct block
- Proposed storage: an additional repository-owned Markdown memory file
- Status: design and negative-case evaluation; rejected, installs nothing

## Hypothesis

A durable memory rule could reduce repeated discovery across sessions when a
fact is important, stable, non-obvious, and absent from code, configuration,
documentation, Git history, and `AGENTS.md`.

## Representative comparison

| Case | Without a memory block | With the proposed block | Assessment |
|---|---|---|---|
| Runtime constraint encoded in `package.json` | The agent rediscovers the authoritative value. | The agent may copy it into memory. | Duplication creates drift without adding knowledge. |
| Architecture decision with an ADR | The agent reads the decision and rationale on demand. | A summary may diverge from the ADR. | Existing durable documentation is the better source. |
| Repeated correction not represented anywhere | A later session may relearn it. | A concise entry could prevent repetition. | Real potential benefit, but the durable fix is normally an `AGENTS.md` rule, ADR, test, or code comment at the relevant boundary. |
| Transient incident detail, credential, or user preference | It remains outside repository history unless deliberately documented. | An eager agent may persist stale or sensitive material. | Material safety and maintenance regression. |

The only positive case is narrow and requires judgment about durability,
secrecy, ownership, expiry, and the authoritative destination. An always-loaded
instruction cannot itself make those judgments reliable. A separate memory file
would fragment project truth and require lifecycle behavior for preserving user
entries, correcting stale entries, and preventing accidental secrets.

## Decision

**Reject the always-on memory block; install nothing.** Prefer updating the
authoritative artifact: encode enforceable constraints in tests or
configuration, cross-cutting agent rules in `AGENTS.md`, and durable decisions
with reasons in project documentation or ADRs. This keeps discovery close to
the source and avoids another always-loaded maintenance protocol.

Reconsider only if repeated cross-session trials show material relearning
failures that those existing surfaces cannot address, and if a design proves
safe ownership, secret handling, staleness review, and removal while preserving
user-authored entries. A deliberately invoked capture workflow would be a more
plausible form than an always-on block.
