import { Hono } from "hono";
import { getAuthUserId } from "../lib/auth";
import { hasSupportedImageSignature } from "../lib/file-signatures";
import {
  listRecords,
  getRecord,
  createRecord,
  patchRecord,
  setUniqueFields,
  isDuplicateFieldError,
  initStorageUpload,
  putStorageBytes,
  deleteStorageFile,
} from "../lib/baas";
import type { Bindings, Variables } from "../env.d";

const COLLECTION = "profiles";

type ProfileData = {
  userId: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  avatarFileId?: number | null;
  createdAt: string;
  updatedAt: string;
};

function extname(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

const ALLOWED_AVATAR_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const AVATAR_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 64 * 1024;

const profiles = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

let schemaPromise: Promise<void> | null = null;
/** Declares `username` as unique for the profiles collection (idempotent, done lazily once per isolate). */
async function ensureSchema(env: Bindings) {
  if (!schemaPromise) {
    schemaPromise = setUniqueFields(env, COLLECTION, ["username"]).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function isValidAvatarUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isValidProfileText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function toResponse(record: { id: number; data: ProfileData }) {
  const { avatarFileId: _avatarFileId, ...profile } = record.data;
  return { id: record.id, ...profile };
}

async function findByUserId(env: Bindings, userId: string) {
  const all = await listRecords<ProfileData>(env, COLLECTION);
  return all.find((record) => record.data.userId === userId) ?? null;
}

async function findByUsername(env: Bindings, username: string) {
  const all = await listRecords<ProfileData>(env, COLLECTION);
  return all.find((record) => record.data.username === username) ?? null;
}

profiles.get("/profiles/me", async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  await ensureSchema(c.env);
  let profile = await findByUserId(c.env, userId);

  if (!profile) {
    const now = new Date().toISOString();
    const defaultUsername = `user_${userId.slice(-8)}`;
    profile = await createRecord<ProfileData>(c.env, COLLECTION, {
      userId,
      username: defaultUsername,
      displayName: null,
      bio: null,
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return c.json(toResponse(profile));
});

profiles.put("/profiles/me", async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  await ensureSchema(c.env);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "Invalid profile" }, 400);
  }
  const { username, displayName, bio, avatarUrl } = body as {
    username?: unknown;
    displayName?: unknown;
    bio?: unknown;
    avatarUrl?: unknown;
  };

  if (username !== undefined && (typeof username !== "string" || !USERNAME_RE.test(username))) {
    return c.json({ error: "Username must be 3–20 characters: letters, numbers, _ or -" }, 400);
  }
  if (displayName !== undefined && !isValidProfileText(displayName, 50)) {
    return c.json({ error: "Display name must be 50 characters or fewer" }, 400);
  }
  if (bio !== undefined && !isValidProfileText(bio, 300)) {
    return c.json({ error: "Bio must be 300 characters or fewer" }, 400);
  }
  if (avatarUrl !== undefined && !isValidAvatarUrl(avatarUrl)) {
    return c.json({ error: "Avatar URL must be a valid HTTPS URL" }, 400);
  }

  const existing = await findByUserId(c.env, userId);
  const now = new Date().toISOString();

  try {
    if (!existing) {
      const created = await createRecord<ProfileData>(c.env, COLLECTION, {
        userId,
        username: username ?? `user_${userId.slice(-8)}`,
        displayName: displayName ?? null,
        bio: bio ?? null,
        avatarUrl: avatarUrl ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return c.json(toResponse(created));
    }

    const updated = await patchRecord<ProfileData>(c.env, COLLECTION, existing.id, {
      ...(username !== undefined && { username }),
      ...(displayName !== undefined && { displayName }),
      ...(bio !== undefined && { bio }),
      ...(avatarUrl !== undefined && { avatarUrl }),
      updatedAt: now,
    });
    return c.json(toResponse(updated));
  } catch (err) {
    if (isDuplicateFieldError(err)) return c.json({ error: "Username already taken" }, 400);
    throw err;
  }
});

// ── Upload avatar image ───────────────────────────────────────────────────────
profiles.post("/profiles/avatar", async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const rawLength = Number(c.req.header("content-length"));
  if (Number.isFinite(rawLength) && rawLength > MAX_AVATAR_SIZE + MAX_MULTIPART_OVERHEAD) {
    return c.json({ error: "Avatar image must be 5 MB or smaller" }, 413);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "Invalid avatar upload" }, 400);
  }
  const file = body["avatar"];

  if (!file || !(file instanceof File)) return c.json({ error: "No image uploaded" }, 400);

  const ext = extname(file.name);
  if (!ALLOWED_AVATAR_EXTENSIONS.has(ext)) {
    return c.json({ error: `Unsupported image type. Allowed: ${[...ALLOWED_AVATAR_EXTENSIONS].join(", ")}` }, 400);
  }
  if (file.size < 1) return c.json({ error: "Avatar image is empty" }, 400);
  if (file.size > MAX_AVATAR_SIZE) return c.json({ error: "Avatar image must be 5 MB or smaller" }, 413);
  if (file.type && file.type !== AVATAR_MIME_TYPES[ext]) {
    return c.json({ error: "Avatar content type does not match its file extension" }, 400);
  }
  const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!hasSupportedImageSignature(signature, ext)) {
    return c.json({ error: "Avatar content does not match its file extension" }, 400);
  }

  await ensureSchema(c.env);
  const existing = await findByUserId(c.env, userId);
  const contentType = AVATAR_MIME_TYPES[ext];
  let uploadedFileId: number | null = null;
  try {
    const init = await initStorageUpload(c.env, {
      name: `avatars/${userId}-${Date.now()}${ext}`,
      size: file.size,
      contentType,
    });
    uploadedFileId = init.fileId;
    await putStorageBytes(c.env, init.uploadURL, file, contentType);

    const now = new Date().toISOString();
    if (existing) {
      await patchRecord<ProfileData>(c.env, COLLECTION, existing.id, {
        avatarUrl: init.downloadUrl,
        avatarFileId: init.fileId,
        updatedAt: now,
      });
    } else {
      await createRecord<ProfileData>(c.env, COLLECTION, {
        userId,
        username: `user_${userId.slice(-8)}`,
        displayName: null,
        bio: null,
        avatarUrl: init.downloadUrl,
        avatarFileId: init.fileId,
        createdAt: now,
        updatedAt: now,
      });
    }
    uploadedFileId = null;

    if (existing?.data.avatarFileId && existing.data.avatarFileId !== init.fileId) {
      await deleteStorageFile(c.env, existing.data.avatarFileId).catch(() => {
        console.warn("Could not remove previous avatar object", { fileId: existing.data.avatarFileId });
      });
    }

    return c.json({ url: init.downloadUrl });
  } catch (error) {
    if (uploadedFileId !== null) {
      await deleteStorageFile(c.env, uploadedFileId).catch(() => {});
    }
    throw error;
  }
});

profiles.get("/profiles/check-username", async (c) => {
  const username = c.req.query("username");
  const excludeUserId = c.req.query("excludeUserId");

  if (!username) return c.json({ error: "username is required" }, 400);

  const valid = USERNAME_RE.test(username);
  if (!valid) return c.json({ available: false, valid: false });

  const existing = await findByUsername(c.env, username);
  const takenByOther = existing && existing.data.userId !== excludeUserId;

  return c.json({ available: !takenByOther, valid: true });
});

profiles.get("/profiles/:username", async (c) => {
  const username = c.req.param("username");
  const profile = await findByUsername(c.env, username);
  if (!profile) return c.json({ error: "Profile not found" }, 404);

  return c.json(toResponse(profile));
});

export default profiles;
