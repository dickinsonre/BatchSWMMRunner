---
name: GitHub workflow & Actions quirks
description: Pushing .github/workflows and triggering Actions runs from Replit
---

- Pushes that add **or modify** `.github/workflows/*` via the app's GitHub connection are rejected (`PUSH_REJECTED` — token lacks the `workflow` scope). The user must push those commits themselves via the Git pane sync.
- Pushes that succeed via the app token do **not trigger** GitHub Actions `push` workflow runs — the commit lands, but no CI run starts. Runs only trigger for pushes made with the user's own credentials (their Git pane sync) or via `workflow_dispatch`.
- **How to apply:** for CI verification, commit locally, have the user sync from the Git pane, then poll `https://api.github.com/repos/<owner>/<repo>/actions/runs` (public repo, no auth). Job logs need admin auth — ask the user for the log tail instead.
