---
name: verify-work
description: Verify current repository changes with the project's real checks and report concrete evidence. Use only when the user explicitly asks to verify, validate, run checks, or prove that work is ready.
---

# Verify Work

1. Read the repository instructions and inspect the current status and diff.
2. Discover validation commands from committed configuration and documentation.
   Never invent a command or assume a package manager that is not present.
3. Run the narrowest relevant checks first, then the full relevant test, lint,
   type-check, and build commands available for the changed area.
4. Preserve complete failure diagnostics. Do not change product code during a
   verification-only request unless the user explicitly asks for fixes.
5. Report every command run and its result, checks that could not run, and any
   remaining risk. Never claim a check passed unless it actually ran.

## CI failures

When CI is failing, inspect the available failure log first and reproduce the
narrowest relevant check locally. Preserve complete diagnostics and do not rerun
blindly. Request missing external evidence only when the repository and local
checks cannot explain the failure.
