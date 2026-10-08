import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireFirebaseAuth } from "../lib/firebaseAuth";
import {
  IMAGE_MIME_TYPES,
  hasSupportedImageSignature,
  readFilePrefix,
} from "../lib/file-signatures";
import {
  listRecords,
  createRecord,
  patchRecord,
  setUniqueFields,
  isDuplicateFieldError,
  initStorageUpload,
  putStorageBytes,
  deleteStorageFile,
} from "../lib/baas";

const router = Router();

const COLLECTION = "profiles";
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;
const ALLOWED_AVATAR_EXTENSIONS = new Set(Object.keys(IMAGE_MIME_TYPES));
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

// ── Temp storage for avatar uploads ─────────────────────────────────────────
const tmpDir = path.join(process.cwd(), "tmp");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpDir),
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_AVATAR_SIZE, fieldSize: 1024, files: 1, fields: 1, parts: 2 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(
      null,
      ALLOWED_AVATAR_EXTENSIONS.has(ext) &&
        (!file.mimetype || file.mimetype === IMAGE_MIME_TYPES[ext]),
    );
  },
});

function avatarUploadMiddleware(req: any, res: any, next: any) {
  avatarUpload.single("avatar")(req, res, (error: any) => {
    if (!error) {
      next();
      return;
    }
    const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
    const isMultipartError = error instanceof multer.MulterError;
    res.status(tooLarge ? 413 : isMultipartError ? 400 : 500).json({
      error: tooLarge
        ? "Avatar image must be 5 MB or smaller"
        : isMultipartError
          ? "Invalid avatar upload"
          : "Avatar upload failed",
    });
  });
}

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

function toResponse(record: { id: number; data: ProfileData }) {
  const { avatarFileId: _avatarFileId, ...profile } = record.data;
  return { id: record.id, ...profile };
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

async function findByUserId(userId: string) {
  const all = await listRecords<ProfileData>(COLLECTION);
  return all.find((r) => r.data.userId === userId) ?? null;
}

async function findByUsername(username: string) {
  const all = await listRecords<ProfileData>(COLLECTION);
  return all.find((r) => r.data.username === username) ?? null;
}

let schemaPromise: Promise<void> | null = null;
async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = setUniqueFields(COLLECTION, ["username"]).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

// ── Avatar upload ────────────────────────────────────────────────────────────
router.post("/profiles/avatar", requireFirebaseAuth, avatarUploadMiddleware, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!req.file) return res.status(400).json({ error: "No avatar file uploaded, or file type not allowed" });

  const tmpFile = req.file;
  let uploadedFileId: number | null = null;
  try {
    if (tmpFile.size < 1) return res.status(400).json({ error: "Avatar image is empty" });
    const ext = path.extname(tmpFile.originalname).toLowerCase();
    if (!hasSupportedImageSignature(readFilePrefix(tmpFile.path), ext)) {
      return res.status(400).json({ error: "Avatar content does not match its file extension" });
    }
    await ensureSchema();
    const existing = await findByUserId(userId);
    const contentType = IMAGE_MIME_TYPES[ext];
    const name = `avatars/${userId}-${Date.now()}${ext}`;
    const init = await initStorageUpload({ name, size: tmpFile.size, contentType });
    uploadedFileId = init.fileId;
    const fileBuffer = fs.readFileSync(tmpFile.path);
    await putStorageBytes(init.uploadURL, fileBuffer, contentType);

    if (existing) {
      const updated = await patchRecord<ProfileData>(COLLECTION, existing.id, {
        avatarUrl: init.downloadUrl,
        avatarFileId: init.fileId,
        updatedAt: new Date().toISOString(),
      });
      uploadedFileId = null;
      if (existing.data.avatarFileId && existing.data.avatarFileId !== init.fileId) {
        await deleteStorageFile(existing.data.avatarFileId).catch(() => {
          console.warn("Could not remove previous avatar object", { fileId: existing.data.avatarFileId });
        });
      }
      return res.json({ url: updated.data.avatarUrl });
    } else {
      const now = new Date().toISOString();
      await createRecord<ProfileData>(COLLECTION, {
        userId,
        username: `user_${userId.slice(-8)}`,
        displayName: null,
        bio: null,
        avatarUrl: init.downloadUrl,
        avatarFileId: init.fileId,
        createdAt: now,
        updatedAt: now,
      });
      uploadedFileId = null;
    }

    return res.json({ url: init.downloadUrl });
  } catch (error) {
    if (uploadedFileId !== null) {
      await deleteStorageFile(uploadedFileId).catch(() => {});
    }
    throw error;
  } finally {
    if (fs.existsSync(tmpFile.path)) fs.unlinkSync(tmpFile.path);
  }
});

