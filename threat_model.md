# Threat Model

## Project Overview

WhiteWase is a public Minecraft mods and maps hub. The React/Vite client uses Firebase Authentication; the Replit preview/dev API is Express, while the Cloudflare deployment serves the app and a Hono API Worker. Records and uploaded objects are stored by the BaaS service.

## Assets

- **Firebase identity tokens and user accounts** — tokens authorize profile, settings, upload, edit, rescan, and delete operations.
- **Profile and settings records** — profiles are public by username; settings can be user-specific.
- **Uploaded mods, maps, and images** — public listing and download are part of the product; upload and ownership-sensitive changes require authentication.
- **BaaS API credentials and external scanner credentials** — backend-only credentials must never enter browser bundles or responses.

## Trust Boundaries

- **Browser to API** — browser input is untrusted; API mutations require Firebase ID-token verification and enforce ownership on files.
- **API to Firebase identity** — Express and Worker validate token signature, issuer, audience, and expiry against Firebase signing keys.
- **API to BaaS** — backend credentials are used for record and storage operations; stored object URLs are restricted to the configured HTTPS BaaS origin and storage path.
- **API to external scanners** — uploaded content and scanner responses cross an external-service boundary.
- **Public to authenticated data** — file listings, downloads, username checks, and public profiles are public; personal profile and settings endpoints are authenticated.

## Scan Anchors

- Production entry: `artifacts/cloudflare-app/src/index.ts`; Replit API entry: `artifacts/api-server/src/app.ts`.
- Highest-risk code: `artifacts/cloudflare-app/src/routes/`, `artifacts/api-server/src/routes/`, and both BaaS clients under `src/lib/baas.ts`.
- Authentication: `artifacts/minecraft-hub/src/auth/`, `artifacts/api-server/src/lib/firebaseAuth.ts`, and `artifacts/cloudflare-app/src/lib/firebaseAuth.ts`.
- Dev-only preview tooling: `artifacts/mockup-sandbox/`; it is not a production API.

## Threat Categories

### Spoofing

Forged or cross-project Firebase tokens could grant access to account operations. Both APIs verify Firebase JWT signatures and constrain issuer and audience to the configured project; all write routes require authentication. Firebase Authentication provider setup and client configuration must refer to the same Firebase project. The browser must attach ID tokens to generated API calls and direct upload/avatar requests.

### Tampering

Attackers can change request bodies, query parameters, multipart metadata, and stored URLs. API validation must remain server-side, file content signatures must agree with allowed extensions, and ownership must be checked on every file mutation. Storage requests must only use validated HTTPS URLs on the configured BaaS origin.

### Information Disclosure

Public access to mod/map metadata, downloads, and public profiles is intentional. Private profile and per-user settings responses must not be served from shared caches. The PWA must cache only unauthenticated public API reads; authenticated requests, user settings/profile endpoints, and file downloads are excluded from its runtime cache.

### Denial of Service

Uploads have per-file and total size limits, but public list, statistics, and profile lookup endpoints can trigger full-collection BaaS reads. These endpoints need protection against request floods and excessive upstream work; any production rate limiter must be shared/distributed rather than relying only on per-process memory.

### Elevation of Privilege

Authenticated users must only update, rescan, or delete files they own. Profile and settings writes must be scoped to the Firebase user ID, and no client-supplied user ID may replace the verified identity.
