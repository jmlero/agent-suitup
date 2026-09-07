---
name: verify-frontend
description: Verify changed frontend behavior across representative viewports, interaction states, and accessibility paths. Use after modifying UI structure, layout, navigation, visibility, or responsive styles.
---

# Verify Frontend

Verify the affected behavior rather than surveying the entire application.

1. Identify the changed views, controls, routes, and breakpoint-dependent states.
2. Start the repository's normal development or preview environment. Preserve any
   startup or browser errors.
3. Inspect each affected view at one representative narrow viewport and one wide
   viewport. Add an intermediate width when a changed breakpoint requires it.
4. Check alignment, overflow, visibility, content order, focus order, keyboard
   access, and loading, empty, error, disabled, and completed states that the
   change can reach.
5. Exercise the changed interaction path instead of relying only on a screenshot.
6. Run the smallest relevant automated check. Add a focused regression check when
   the behavior is important and the repository has a practical test surface.

Report the viewports and paths inspected, checks run, failures found, and anything
that could not be verified. Do not claim visual verification without rendering the
affected interface.
