---
name: GitHub connection state mismatch
description: Replit's GitHub connection status may not match Git CLI credential availability in this workspace.
---

When the GitHub integration appears authorized but its connection is `not_added`, `addIntegration` may return success and claim Git CLI authentication is active while `git ls-remote` still fails with an authentication error. The integration list can continue to show `not_added`. Reauthorization may also be rejected if the environment does not expose a matching connector.

**Why:** The integration binding state and the Git credential helper did not agree, so assuming that a successful bind means repository access is available can lead to an unsafe or misleading push attempt.

**How to apply:** Before pushing, verify read access to the exact target repository with a read-only Git command. If authentication fails, do not retry writes or request a token in chat; guide the user to disconnect and reconnect GitHub from Replit's connected-services settings, then test read access again.
