---
name: Cloudflare Worker is a separate production backend
description: artifacts/cloudflare-app is a hand-rolled Hono/Workers reimplementation of artifacts/api-server, deployed independently via wrangler — fixes to api-server do not reach production until ported here and redeployed.
---

## The architecture
- `artifacts/cloudflare-app` (Hono, Workers runtime) is the **actual production backend** for this project's Cloudflare deployment — reached via `workers.dev` subdomain, deployed with `pnpm --filter @workspace/cloudflare-app run deploy` (wrangler), NOT through Replit's own Deployments/publish flow.
- `artifacts/api-server` (Express) only serves the Replit dev preview. It shares the same `@workspace/db` schema but its **route handlers are hand-duplicated, not imported** — `cloudflare-app/src/routes/*.ts` reimplements files/profiles/settings routes from scratch for the Workers runtime (no Node APIs).
- **Any backend fix (new fields, new endpoints, validation changes) made in `api-server` must be manually ported into the matching `cloudflare-app/src/routes/*.ts` file**, or production silently stays on old behavior even though the Replit preview looks fixed.

**Why:** there is no shared route-handler code between the two backends — only the DB schema and zod contracts are shared. This was invisible until inspecting `artifacts/cloudflare-app` directly; it wasn't in the originally-registered artifacts list shown at session start.

## Firebase auth parity
- Both `cloudflare-app` and `api-server` validate Firebase ID tokens independently. Changes to protected operations must be applied to both backends because their route handlers are separate implementations.
- The Cloudflare deploy script supplies `FIREBASE_PROJECT_ID` from the Firebase web configuration during deployment; the Worker uses it to verify token issuer and audience.

## CLOUDFLARE_API_TOKEN accessibility (supersedes older note)
- As of 2026-07-12, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` **are** readable from the agent shell and `wrangler deploy`/`wrangler whoami`/Cloudflare API calls work directly — re-check token access before assuming deploys can't be automated; this constraint may have been temporary or account-specific.
