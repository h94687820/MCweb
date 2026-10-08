import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Context } from "hono";
import type { Bindings, Variables } from "../env.d";

const FIREBASE_SIGNING_KEYS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export async function getFirebaseUserId(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
): Promise<string | null> {
  const projectId = c.env.FIREBASE_PROJECT_ID;
  const authorization = c.req.header("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is required for Firebase authentication");
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, FIREBASE_SIGNING_KEYS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
    });
    return typeof payload.sub === "string" && payload.sub.length > 0
      ? payload.sub
      : null;
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.warn("[firebase] ID token verification failed:", errorName);
    return null;
  }
}
