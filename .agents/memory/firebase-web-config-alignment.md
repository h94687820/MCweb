---
name: Firebase web config alignment
description: Diagnose mismatched Firebase client settings without assuming which value changed or exposing credentials.
---

**Rule:** Treat the Firebase Web App values as one config set. A mismatch between the API key's project and the configured project ID, auth domain, or storage bucket proves inconsistency, but does not identify which value is wrong. Preserve a user's confirmation about a previously working key until the intended Firebase Web App config is verified. Never ask for a screenshot of all project secrets.

**Why:** The user says the current key previously worked and the current keys are temporary because the project is being sold, then confirmed sign-in worked after using the new Firebase values. The unauthenticated Identity Toolkit project endpoint returned only project ID and authorized domains; missing provider fields do not mean providers are disabled.

**How to apply:** Compare fields without printing credential values. Ask for only a redacted Firebase Web App config or the specific corrected value through Replit Secrets; never request Cloudflare or BaaS credentials in chat. Rebuild and redeploy after Firebase settings change, and use Firebase Console or authenticated admin access to inspect provider settings.
