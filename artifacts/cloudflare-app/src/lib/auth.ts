import type { Context, Next } from "hono";
import type { Bindings, Variables } from "../env.d";
import { getFirebaseUserId } from "./firebaseAuth";

export async function getAuthUserId(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
): Promise<string | null> {
  return getFirebaseUserId(c);
}

export async function requireAuth(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next,
) {
  const userId = await getAuthUserId(c);
  if (!userId) {
    return c.json({ error: "Unauthorized — please sign in" }, 401);
  }
  c.set("userId", userId);
  await next();
}
