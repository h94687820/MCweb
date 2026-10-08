/**
 * BaaS client for Node.js (api-server)
 * Mirrors artifacts/cloudflare-app/src/lib/baas.ts but reads credentials
 * from process.env instead of Cloudflare Worker Bindings.
 *
 * API contract:
 * - Records:  GET/POST /api/v1/data/:collection, GET/PATCH/DELETE /api/v1/data/:collection/:id
 * - Storage:  POST /api/v1/storage/upload → { uploadURL, downloadUrl, fileId }
 *             PUT <uploadURL> (signed path, relative to base URL)
 *             DELETE /api/v1/storage/:fileId
 * - Schema:   PUT /api/v1/collections/:collection/schema { uniqueFields }
 */

export function baseUrl(): string {
  const url = process.env.BAAS_BASE_URL;
  if (!url) throw new Error("BAAS_BASE_URL is not set");
  try {
    // The configured value may be copied from the BaaS dashboard
    // (for example, /projects/1). API and storage endpoints live at the
    // service origin, not beneath the dashboard route.
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error();
    }
    return parsed.origin;
  } catch {
    throw new Error("BAAS_BASE_URL must be a credential-free HTTPS URL");
  }
}

function apiKey(): string {
  const key = process.env.BAAS_API_KEY;
  if (!key) throw new Error("BAAS_API_KEY is not set");
  return key;
}

export type BaasRecord<T> = {
  id: number;
  collection: string;
  data: T;
  createdAt: string;
  updatedAt: string;
};

export class BaasError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function baasFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    redirect: "error",
    headers: {
      "X-API-Key": apiKey(),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}

/** Performs a lightweight, read-only check that the data API is reachable. */
export async function checkBaasHealth(): Promise<void> {
  const resp = await baasFetch("/api/v1/data/files?limit=1&offset=0");
  if (!resp.ok) await parseJsonOrThrow(resp);
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    await resp.body?.cancel();
    throw new BaasError("BaaS returned an unexpected health-check response", 502);
  }
  await resp.body?.cancel();
}

async function parseJsonOrThrow(resp: Response): Promise<any> {
  const text = await resp.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!resp.ok) {
    const message = typeof body === "object" && body?.error ? body.error : String(body);
    throw new BaasError(message, resp.status);
  }
  return body;
}

// ── Generic data records ────────────────────────────────────────────────────

const PAGE_SIZE = 200;

/** Fetches every record in a collection (paginating past the default limit). */
export async function listRecords<T>(collection: string): Promise<BaasRecord<T>[]> {
  const all: BaasRecord<T>[] = [];
  let offset = 0;
  while (true) {
    const resp = await baasFetch(`/api/v1/data/${collection}?limit=${PAGE_SIZE}&offset=${offset}`);
    const body = await parseJsonOrThrow(resp);
    const page: unknown =
      Array.isArray(body?.data) ? body.data :
      Array.isArray(body?.data?.records) ? body.data.records :
      Array.isArray(body?.data?.items) ? body.data.items :
      Array.isArray(body?.records) ? body.records :
      Array.isArray(body?.items) ? body.items : null;
    if (!Array.isArray(page)) {
      const keys = body && typeof body === "object" ? Object.keys(body).join(", ") : "none";
      throw new BaasError(`Unexpected BaaS response for ${collection} list (top-level keys: ${keys || "none"})`, 502);
    }
    all.push(...page);
    const totalValue = body?.total ?? body?.data?.total ?? body?.pagination?.total;
    const total = typeof totalValue === "number" && Number.isFinite(totalValue) ? totalValue : null;
    if (page.length < PAGE_SIZE || (total !== null && all.length >= total)) break;
    offset += PAGE_SIZE;
  }
  return all;
}

export async function getRecord<T>(collection: string, id: number): Promise<BaasRecord<T> | null> {
  const resp = await baasFetch(`/api/v1/data/${collection}/${id}`);
  if (resp.status === 404) return null;
  return parseJsonOrThrow(resp);
}

