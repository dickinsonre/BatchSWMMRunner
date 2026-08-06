---
name: GitHub workflow scope
description: Pushes adding .github/workflows files are rejected by this repl's GitHub token
---
The Replit GitHub connection for this project can push normal commits but rejects any push that adds/modifies `.github/workflows/*` (missing `workflow` OAuth scope → generic PUSH_REJECTED).
**Why:** Verified Aug 2026 — a probe branch without the workflow file pushed fine; the same history plus ci.yml was rejected.
**How to apply:** If a push fails with PUSH_REJECTED and the diff touches workflow files, the fix is user-side (reconnect GitHub with workflow scope) or add the file directly on GitHub — don't keep retrying gitPush.
