---
name: BaaS migration
description: Full migration from Neon/Supabase/PostgreSQL to baas-platform.mcfoxy.workers.dev — patterns, pitfalls, and confirmed behavior
---

## Rule
BaaS is the sole data + storage backend. Never reintroduce PostgreSQL, Drizzle, @neondatabase/serverless, or @supabase/storage-js.

**Why:** User explicitly requested BaaS as the single source of truth for all data and file storage.

## How to apply
- All data → BaaS `/api/v1/data/:collection` (records API)
- All files → BaaS `/api/v1/storage/upload` + PUT signed URL
- Images are stored as full absolute download URLs (`https://baas-platform.mcfoxy.workers.dev/api/storage/objects/...`)
- Download URLs are publicly accessible — no API key needed for `<img src>` display
- Filter/search/aggregation is done client-side (fetch all records, filter in JS)

## BaaS Node.js client
`artifacts/api-server/src/lib/baas.ts` — reads from `process.env.BAAS_BASE_URL` and `process.env.BAAS_API_KEY`

## BaaS Workers client
`artifacts/cloudflare-app/src/lib/baas.ts` — reads from `c.env.BAAS_BASE_URL` and `c.env.BAAS_API_KEY`

## Dashboard URL versus API origin
BaaS API endpoints are mounted at the service origin. A dashboard URL such as
`https://baas-platform.mcfoxy.workers.dev/projects/1` serves the dashboard HTML
when `/api/v1/...` is appended, rather than reaching the API. Both clients now
normalize the configured base to its origin.

**Why:** This produced empty/unexpected JSON and 500 responses for lists even
though the API key was present; the root API endpoint correctly requested the key.

**How to apply:** When a BaaS list unexpectedly returns HTML or an empty body,
check whether `BAAS_BASE_URL` includes a dashboard route before changing response
parsing.

## Collections used
- `files` — uploaded mods/maps metadata + storage URLs; unique field: `customId`
- `profiles` — user profiles; unique field: `username`
- `settings` — single-row app settings (auto-created on first GET)

## Upload flow (api-server)
1. multer receives file to temp disk (`tmp/`)
2. Read buffer from disk → PUT to BaaS signed upload URL
3. Delete temp file
4. Create BaaS record storing download URL as `filePath`

## Frontend image URLs
Images from BaaS are full absolute URLs. Helper `resolveImageUrl(urlOrFilename, base)` in home.tsx and file-detail.tsx handles both new (full URL) and legacy (bare filename) formats.

## putStorageBytes URL construction
`uploadURL` returned by BaaS is a relative path (e.g. `/api/storage/objects/...?uploadToken=...`). Must prepend `BAAS_BASE_URL` to get full URL.

## Storage URL trust boundary
Treat storage URLs from records as untrusted: accept only HTTPS URLs on the configured BaaS origin under `/api/storage/objects/`, and reject redirects when fetching them.

**Why:** A changed or malformed record URL could otherwise make a backend fetch an unrelated service or forward request headers to a different host.

**How to apply:** Enforce the origin and storage-route prefix in both Node and Worker clients before upload/download fetches; keep API URLs separate from object URLs.

## Unique fields
Call `setUniqueFields(collection, ["fieldName"])` once per process startup (guarded by a boolean). Violations return HTTP 409 — use `isDuplicateFieldError(err)` to detect.

## Known BaaS limitations
- No server-side filtering or full-text search — must fetch all and filter in code
- No SQL aggregation — compute stats (totalMods, cleanFiles, etc.) by iterating all records
- Pagination capped at 200/page — `listRecords()` auto-paginates to get everything
