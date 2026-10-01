---
name: commit-work
description: Commit the changes made in this session and push them straight to main, without branches or pull requests. Use only when the user explicitly asks to commit and push or invokes this command.
---

# Commit Work

1. Stage only the files you changed in this session, by exact path. Leave
   everything else as it is.
2. Make sure the relevant checks passed after your last edit; stop if they fail.
3. Commit on main with a short message that follows the repository's
   conventions. Never bypass hooks.
4. Push to main. If the push is rejected, rebase onto the remote and push again;
   stop on conflicts. Never force-push.
5. Report the commit hash and any changes left uncommitted.
