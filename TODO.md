# Backlog

Open work from a repository review, ordered by priority. Items marked
**Decision** change product scope or behavior; discuss them before
implementation (see `AGENTS.md`). Every fix adds regression coverage and passes
`npm run check`.

## P1: Lifecycle correctness

- [x] **Ignore mode-only differences on shared documents.**
  `src/planner.mjs` compared full file modes and defaulted to `0644`, and
  `src/reconcile.mjs` wrote `AGENTS.md` without a mode. A `0664` checkout
  (common under `umask 002`) made `doctor` fail with an empty `UPDATE` diff,
  and `update` changed permissions on user-owned files.
  Done when: `allowExisting` writes preserve the existing mode, skill files
  compare only the executable bit, and a test covers `0664` files.
- [x] **Stop missing prerequisites from blocking unrelated commands.**
  `validateSelection` (`src/reconcile.mjs`) checked required executables
  on every reconcile. An installed plugin whose executable was absent made
  `doctor`, `plan`, `update`, and unrelated `add` fail for everyone.
  Done when: prerequisites are enforced only for newly added components, and
  `doctor` reports a missing executable as a health finding.
- [x] **Delete only files agent-suitup created.**
  `removeFiles` (`src/reconcile.mjs`) ignored the `created` flag, so removal
  deleted adopted files that were identical before installation.
  Done when: adopted files are left in place with a note. A file created by one
  project and adopted by another is still deleted when the creating project
  removes it; see "ownership of user-scope files" under Decisions.
- [x] **Write state files after content changes.**
  `Planner.apply` sorts operations by label, so `.agent-suitup/lock.json` is
  written before content. A later failure leaves the lockfile describing files
  that were never written, and failed deletions become untracked.
  Done when: manifest and lock writes run last.

## P1: Adapter behavior

- [x] **Keep commands explicit-only under Claude.**
  `src/reconcile.mjs:164-197` symlinks the canonical command folder into
  `.claude/skills`, and command skills lack `disable-model-invocation: true`.
  Grok (`src/adapters/grok.mjs`) and Codex (`agents/openai.yaml`) already block
  implicit use.
  Done when: Claude receives a thin command wrapper like Grok's, or the
  canonical frontmatter declares the key. `README.md` and
  `src/component-guide.mjs:33` describe the behavior accurately.
- [x] **Scope Claude marketplace registration.**
  `src/adapters/claude.mjs:14-18` always writes `extraKnownMarketplaces` to
  `~/.claude/settings.json`, even for project-scope plugins, and never removes
  it. The component guide mentions only the project settings file.
  Done when: project-scope plugins register the marketplace in project
  settings, and the guide lists every settings file that changes.
  Also: the lockfile records `marketplaceCreated`, and removing the last plugin
  that uses an entry agent-suitup added removes it; user entries are kept.

## P2: Catalog metadata and attribution

- [x] Add `upstream`, `revision`, and `license` to `command/verify-work` in
  `catalog/catalog.json` to match `THIRD_PARTY_NOTICES.md`.
- [x] Align `schemas/catalog.schema.json` with `validateCatalogComponent`
  (`src/catalog.mjs`): adapter rules, `estimatedTokens` rules, license with
  `upstream`, `recommendedScope`, remote `root`, and `conflictsWith`. Reject
  unknown catalog keys. Align `schemas/manifest.schema.json` with the manifest
  versions that `src/state.mjs` accepts. Add a test that catches drift.
  Done in `test/schema.test.mjs` with a small dependency-free schema evaluator.
- [x] Declare `license` consistently on first-party catalog entries. Content
  without a license is now rejected.
- [x] Consider a one-line attribution in the installed `block/ponytail` text
  (MIT upstream). Added; version `1.0.1`.

## P2: Terminal UI

- [x] Restore the terminal on SIGTERM and SIGHUP (`src/prompts.mjs:111-143`).
  In `cleanup`, write the restore sequence before calling `setRawMode`.
- [x] Pause stdin after the picker unless it was already flowing
  (`src/prompts.mjs:100`). Otherwise typed-ahead input is lost. Test with a
  fresh stream instead of a pre-paused one.
- [x] Fix the tab-row width check (`src/dashboard.mjs:127`): later tabs need
  `+ 4` columns. The row currently truncates at 55 and 75 columns.
- [x] Print a newline after queued piped answers (`src/prompts.mjs:37`).
- [x] Treat only a non-empty `NO_COLOR` as disabling color (`src/ui.mjs:273`).
- [x] Make Tab and Shift+Tab from the selection view land on adjacent
  categories (`src/dashboard.mjs:74-75`).
- [x] P3: Measure display width for wide characters and use grapheme-aware
  backspace. Enable bracketed paste and route pasted text to search. Block
  Enter when the terminal is too small to show the picker.

