---
name: Secrets can go empty in shells until re-saved
description: A project secret can show up empty in ShellExec/process.env even when the secret manager lists it as existing
---

**Rule:** A saved secret may still resolve to an empty string in `ShellExec`. Check its presence and
length without printing its value; if it is empty, re-save it through the secure secrets flow before
concluding a feature is blocked. Secrets are not exposed inside CodeExecution's `"use impure"`
`process.env`.

**How to apply:** before concluding any secret-gated feature (deploy tokens, external DB URLs, storage
keys, etc.) is broken or unreachable, check with `printenv` / `${#VAR}` in `ShellExec` first. If a listed
secret comes back empty, don't assume a platform restriction — call `requestSecrets` for that key and
recheck.

**Why:** the original value was apparently never a valid, properly-saved secret (e.g. stale/
placeholder), not because Replit blocks this class of secret from shells. Don't assume a secret
is platform-blocked just because one shell check shows it empty — a fresh `requestSecrets` round
can fix it outright.

**How to apply:** if a Cloudflare (or similar external-provider) deploy command falls back to
interactive OAuth, first check whether the token secret is actually populated/valid before
concluding it's an architectural restriction — re-request it via `requestSecrets` and recheck
`env` before telling the user it can only be done from their own machine.
