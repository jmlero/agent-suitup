# AGENTS.md

Applies to the entire public repository.

## Project

Keep `agent-suitup` a dependency-free Node.js 20+ ESM CLI. `catalog/` owns
canonical portable content; `src/` implements the lifecycle; `adapters/` packages
agent-specific assets.

## Rules

- Keep changes focused and preserve existing user work.
- Define portable instructions once; keep adapters thin and capability-specific.
- Declare stable catalog IDs, versions, scopes, sources, and loading modes.
  Derive context costs from canonical content.
- Keep normal CLI output compact and sectioned; reserve exact file bodies for
  `plan` and `--dry-run`.
- Never overwrite unowned content or hide unsupported behavior.
- Preserve Apache-2.0 metadata and upstream attribution.
- Keep tracked documentation and examples reusable: use repository-relative
  paths and omit personal configuration, private account details, and session
  history.

## Workflow

Use `VISION.md` for product direction and the requested task for scope. Discuss
material changes to product scope or priorities before implementation.
Keep `README.md` focused on public usage and contribution steps; update it when
commands or user-visible behavior change. Put detailed design and catalog
review material in `docs/`.

## Validation

Run `npm test` for focused work and `npm run check` before handoff. Add regression
coverage for lifecycle, adapter, conflict, or detection changes.
