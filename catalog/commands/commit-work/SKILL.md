---
name: commit-work
description: Create a focused, validated Git commit without capturing unrelated work. Use only when the user explicitly asks to commit the current changes or invokes this command.
---

# Commit Work

1. Read the repository instructions. Inspect the working tree, staged changes,
   and relevant diff before staging anything.
2. Separate the requested work from unrelated user changes. Never discard,
   overwrite, or silently include unrelated files. Ask for direction when the
   intended boundary cannot be determined safely.
3. Run the relevant validation or cite fresh results from the current work.
   Stop if required checks fail unless the user explicitly accepts the risk.
4. Stage exact paths, then review the staged diff for secrets, generated files,
   debug artifacts, and accidental changes.
5. Create one focused commit with a concise message that matches repository
   conventions.
6. Report the commit hash, message, validation evidence, and any remaining
   uncommitted changes.

Do not amend, push, open a pull request, or change branches unless the user asks.
