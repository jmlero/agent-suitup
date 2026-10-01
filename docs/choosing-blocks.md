# Choosing instruction blocks

Choose an agreement you want the project to follow or a recurring problem you
want to address. Skip rules already expressed in repository instructions or
reliably followed by your agent. Selecting no blocks is a valid outcome.

This guide explains editorial choices for the current catalog. The examples
are hypothetical adoption decisions, not observed model improvements. Source
links show the exact instructions that will be installed in `.agents/rules.md`,
which `AGENTS.md` links; this guide adds no exceptions to those instructions and
is not loaded into your project's context.

## `block/tdd` — Test-driven development

[Read the instruction](../catalog/blocks/tdd.md).

- **Consider when:** Your team explicitly wants a failing behavioral test before
  implementation and the project has a practical automated test environment.
- **Skip when:** You prefer testing after exploration, or want test-first work
  only for selected changes. The current block applies to features and bug
  fixes broadly; it does not encode those narrower exceptions.
- **Tradeoff:** Choosing test order as project policy can require test setup
  before you know whether an exploratory implementation is worth keeping. The
  test must fail for the expected reason before the fix, refactoring is limited
  to the code the change touched, consistent with `block/focused-changes`, and
  only external boundaries are mocked. When testing first is impractical, the
  agent says so instead of silently skipping it.

Example decision: adopt for a maintained parser with executable behavior tests;
skip for a disposable interface prototype whose interactions are still being
decided.

For on-demand guidance on test seams, mocking, and test anti-patterns, pair it
with `skill/tdd`, which loads only when the agent uses it.

## `block/ponytail` — Minimal implementation

[Read the instruction](../catalog/blocks/ponytail.md). The stable ID retains the
upstream name; the agreement concerns implementation scope.

- **Consider when:** Changes repeatedly acquire unused extension points,
  wrappers, or dependencies, and your team prefers reusing existing facilities.
- **Skip when:** Existing project guidance already establishes that preference
  and changes consistently follow it.
- **Tradeoff:** The smallest safe change depends on the requirements. Planned
  extension points must be stated as requirements so they are not mistaken for
  speculative work. Small diffs alone do not establish correctness. The
  installed text ends with a one-line attribution to the MIT-licensed upstream.

Example decision: adopt after reviewing an unnecessary provider abstraction for
a project with one required provider; specify the abstraction explicitly when
multiple providers are part of the accepted scope.

## `block/completion-evidence` — Completion evidence

[Read the instruction](../catalog/blocks/completion-evidence.md).

- **Consider when:** Handoffs leave you asking which checks actually ran and
  which parts of the result remain unverified.
- **Skip when:** Your repository or agent already requires and consistently
  produces that evidence, or verification is only an occasional request.
- **Tradeoff:** Every handoff carries reporting overhead. Handoffs lead with
  anything waiting on the user, and research or analysis names what could not
  be found or checked. Repository-required
  checks still need a clear owner; this block does not define a project's test
  suite or guarantee that the checks chosen are sufficient.

Example decision: adopt when a handoff says a UI change is verified but leaves
unclear whether a browser was opened or only an automated check ran. The
[existing calibration](evaluations/records/2026-08-15-completion-evidence.md)
does not establish a measured improvement in real tasks.

## `block/transparent-shortcuts` — Transparent shortcuts

[Read the instruction](../catalog/blocks/transparent-shortcuts.md).

- **Consider when:** Necessary work is deliberately deferred during delivery
  and you want its reason and risk recorded in the project's normal task system,
  or in the handoff when the project has none.
- **Skip when:** Your delivery workflow already captures these decisions, or
  the supposed deferred work is merely a possible future feature.
- **Tradeoff:** Deciding what is necessary requires judgment. Overuse can turn
  speculative concerns into backlog noise; the block explicitly excludes work
  that is simply out of scope.

Example decision: record a required retry path that is consciously postponed;
do not create a debt item for a speculative multi-region architecture.

## `block/secure-defaults` — Secure defaults

[Read the instruction](../catalog/blocks/secure-defaults.md).

- **Consider when:** The project adds external boundaries such as APIs, file
  imports, or sensitive mutations, and you want a standing agreement about
  validation, injection-safe construction of queries and commands, secret
  handling, access control, and least privilege.
- **Skip when:** Equivalent policy is already enforced by your instructions
  and workflow, or the project does not introduce these boundaries.
