# agent-suitup

A dependency-free CLI for adding curated coding-agent instructions and task
workflows to your projects. Choose the agreements that fit, preview the changes,
and maintain them without copying instructions between repositories.

Supports Claude Code, Codex, and Grok Build. Blocks live in `.agents/rules.md`,
which `AGENTS.md` links with one managed line. Skills and skill commands live in
`.agents/skills`, and each agent you choose gets the files it reads. Installed
content stays readable and useful without the CLI. Every component is opt-in,
and selecting nothing is a valid outcome.

## Get started

Requires Node.js 20 or newer and Git. Install from GitHub:

```bash
npm install --global git+https://github.com/jmlero/agent-suitup.git
```

Run commands from the project you want to configure:

```bash
agent-suitup init
```

Setup has three steps: **Agents → Choose → Review**. The first row, **All
agents**, starts selected, so everything you install works with Claude Code,
Codex, and Grok Build; press Enter to keep it, or deselect any agent you do not
use. Agents found on your `PATH` or in the project are marked as detected. Then
browse **Blocks, Skills, Skill commands, and Integrations** in one place, and
review the files before installing. No catalog item is preselected. Skills can
be installed on their own.

- **Tab**, **Shift+Tab**, **← / →**, or **1–5** switches categories. **↑ / ↓**
  browses, **Space** selects, and **Enter** continues. Each group heading is a
  row too: **Space** on **Blocks** selects every block, and again clears them.
