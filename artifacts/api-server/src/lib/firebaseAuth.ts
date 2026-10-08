import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { logger } from "./logger";

const firebaseSigningKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

function getFirebaseProjectId(): string {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID is required for Firebase authentication");
  }
  return projectId;
}

export async function getFirebaseUserId(req: Request): Promise<string | null> {
  const authorization = req.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  if (!token) return null;

  const projectId = getFirebaseProjectId();
  try {
    const { payload } = await jwtVerify(token, firebaseSigningKeys, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
    });
    return typeof payload.sub === "string" && payload.sub.length > 0
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

export function requireFirebaseAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  void getFirebaseUserId(req)
    .then((userId) => {
      if (!userId) {
        res.status(401).json({ error: "Unauthorized — please sign in" });
        return;
      }
      (req as Request & { userId?: string }).userId = userId;
      next();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error({ message }, "Firebase authentication could not be checked");
      res.status(503).json({ error: "Authentication service unavailable" });
    });
}
