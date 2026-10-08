---
name: Replit Git history
description: Replit workspaces may retain agent commit history in managed Git refs apart from normal local branches and remote-tracking refs.
---

Do not rewrite Replit-managed refs or force-push remotes as part of ordinary local Git cleanup. A history rewrite limited to local branches does not erase those separate histories.

**Why:** Replit keeps an internal agent ledger, and remote repositories may still contain previous commits; changing either can disrupt platform tracking or shared copies.

**How to apply:** If a user requests Git-history removal, explain the local-versus-remote/internal distinction, rewrite only the approved scope, and preserve managed refs unless the user and platform guidance explicitly authorize changing them.