- **/** to search; Enter keeps the filter and Esc clears it. Pasted text goes to
  the search, so it never triggers shortcuts. Selections survive filtering. **a**
  toggles all visible items; **n** clears the selection.
- The details panel shows what each item does, when it fits, the files each
  chosen agent reads, and the exact text it adds: a block's rules, a skill's
  `SKILL.md`, or a plugin's settings entry. **i** expands it to the full screen.
  Scroll with arrows or Page Up / Page Down; Enter or Esc returns to the list.
- **s** shows your selection. Totals update live; installed items are marked and
  kept in place. Wide terminals show two panels; smaller ones use a compact view.
- New items install for **this project** by default. **u** switches skills,
  skill commands, and integrations to **all projects** (your home folder) and
  back; blocks always stay in the project. `--scope user` starts there instead.
- The review lists your agents, where items install, each group, the always-on
  cost, and every file that changes. **p** shows exact changes, **Enter**
  installs, and **n** cancels.
- **b** goes back a step: from the review to the catalog, and from the catalog
  to the agents. Your agents, selection, and install location are kept.

Use `init --plain` for numbered prompts, including with screen readers. This
mode also activates for piped input, small terminals, and `TERM=dumb`. Enter
at the agent question sets up all agents; otherwise choose by number or name
(`1,2` or `claude,codex`). The catalog accepts numbers, ranges (`1,3-5`),
component IDs, groups (`blocks`, `skills`, `commands`, `integrations`), `all`,
or `none`, and lets you correct invalid answers. Type `i <number or ID>` to read
an item's guide, `u` to switch between this project and all projects, or `b` to
go back a step; after going back, Enter keeps the previous selection. Use
`--interactive` when piping answers and `NO_COLOR=1` to
disable color. Ctrl+C cancels setup. Esc returns from a guide or selection view,
clears a search, or quits the catalog when there is nothing to dismiss. Closing
input never approves an installation.

Finishing without a selection leaves project and user files unchanged, including
existing installations. `init --yes` always performs a read-only assessment.
Agent, scope, and force flags do not turn an empty selection or assessment
into an installation or repair.

To choose a component explicitly, preview it and then apply it:

```bash
agent-suitup list blocks
agent-suitup add block/completion-evidence --dry-run
agent-suitup add block/completion-evidence
```

## Catalog

Blocks express project working agreements that apply to every session. They
are written to `.agents/rules.md`, and `AGENTS.md` gets one line pointing to it:

```markdown
<!--as:rules-->
Project rules: read and follow @.agents/rules.md before starting any task.
<!--/as:rules-->
```

Claude Code expands the `@` import when a session starts. Codex and Grok Build
do not expand imports, so the line tells them to open the file. Use the
[selection guide](docs/choosing-blocks.md) for applicability, reasons to skip,
tradeoffs, and links to the exact instructions.

| Block | Purpose |
|---|---|
| `block/tdd` | Test-driven development |
| `block/ponytail` | Smallest safe implementation |
| `block/completion-evidence` | Report verification before claiming completion |
| `block/transparent-shortcuts` | Make material deferred work visible |
| `block/secure-defaults` | Protect new external boundaries by default |
| `block/no-unfinished-ui` | Omit unavailable product paths |
| `block/focused-changes` | Keep edits scoped, preserve unrelated work, and allow necessary supporting refactors |
| `block/autonomy` | Keep going without check-ins; ask only when blocked or before destructive actions |
| `block/task-list` | Track long multi-step work in a root `TASKS.md` that survives context resets |

### Install and use skills

A skill is a task workflow loaded on demand; a block is a standing rule in
`AGENTS.md`. You can choose skills in `init`, or inspect and install one directly:

```bash
agent-suitup inspect skill/audit-docs
agent-suitup add skill/audit-docs
```

Then ask your agent: **“Use audit-docs to check this repository's docs.”** Project skills live
in `.agents/skills/<name>/SKILL.md`, where Codex and Grok Build read them. Claude
Code only reads `.claude/skills`, so choosing it adds a link there to the same
folder. Add `--scope user` to install under `~/.agents/skills` for use across
projects.

| Skill | Use it for |
|---|---|
| `skill/audit-docs` | Stale instructions, inaccurate docs, and broken references |
| `skill/terraform-skill` | Version-aware Terraform and OpenTofu guidance |
| `skill/fastapi` | Version-aware FastAPI guidance |

FastAPI and Terraform skills are downloaded when preparing a selected
installation and include upstream references and licenses. The catalog pins each
one to a reviewed upstream revision, so `update` installs new upstream content
only after a catalog release deliberately moves that pin. Binary files keep their
exact bytes, and downloads time out after 30 seconds. Browsing and `inspect` do
not download them. Skill bodies load on demand; agents may keep their discovery
metadata in context.

Skill commands are skills that run only when you invoke them, for workflows
with side effects such as committing. They use the same `SKILL.md`
format; the difference is that the agent never starts them on its own. Install
with, for example, `agent-suitup add command/commit-work`, then run
`/commit-work` in Claude Code or Grok Build, or `$commit-work` in Codex.

The CLI reports individual and aggregate block costs. Words are counted by
splitting trimmed, normalized Markdown on whitespace; tokens are estimated as
normalized UTF-8 bytes divided by four, rounded up. Costs inform selection and
review; there is no minimum or maximum token count for a valid block.

## Agents

Every agent reads `AGENTS.md`; they differ in where they find skills and how
skill commands stay explicit:

| Agent | Rules | Skills | Skill commands |
|---|---|---|---|
| Claude Code | `@` import from `AGENTS.md` | `.claude/skills/<name>`, a link to `.agents/skills/<name>` | Slash-only wrapper in `.claude/skills` |
| Codex | Reads `.agents/rules.md` when `AGENTS.md` tells it to | `.agents/skills` | `$name`; `agents/openai.yaml` blocks implicit use |
| Grok Build | Reads `.agents/rules.md` when `AGENTS.md` tells it to | `.agents/skills` | Slash-only wrapper in `.grok/skills` |

Claude Code reads `AGENTS.md` only when the project has no `CLAUDE.md`. If one
exists and does not import `@AGENTS.md`, agent-suitup reports a manual step
instead of editing it. See the
[Grok Build compatibility notes](docs/grok-build-compatibility.md) for details.

Optional Claude Code plugins require Claude Code as an agent, which `add`
enables when needed:

| Plugin | Adds to Claude | Needs separately |
|---|---|---|
| `plugin/frontend-design` | Frontend design guidance | — |
| `plugin/github` | GitHub issues, pull requests, and actions | GitHub authentication |
| `plugin/typescript-lsp` | TypeScript language server | `typescript-language-server` on `PATH` |
| `plugin/pyright-lsp` | Python type checking | `pyright-langserver` on `PATH` |
| `plugin/codex` | Delegation and review through the Codex CLI | `codex` on `PATH` |

A plugin is enabled in the Claude settings file for its scope:
`.claude/settings.json` for a project or `~/.claude/settings.json` for your user.
The same file registers the plugin's marketplace under `extraKnownMarketplaces`
when it is missing. Removing the last plugin that uses a marketplace entry
agent-suitup added also removes that entry; entries you added are kept.

Required executables are checked before settings are changed. If an installed
plugin's executable later goes missing, `doctor` reports it and other commands
continue. Authentication and runtime setup remain separate from installation.

```bash
agent-suitup add command/commit-work --agent grok
agent-suitup add plugin/github
```

### Choose and remove agents

`--agent` (alias `--adapter`) accepts `claude`, `codex`, `grok`, a
comma-separated list such as `claude,codex`, or `none` for the shared files
only. Passing it skips the agent question. Without it, `add` sets up all three
agents in a new project and keeps the agents an existing project already has. With `list`, `init`, and
`add --interactive`, it limits the catalog to components that work with those
agents.

`init` and `add` only add agents: existing agents are always kept, whether you
pass `--agent` or choose at the setup prompt. `--agent none` adds nothing and
does not enable agents that components would otherwise require. To drop an
agent, use `remove --agent`. agent-suitup removes the files it created for that
agent; the shared content stays in place:

```bash
agent-suitup remove --agent grok --dry-run
agent-suitup remove --agent grok
```

Claude Code plugins require Claude Code. Remove them first, or in the same
command: `agent-suitup remove plugin/github --agent claude`.

## Manage an installation

| Command | Purpose |
|---|---|
| `list [blocks\|skills\|commands\|integrations]` | Browse the catalog |
| `inspect <component>` | Read purpose, examples, tradeoffs, and installation details |
| `add <component...>` | Install explicit selections; `add --interactive` opens the control panel |
| `plan` | Preview reconciliation of the existing installation |
| `update` | Apply updates and repair missing content |
| `remove <component...>` | Remove selected managed components |
| `remove --agent <agent>` | Drop an agent and the files it added |
| `doctor` | Check drift and known prerequisites without writing |

Prefix commands with `agent-suitup`. Skills and skill commands support
`--scope project` or `--scope user`; blocks are project-only. Use `--help` for
all flags. Normal output is compact; `plan` and `--dry-run` show exact changes.

Desired components are recorded in `.agent-suitup/manifest.json`, with
versions, pins, and integrity records in `.agent-suitup/lock.json`. Keep
these files in version control alongside the installed content.

Text outside managed blocks is preserved, and so are existing file permissions.
Blocks installed by earlier releases directly in `AGENTS.md` move to
`.agents/rules.md` on the next `update`.
Removal deletes only files agent-suitup created; identical files that existed
before installation are kept and reported. Skill directories left empty by a
removal are deleted; directories that still hold other files are kept. Local edits and unexpected file or
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

`npm run check` syntax-checks every module in `bin/` and `src/`, then runs the
tests. CI runs it on Node.js 20, 22, and current across Linux, macOS, and
Windows.

Licensed under [Apache-2.0](LICENSE). Adapted content retains its upstream
licenses and attribution in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
