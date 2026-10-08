import { getFirebaseAuth } from "@/auth/firebase";

export async function fetchWithAppAuth(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = await getFirebaseAuth().currentUser?.getIdToken();
  if (!token) {
    throw new Error("Your sign-in session is unavailable. Please sign in again.");
  }
  headers.set("Authorization", `Bearer ${token}`);

  return fetch(input, { ...init, headers });
}
