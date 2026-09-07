---
name: audit-docs
description: Audit repository documentation for accuracy, staleness, duplication, broken references, and unnecessary context cost. Use for documentation health checks; do not edit files unless explicitly asked.
---

# Documentation audit

Read the repository instructions, inventory tracked documentation, and compare
claims with the current code and configuration. Exclude dependency, generated,
cache, and vendored directories unless the repository treats them as source.

## Checks

Evaluate each relevant file as OK, WARN, or ACTION.

1. Accuracy and staleness
   - Commands, paths, environment variables, endpoints, and examples match source.
   - Temporary rollout or issue notes are archived or removed when obsolete.
2. Duplication and scope
   - A fact has one clear owner; other files link to it.
   - Stable documents avoid issue-specific implementation detail.
3. References
   - Internal links, file references, includes, and indexes resolve.
   - `AGENTS.md` and compatibility bridges point to existing canonical content.
4. Context cost
   - Always-loaded instructions contain only stable, broadly useful rules.
   - Task-specific procedures live in on-demand skills or nearby documentation.
   - Flag unusually long files only when splitting or trimming improves use.
5. Hygiene
   - Empty files/directories, obsolete archives, and undocumented generated files
     are identified.

## Report

Return totals for files and statuses, followed by actions, warnings, and healthy
files. For each ACTION or WARN, cite the file, show the conflicting evidence,
and recommend a specific fix. Never claim a link or command was checked unless
it was actually checked.
