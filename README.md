# agent-suitup

A dependency-free CLI for adding curated coding-agent instructions and task
workflows to your projects. Choose the agreements that fit, preview the changes,
and maintain them without copying instructions between repositories.

Blocks live directly in `AGENTS.md`; skills and explicit commands live in
`.agents/skills`. Installed content stays readable and useful without the CLI.
Every component is opt-in, and selecting nothing is a valid outcome.

## Get started

Requires Node.js 20 or newer and Git. Install from GitHub:

```bash
npm install --global git+https://github.com/jmlero/agent-suitup.git
```

Run commands from the project you want to configure:

```bash
agent-suitup init
```

Setup opens a terminal control panel with three steps: **Explore → Connect →
Review**. Browse **Skills, Blocks, Commands, and Integrations** in one place,
choose your agent and installation scope, then review the files before installing.
Nothing is preselected. Skills can be installed on their own.

- **Tab** or **1–5** switches categories. **↑ / ↓** browses, **Space** selects,
  and **Enter** continues.
- **/** to search; Enter keeps the filter and Esc clears it. Selections survive
  filtering. **a** toggles all visible items; **n** clears the selection.
- A detail panel explains what each item does and when it fits. **i** opens its
  full guide: example, tradeoffs, loading cost, install path, and usage. Scroll
  with arrows or Page Up / Page Down; Enter or Esc returns to the catalog.
- **s** shows your selection. Totals update live; installed items are marked and
  kept in place. Wide terminals show two panels; smaller ones use a compact view.
- At review, **p** shows exact changes, **Enter** installs, and **n** cancels.

Use `init --plain` for numbered prompts, including with screen readers. This
mode also activates for piped input, small terminals, and `TERM=dumb`. It accepts
numbers, ranges (`1,3-5`), component IDs, `all`, or `none`, and lets you correct
invalid answers. Type `i <number or ID>` to read an item's guide. Use
`--interactive` when piping answers and `NO_COLOR=1` to
disable color. Ctrl+C cancels setup. Esc returns from a guide or selection view,
clears a search, or quits the catalog when there is nothing to dismiss. Closing
input never approves an installation.

Finishing without a selection leaves project and user files unchanged, including
existing installations. `init --yes` always performs a read-only assessment.
Adapter, scope, and force flags do not turn an empty selection or assessment
into an installation or repair.

To choose a component explicitly, preview it and then apply it:

```bash
agent-suitup list blocks
agent-suitup add block/completion-evidence --dry-run
agent-suitup add block/completion-evidence
```

## Catalog

Blocks express project working agreements. Use the
[selection guide](docs/choosing-blocks.md) for applicability, reasons to skip,
tradeoffs, and links to the exact instructions.

| Block | Purpose |
|---|---|
| `block/tdd` | Test-driven development |
| `block/ponytail` | Smallest safe implementation |
| `block/completion-evidence` | Report verification before claiming completion |
| `block/transparent-shortcuts` | Make material deferred work visible |
| `block/secure-defaults` | Protect new external boundaries by default |
| `block/ci-production-parity` | Keep CI and production execution aligned |
| `block/no-unfinished-ui` | Omit unavailable product paths |
| `block/focused-changes` | Keep edits scoped, preserve unrelated work, and allow necessary supporting refactors |

### Install and use skills

A skill is a task workflow loaded on demand; a block is a standing rule in
`AGENTS.md`. You can choose skills in `init`, or inspect and install one directly:

```bash
agent-suitup inspect skill/review-pr
agent-suitup add skill/review-pr
```

Then ask your agent: **“Use review-pr to review this diff.”** Project skills live
in `.agents/skills/<name>/SKILL.md`. Add `--scope user` to install under
`~/.agents/skills` for use across projects. For Claude, choose **claude** during
setup or pass `--adapter claude` to create its skill bridge.

| Skill | Use it for |
|---|---|
| `skill/audit-code` | A broad production readiness audit before release |
| `skill/audit-docs` | Stale instructions, inaccurate docs, and broken references |
| `skill/review-pr` | A focused review of a pull request or diff |
| `skill/verify-frontend` | Visual and interaction checks for changed interfaces |
| `skill/terraform-skill` | Version-aware Terraform and OpenTofu guidance |
| `skill/fastapi` | Version-aware FastAPI guidance |
| `skill/debug-issue` | Diagnose a concrete failure and verify a focused fix when requested |
| `skill/database-migration` | Prepare and validate schema changes or data backfills, including deployment and recovery |

For example, ask **“Use debug-issue to investigate and fix this regression”** or
**“Use database-migration to plan this schema change.”** Both are bundled and
support project or user scope. Diagnosis, planning, and review requests preserve
the implementation; preparing a migration does not authorize production
execution.

```bash
agent-suitup add skill/debug-issue skill/database-migration --dry-run
agent-suitup add skill/debug-issue skill/database-migration
```

FastAPI and Terraform skills are downloaded when preparing a selected
installation, pinned to immutable revisions, and include upstream references and
licenses. Browsing and `inspect` do not download them. Skill bodies load on demand;
agents may keep their discovery metadata in context.

Explicit commands provide verification and commit workflows. Install with, for
example, `agent-suitup add command/verify-work`.

Invoke command skills as `$verify-work` or `$commit-work` in Codex, and
`/verify-work` or `/commit-work` with the Claude or Grok adapters.

The CLI reports individual and aggregate block costs. Words are counted by
splitting trimmed, normalized Markdown on whitespace; tokens are estimated as
normalized UTF-8 bytes divided by four, rounded up. Costs inform selection and
review; there is no minimum or maximum token count for a valid block.

## Agent integrations

Codex and Grok Build read the canonical instructions and skills directly.
`--adapter grok` adds explicit command wrappers; see the
[tested compatibility matrix](docs/grok-build-compatibility.md) for details.

`--adapter claude` links skills from `.claude/skills` and prefers a
`CLAUDE.md -> AGENTS.md` symlink. An existing `CLAUDE.md` is preserved with an
`@AGENTS.md` import. Its other text remains a Claude-only overlay. If an owned
symlink is replaced by a regular file, `doctor` previews the repair and `update`
preserves that file while adding the import.

Optional Claude plugins cover frontend design, GitHub, TypeScript LSP, Pyright
LSP, and Codex delegation. Required executables are checked before settings are
changed. Authentication and runtime setup remain separate from installation.

```bash
agent-suitup add command/verify-work --adapter grok
agent-suitup add plugin/github
```

## Manage an installation

| Command | Purpose |
|---|---|
| `list [blocks\|skills\|commands\|integrations]` | Browse the catalog |
| `inspect <component>` | Read purpose, examples, tradeoffs, and installation details |
| `add <component...>` | Install explicit selections; `add --interactive` opens the control panel |
| `plan` | Preview reconciliation of the existing installation |
| `update` | Apply updates and repair missing content |
| `remove <component...>` | Remove selected managed components |
| `doctor` | Check drift and known prerequisites without writing |

Prefix commands with `agent-suitup`. Skills and commands support
`--scope project` or `--scope user`; blocks are project-only. Use `--help` for
all flags. Normal output is compact; `plan` and `--dry-run` show exact changes.

Desired components are recorded in `.agent-suitup/manifest.json`, with
versions, pins, and integrity records in `.agent-suitup/lock.json`. Keep
these files in version control alongside the installed content.

Text outside managed blocks is preserved. Local edits and unexpected file or
symlink replacements are reported as conflicts. Review `--force --dry-run`
before using `--force` to resolve destructive cleanup; directories are preserved
and symlink targets are not followed during deletion.

Before applying, the CLI rechecks every planned path. A change detected at that
point stops the entire change set, including state writes, even with `--force`.
Rerun to plan against current files. This check does not lock files against
concurrent edits during writes. Review additions alongside existing guidance
for conflicting policies as well as file changes.

## Contributing

Use [VISION.md](VISION.md) for product direction and
[catalog maintenance](docs/catalog-maintenance.md) for contribution criteria,
source attribution, and review decisions. Claims of improved agent outcomes
require [behavioral evaluation](docs/evaluations/README.md) beyond installer tests.
Keep documentation and examples suitable for public use.

From a checkout, run the CLI and validation without installing dependencies:

```bash
node bin/agent-suitup.mjs --help
npm test
npm run check
```

Licensed under [Apache-2.0](LICENSE). Adapted content retains its upstream
licenses and attribution in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