// ── Get my profile ────────────────────────────────────────────────────────────
router.get("/profiles/me", requireFirebaseAuth, async (req, res) => {
  const userId = (req as any).userId as string;

  await ensureSchema();
  let profile = await findByUserId(userId);

  if (!profile) {
    const now = new Date().toISOString();
    profile = await createRecord<ProfileData>(COLLECTION, {
      userId,
      username: `user_${userId.slice(-8)}`,
      displayName: null,
      bio: null,
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return res.json(toResponse(profile));
});

// ── Update my profile ─────────────────────────────────────────────────────────
router.put("/profiles/me", requireFirebaseAuth, async (req, res) => {
  const userId = (req as any).userId as string;

  await ensureSchema();
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "Invalid profile" });
  }

  const { username, displayName, bio, avatarUrl } = body as {
    username?: string;
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
  };

  if (username !== undefined && (typeof username !== "string" || !USERNAME_RE.test(username))) {
    return res.status(400).json({ error: "Username must be 3–20 characters: letters, numbers, _ or -" });
  }
  if (displayName !== undefined && (typeof displayName !== "string" || displayName.length > 50)) {
    return res.status(400).json({ error: "Display name must be 50 characters or fewer" });
  }
  if (bio !== undefined && (typeof bio !== "string" || bio.length > 300)) {
    return res.status(400).json({ error: "Bio must be 300 characters or fewer" });
  }
  if (avatarUrl !== undefined && !isValidAvatarUrl(avatarUrl)) {
    return res.status(400).json({ error: "Avatar URL must be a valid HTTPS URL" });
  }

  const existing = await findByUserId(userId);
  const now = new Date().toISOString();

  try {
    if (!existing) {
      const created = await createRecord<ProfileData>(COLLECTION, {
        userId,
        username: username ?? `user_${userId.slice(-8)}`,
        displayName: displayName ?? null,
        bio: bio ?? null,
        avatarUrl: avatarUrl ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return res.json(toResponse(created));
    }

    const updated = await patchRecord<ProfileData>(COLLECTION, existing.id, {
      ...(username !== undefined && { username }),
      ...(displayName !== undefined && { displayName }),
      ...(bio !== undefined && { bio }),
      ...(avatarUrl !== undefined && { avatarUrl }),
      updatedAt: now,
    });
    return res.json(toResponse(updated));
  } catch (err) {
    if (isDuplicateFieldError(err)) return res.status(400).json({ error: "Username already taken" });
    throw err;
  }
});

// ── Check username availability ───────────────────────────────────────────────
router.get("/profiles/check-username", async (req, res) => {
  const { username, excludeUserId } = req.query as { username?: string; excludeUserId?: string };
  if (!username) return res.status(400).json({ error: "username is required" });

  const valid = USERNAME_RE.test(username);
  if (!valid) return res.json({ available: false, valid: false });

  const existing = await findByUsername(username);
  const takenByOther = existing && existing.data.userId !== excludeUserId;
  return res.json({ available: !takenByOther, valid: true });
});

// ── Get public profile by username ────────────────────────────────────────────
router.get("/profiles/:username", async (req, res) => {
  const profile = await findByUsername(req.params.username);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  return res.json(toResponse(profile));
});

export default router;
