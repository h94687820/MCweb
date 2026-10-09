---
name: Firebase web config alignment
description: Diagnose mismatched Firebase client settings without assuming which value changed or exposing credentials.
---

**Rule:** Treat the Firebase Web App values as one config set. A mismatch between the API key's project and the configured project ID, auth domain, or storage bucket proves inconsistency, but does not identify which value is wrong. Preserve a user's confirmation about a previously working key until the intended Firebase Web App config is verified. Never ask for a screenshot of all project secrets.

**Why:** The user says the current key previously worked and the current keys are temporary because the project is being sold. Unauthenticated Firebase diagnostics can reveal a mismatch but cannot establish which set is intended.

**How to apply:** Compare fields without printing credential values. Ask for only a redacted Firebase Web App config screenshot or the specific corrected value through Replit Secrets; never request Cloudflare or BaaS credentials in chat.