## P2: Validation and release

- [x] Add CI running `npm run check` on Node 20, 22, and current, across
  Linux, macOS, and Windows. `.github/workflows/ci.yml`; tests also set
  `USERPROFILE`, which `os.homedir()` reads on Windows. Windows jobs have not run
  yet.
- [x] Extend `npm run check` to syntax-check `src/` as well as the entry point.

## P3: Documentation and polish

- [x] README: document `--adapter none`, the `--adapters` alias, every plugin
  ID, and how to remove an adapter.
- [x] Use `agent-suitup` consistently instead of "Agent Suitup" in `bin/`,
  `src/ui.mjs`, `docs/`, and tests. Stop using the action label
  `"Agent Suitup ready"` as a control flag (`src/ui.mjs:173`).
- [x] Read the CLI version from `package.json` instead of hardcoding it in
  `bin/agent-suitup.mjs:41`.
- [x] Fix "1 component match" in `formatHealthy` (`src/ui.mjs:206`).
- [x] Help text: ←/→ switch categories rather than browse, list Shift+Tab, and
  name Claude on the commands line (`bin/agent-suitup.mjs:523-533`).
- [x] Replace "current Codex session" in
  `docs/evaluations/records/2026-08-15-completion-evidence.md` with the model
  and configuration used.
- [x] Add a timeout to remote fetches (`src/catalog.mjs`).
- [x] Avoid text normalization of non-text files in remote packages.
- [x] Consider removing empty skill directories after a component is removed.

## P3: Block content

- [x] `block/tdd`: repeat the cycle until requirements are met, and limit
  refactoring to touched code so it agrees with `block/focused-changes`.
- [x] Reconcile verification wording across `tdd`, `ponytail`,
  `completion-evidence`, and `ci-production-parity`.
- [x] Give `transparent-shortcuts` and `secure-defaults` a fallback for where
  to record deferred work or risk (for example, the handoff).

## Open verification

- [ ] **Confirm Grok Build follows the rules link.** Blocks moved to
  `.agents/rules.md` behind one managed line in `AGENTS.md`. Claude Code imports
  it and Codex followed it in smoke checks; Grok Build needs a trusted-folder
  session to confirm. Done when: a trusted Grok session applies a block without
  being asked to read the file, recorded in `docs/grok-build-compatibility.md`.

## Decisions

- [x] **Decision: remove pre-rename migration code.** The rename changed state
  and marker names, so these paths cannot match an earlier installation:
  - legacy markers (`src/managed.mjs:62-64`)
  - manifest v1 `targets` (`src/state.mjs:48-50,81-91`)
  - `--target` and `--targets` (`bin/agent-suitup.mjs:448-458,487-493`)
  - `retiredComponentIds` (`src/catalog.mjs:17-27`)
  - hook removal (`src/reconcile.mjs:256`, `src/adapters/claude.mjs:38`)
  - their tests and the matching `VISION.md` text

  Recommendation: remove for 0.1.0. Removed.
- [ ] **Decision: ownership of user-scope files.** Deferred (2026-09-26).
  Per-project lockfiles track files shared across projects under `~/.agents`
  and `~/.claude`. Removing a user-scope skill in one project deletes it for
  every other project. Recommendation: a user-level lockfile, or reference
  tracking.
- [x] **Decision: `--adapter` semantics on `add`.** Explicit `add` replaces the
  adapter set (`bin/agent-suitup.mjs:179`). `add block/tdd --adapter claude`
  deletes existing Grok wrappers, while interactive setup only adds adapters.
  Recommendation: make it additive and provide an explicit removal command.
  Done: `init` and `add` only add adapters; `remove --adapter` drops them.
- [x] **Decision: pin remote skills in the catalog.** `skill/terraform-skill`
  and `skill/fastapi` follow upstream `master`, so `update` installs unreviewed
  upstream content. Recommendation: pin reviewed revisions and bump them
  deliberately. Pinned to upstream HEAD on 2026-09-26; `mutable` is removed and
  unpinned remote URLs are rejected. See `docs/catalog-maintenance.md`.
- [x] **Decision: Claude plugin marketplace.** Dropped. It published 3 of 8
  skills under the owner name and duplicated the `.claude/skills` bridge.
  Removed `.claude-plugin/`, the `adapters/claude/plugins` wrappers, their
  `package.json` entries, and the marketplace test. Open: the two directories
  are still tracked; delete them with `git rm -r .claude-plugin adapters`.
- [x] **Decision: `AGENTS.md` is the only instruction target.** Claude Code
  reads it directly. Removed the `CLAUDE.md` symlink and `@AGENTS.md` import
  bridge, the lockfile `bridges` field, and their tests. A `CLAUDE.md` left by
  an earlier install is no longer tracked or deleted.
