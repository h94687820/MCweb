# Firebase Authentication

Firebase Authentication is the only sign-in provider in both the Replit preview and the published Cloudflare app. The website uses Firebase Authentication for email/password and Google sign-in, password resets, and sign-out.

## Firebase setup

The Firebase Web App configuration is stored in Replit Secrets:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

Enable **Email/Password** and **Google** under Firebase Authentication → Sign-in method. Firebase does not require a custom domain for production authentication. For Google sign-in, add each actual app host (the Replit preview hostname and the deployed `workers.dev` hostname) to Firebase Authentication → Settings → Authorized domains.

## Identity checks and protected operations

The browser sends Firebase ID tokens as bearer tokens. The Express API and Cloudflare Worker independently verify the token signature and its Firebase project issuer/audience before accepting protected requests. Uploads, profile changes/avatar uploads, file edits/deletes, and settings updates use this same identity path. Unauthenticated settings reads remain public; a supplied but invalid token is rejected.

New ownership records use Firebase UIDs. Existing BaaS records and uploaded files are not deleted or reassigned during this authentication change.

## Deployment

Cloudflare deployment builds and serves the Firebase-authenticated app:

```bash
pnpm --filter @workspace/cloudflare-app run deploy
```

The command requires the Cloudflare deployment credentials and the Firebase Web App configuration above. It builds the Firebase UI and sets the Worker’s Firebase project ID. API and Worker endpoints validate Firebase ID tokens for uploads, profile changes, and settings updates.