export async function createRecord<T>(collection: string, data: T): Promise<BaasRecord<T>> {
  const resp = await baasFetch(`/api/v1/data/${collection}`, {
    method: "POST",
    body: JSON.stringify({ data }),
  });
  return parseJsonOrThrow(resp);
}

/** Partially updates a record — only the provided fields in `data` are merged in server-side. */
export async function patchRecord<T>(
  collection: string,
  id: number,
  data: Partial<T>,
): Promise<BaasRecord<T>> {
  const resp = await baasFetch(`/api/v1/data/${collection}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ data }),
  });
  return parseJsonOrThrow(resp);
}

export async function deleteRecord(collection: string, id: number): Promise<void> {
  const resp = await baasFetch(`/api/v1/data/${collection}/${id}`, { method: "DELETE" });
  if (!resp.ok && resp.status !== 404) await parseJsonOrThrow(resp);
}

/** Declares a set of fields that must be unique within a collection (enforced server-side). */
export async function setUniqueFields(collection: string, uniqueFields: string[]): Promise<void> {
  const resp = await baasFetch(`/api/v1/collections/${collection}/schema`, {
    method: "PUT",
    body: JSON.stringify({ uniqueFields }),
  });
  await parseJsonOrThrow(resp);
}

export function isDuplicateFieldError(err: unknown): err is BaasError {
  return err instanceof BaasError && err.status === 409;
}

// ── Object storage ──────────────────────────────────────────────────────────

export type StorageUploadInit = {
  uploadURL: string;
  objectPath: string;
  downloadUrl: string;
  fileId: number;
};

/** Step 1: reserves an object and returns a signed upload URL. */
export async function initStorageUpload(params: {
  name: string;
  size: number;
  contentType: string;
}): Promise<StorageUploadInit> {
  const resp = await baasFetch(`/api/v1/storage/upload`, {
    method: "POST",
    body: JSON.stringify(params),
  });
  const result = await parseJsonOrThrow(resp);
  if (
    !result ||
    typeof result !== "object" ||
    typeof result.uploadURL !== "string" ||
    typeof result.downloadUrl !== "string" ||
    !Number.isSafeInteger(result.fileId)
  ) {
    throw new BaasError("BaaS returned an invalid storage upload response", 502);
  }
  return {
    ...result,
    uploadURL: trustedStorageUrl(result.uploadURL),
    downloadUrl: trustedStorageUrl(result.downloadUrl),
  } as StorageUploadInit;
}

function trustedStorageUrl(value: string): string {
  const base = new URL(baseUrl());
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    throw new BaasError("BaaS returned an invalid storage URL", 502);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== base.origin ||
    !parsed.pathname.startsWith("/api/storage/objects/") ||
    parsed.username ||
    parsed.password
  ) {
    throw new BaasError("BaaS returned an untrusted storage URL", 502);
  }
  return parsed.href;
}

/** Step 2: PUTs the raw file bytes to the signed URL returned by initStorageUpload. */
export async function putStorageBytes(
  uploadURL: string,
  body: Buffer | ArrayBuffer,
  contentType: string,
): Promise<void> {
  const resp = await fetch(trustedStorageUrl(uploadURL), {
    method: "PUT",
    redirect: "error",
    headers: { "Content-Type": contentType },
    body,
  });
  if (!resp.ok) throw new BaasError(await resp.text(), resp.status);
}

export async function deleteStorageFile(fileId: number): Promise<void> {
  const resp = await baasFetch(`/api/v1/storage/${fileId}`, { method: "DELETE" });
  if (!resp.ok && resp.status !== 404) await parseJsonOrThrow(resp);
}

/** Fetches the raw bytes of a stored object from its public download URL (no auth required). */
export async function fetchStorageBytes(downloadUrl: string): Promise<Response> {
  return fetch(trustedStorageUrl(downloadUrl), { redirect: "error" });
}