- **Tradeoff:** This is broad guidance. It supplies neither a threat model nor
  concrete limits, roles, or authentication choices. Those still belong in the
  project's design. It should not be read as requiring authentication for every
  operation regardless of sensitivity. A protection relaxed on request is
  recorded like deferred work: in the normal task system, or in the handoff.

Example decision: consider it when introducing a privileged upload endpoint;
identify the permitted callers and size limits in the actual feature requirements.

## `block/no-unfinished-ui` — No unfinished UI

[Read the instruction](../catalog/blocks/no-unfinished-ui.md).

- **Consider when:** You want released interfaces to expose usable paths and
  omit controls for features that are not available.
- **Skip when:** The project has no interface, or it is an exploratory prototype
  whose purpose is to show proposed interactions before implementation.
- **Tradeoff:** Hiding unavailable paths can reduce discoverability. The block
  allows an explicitly required disabled or placeholder state; product
  requirements must explain when communicating unavailable behavior matters.

Example decision: omit an export button when export is outside the release
scope; keep an explanatory disabled state when the product explicitly requires
communicating a temporarily unavailable export service.

## `block/focused-changes` — Focused changes

[Read the instruction](../catalog/blocks/focused-changes.md).

- **Consider when:** You want changes to avoid incidental cleanup, formatting,
  or edits to unrelated user work, including reverting, stashing, or
  overwriting changes the agent did not make. The policy belongs in each adopting project's
  instructions; this repository's own `AGENTS.md` is not installed elsewhere.
- **Skip when:** Equivalent project guidance already applies and is followed.
- **Tradeoff:** Unrelated cleanup remains for a separate task. Necessary
  supporting refactors, cleanup needed for the change, and explicitly requested
  cleanup are allowed. This block does not add approval steps or test policy.

Example decision: a parser fix removes an import it made unused while preserving
an unrelated draft and nearby comments. A requested module refactor can still
update callers and remove obsolete code needed to complete that refactor.

Ponytail governs implementation complexity; this block governs the scope of
edits. They overlap in preferring small changes, so adopt both only when both
policies are useful. See the [review record](evaluations/records/2026-09-07-focused-changes.md)
for provenance and the limits of the evaluation.

## `block/autonomy` — Autonomy

[Read the instruction](../catalog/blocks/autonomy.md).

- **Consider when:** You hand agents whole tasks with a clear finish line and
  want them to keep going instead of checking in after each step.
- **Skip when:** You pair-program with the agent and want a summary before and
  after each action, or your agent's permission settings already define when it
  stops.
- **Tradeoff:** Fewer interruptions mean less chance to redirect mid-task. The
  block still stops before destructive or outward-facing actions and before
  changing anything outside the repository; it does not replace your agent's
  permission prompts.

Example decision: adopt for a team that assigns migrations ending in "the tests
pass"; skip for a developer who reviews each step as it happens.

## `block/task-list` — Durable task list

[Read the instruction](../catalog/blocks/task-list.md).

- **Consider when:** Agents run long multi-step tasks that can outlast their
  context window, and you want a resumable checklist in the repository that
  also captures steps discovered mid-task.
- **Skip when:** Tasks are short, or your agent's built-in task tracking is
  enough.
- **Tradeoff:** `TASKS.md` appears at the repository root during work and can
  end up in commits unless you ignore it or the agent removes its section when
  done. Other entries in an existing `TASKS.md` are left alone.

Example decision: adopt for a project where agents migrate dozens of endpoints
across sessions; skip for one where most tasks finish in a single session.

## Combining and previewing selections

Autonomy and completion evidence work together: the agent runs without
check-ins, then leads its handoff with anything waiting on you. Durable task
list helps autonomy survive long runs.

Verification appears in minimal implementation and completion evidence, and
both refer to the same relevant checks: minimal implementation starts with the
smallest ones, and completion evidence expands them when risk warrants and
reports what ran or was skipped. TDD governs test order rather than adding a
separate check routine. Installing all three does not establish three
independent verification benefits. Choose them for those differences.

Check the chosen agreements against existing project policies. For example,
the broad TDD block may conflict with a policy limiting tests to selected kinds
of changes. File preservation and declared catalog conflicts do not detect all
conflicts in natural-language instructions.

Preview an explicit selection before installing it:

```bash
agent-suitup list blocks
agent-suitup add block/no-unfinished-ui --dry-run
agent-suitup add block/no-unfinished-ui
```

The dry run shows the proposed file changes without writing them. Inspect the
canonical source and surrounding project instructions before accepting the
agreement. Editing an installed managed block is treated as local drift; the
guide does not provide a separate local-override mechanism.
