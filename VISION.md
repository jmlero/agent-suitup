# `agent-suitup` vision

## The promise

`agent-suitup` makes it easy to adopt and maintain a small, opinionated
collection of agent working agreements and task workflows. Each item should
explain the problem it addresses, when it applies, and its tradeoffs. Projects
choose what fits, review the changes, and keep ownership of their instructions.

The primary audience is developers shipping and maintaining small production
projects with coding agents. The catalog shares the maintainer's curated
practices so adopting them does not require rewriting instructions in every
repository. Public usefulness comes from clear applicability and defensible
choices; an item need not apply to every developer.

An approachable, polished CLI makes selection, inspection, installation, and
maintenance straightforward. Generated files remain readable, version-controlled,
and useful without the CLI. Selecting nothing is a successful outcome.

## Central thesis

Every instruction must earn its place through an explicit working agreement,
useful task knowledge, or evidence that it addresses a recurring failure.
Prefer concrete triggers, decisions, exceptions, and completion conditions to
generic reminders about competent engineering.

More capable models may need fewer explanations of familiar practices. They
still need preferences and constraints they cannot infer. Guidance should be
reviewed as models and agent configurations change; shorter text alone does not
establish improvement. A detailed, selectively loaded skill can justify its
length when it carries necessary procedure or reference material.

Repository signals establish relevance, not effectiveness or consent. An
editorial preference must be presented as such. Claims of improved outcomes
require observed behavior, with the model, agent configuration, and limitations
recorded. Nothing is installed merely because it exists in the catalog.

## Guidance routing

| Surface | Correct use | Loading |
|---|---|---|
| Direct block | An explicit project agreement that applies across relevant changes | Always through `AGENTS.md` |
| Skill | A recognizable task with a procedure, examples, or references | On demand |
| Command | A workflow that should run only when explicitly invoked | Explicit |
| Reference | Background detail used by a skill, not a standalone behavior | Selective |
| Integration | Vendor-native capability with an operational prerequisite | Optional and agent-specific |
| Nothing | Facts or behavior reliably inferable from code, configuration, or current models | No context cost |

A block must declare a stable ID, semantic version, project scope, source,
loading mode, behavioral outcome, and reason it deserves always-loaded context.
Its exact word count and token estimate are derived from normalized content.
Size informs editorial review; no arbitrary word or token range establishes
validity. Keep the conditions and exceptions needed to interpret the agreement.

Task-specific guidance does not become a block merely because it is short.
Background information does not become a skill merely because a file exists.

## Product principles

### Choose behavior, then its delivery surface

Working agreements and task workflows are both core offerings. Users should
understand the behavior, applicability, and tradeoffs before choosing it. File
format or catalog size should not determine which capability matters most.

`AGENTS.md` is the canonical portable project instruction file. Blocks are
defined once and embedded directly, without mandatory links whose only purpose
is recovering a few lines of required text.

Portable skills and commands live in `.agents/skills`. Codex and Grok Build use
the canonical files directly. Thin adapters expose them to other agents without
duplicating the core content.

For Claude Code, `CLAUDE.md` should be a symlink to `AGENTS.md` when a new bridge
can be created safely. An existing user-authored `CLAUDE.md` is preserved and
receives a managed `@AGENTS.md` import instead. Claude-only guidance remains an
intentional overlay rather than being copied into the portable file.

### Assessment before installation

Selection should reduce repeated setup decisions and make the resulting changes
easy to inspect. Optional integrations follow the portable content decision.
Non-interactive assessment never interprets a recommendation as consent to
modify the repository. Skills and working agreements must both be discoverable
in the initial selection experience.

### Context and operational cost

Always-loaded rules must be focused and applicable to the repositories that
adopt them. Detailed procedures and current framework knowledge belong on
demand. Large examples and references are loaded only when needed.

The CLI shows individual and aggregate context costs before applying blocks.
Review also considers unnecessary work, repeated permission requests, conflicts,
and maintenance burden. Catalog review chooses whether to retain, shorten,
demote, replace, or remove each component.

### Declarative and reversible

Every managed component has a stable identity, source, version, scope, and
integrity record. Operations are idempotent, reversible, inspectable,
updateable, and reproducible.

`AGENTS.md` uses compact ownership boundaries. Versions and checksums live in
the lockfile rather than being repeated inside the prompt. Legacy boundaries
remain readable for safe migration.

The CLI never overwrites unowned content. Ambiguous ownership or local drift is
reported and requires explicit resolution.

Preserving bytes does not establish that two instructions agree. Users must be
able to inspect additions beside existing guidance. Local customization is a
legitimate need; the product should make ownership and update consequences
clear. Today, edits inside managed content are reported as drift and require
explicit resolution before replacement.

### Integrations tell the operational truth

Plugins are settings and runtime integrations, not prompt components. They must
declare the agent they support, current marketplace identity, last verification
date, and required executables. The CLI must not call an integration healthy
when a known prerequisite is absent.

External products that the CLI merely recommends are not managed components.
They belong outside the desired-state manifest until the CLI can install,
verify, update, and remove them honestly.

### Small coherent catalog

The catalog encodes a recognizable set of working preferences and workflows.
Each addition needs a stated audience, a concrete problem or policy choice,
applicability boundaries, and tradeoffs in its content or review record. A
scoped framework or provider workflow can qualify when others can use it
without inheriting private account details or project-specific assumptions.

Avoid undifferentiated alternatives and overlapping rules. Preserve examples of
observed failures and explain rejected candidates. Engineering judgment should
be visible in these choices, including exceptions and reasons to install
nothing. Installer tests establish lifecycle behavior, not instruction efficacy.

Remote content is pinned, attributable, license-preserving, bounded, and loaded
on demand.

## Current CLI

Interactive `init` and `add --interactive` open a terminal control panel with
category tabs for skills, blocks, commands, and integrations. A searchable catalog
and detail panel explain purpose, applicability, examples, tradeoffs, loading,
and installation. The full guide remains readable in small terminals. Installed
items stay visible; no new items are preselected. Skills can be installed alone.

After selection, Connect chooses agent bridges and scope. The final review shows
destinations, aggregate block cost, and an optional exact preview before any
writes. Numbered prompts support inline inspection through `--plain` and piped
input; `inspect <component>` shows a read-only guide without remote downloads.

```text
agent-suitup init                       # explore, connect, and review
agent-suitup init --yes                 # assess and leave unchanged
agent-suitup list blocks                # see exact word/token costs
agent-suitup inspect skill/review-pr     # purpose, example, and installation
agent-suitup add block/completion-evidence
agent-suitup add skill/verify-frontend
agent-suitup add command/verify-work
agent-suitup add plugin/github          # optional Claude edge
agent-suitup plan                       # preview exact changes
agent-suitup remove <component>         # remove only owned state
agent-suitup update                     # refresh visible, pinned content
agent-suitup doctor                     # detect drift and missing prerequisites
```

Normal output is compact and sectioned. Exact bodies are reserved for `plan`
and `--dry-run`.

## Explicit non-goals

- Becoming a universal agent package manager.
- Installing universal defaults into every repository.
- Encoding private account details or assumptions that only fit one project.
- Loading detailed task procedures in every session.
- Treating every third-party recommendation as managed state.
- Normalizing agent-native features that have no safe equivalent.
- Claiming fewer tokens improve results without representative evaluation.
- Mutating user-authored instructions that agent-suitup does not own.

## Risks to keep visible

- Over-compression can remove constraints that make guidance reliable.
- Broad applicability can dilute concrete experience into generic advice.
- Locally useful preferences may have no measurable benefit in another agent.
- A polished installer cannot compensate for an undistinguished catalog.
- Weak recommendation signals can turn optional policy into accidental defaults.
- A growing catalog can recreate the context and maintenance bloat it opposes.
- Marketplace identifiers, prerequisites, and remote skills change over time.
- Symlinks are not equally portable; bridges require a safe import fallback.
- The `agent-suitup` name still needs registry, executable, domain, and
  trademark checks before public release.

## Definition of success

`agent-suitup` succeeds when:

- a user can recognize which agreements and workflows fit their project;
- repeated setup requires less effort than manually maintaining copied text;
- each component has a defensible purpose, scope, and documented tradeoffs;
- selecting nothing is a clear, successful outcome;
- every block exposes its individual and aggregate context cost;
- the same installation applied twice produces no changes;
- every managed component can be inspected, updated, and removed safely;
- agent integrations remain optional and verify known prerequisites;
- portable content works in multiple agents without duplicated core text; and
- review retires guidance that is redundant, counterproductive, or obsolete.
