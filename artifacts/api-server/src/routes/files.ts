import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Readable, Transform } from "stream";
import { ListFilesQueryParams, GetFileParams, DeleteFileParams } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { requireFirebaseAuth as requireAuth } from "../lib/firebaseAuth";
import {
  IMAGE_MIME_TYPES,
  hasSupportedImageSignature,
  hasZipContainerSignature,
  readFilePrefix,
} from "../lib/file-signatures";
import {
  listRecords,
  getRecord,
  createRecord,
  patchRecord,
  deleteRecord,
  setUniqueFields,
  isDuplicateFieldError,
  initStorageUpload,
  putStorageBytes,
  deleteStorageFile,
  fetchStorageBytes,
  BaasError,
} from "../lib/baas";

const router = Router();

// ── Temporary storage for incoming uploads ───────────────────────────────────
const tmpDir = path.join(process.cwd(), "tmp");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const MAX_MAIN_FILE_SIZE = 100 * 1024 * 1024;
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_SIZE = 100 * 1024 * 1024;
const JAVA_EXTENSIONS = new Set([".jar", ".zip"]);
const BEDROCK_EXTENSIONS = new Set([".mcpack", ".mcworld", ".mcaddon", ".mctemplate"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

const bytesByRequest = new WeakMap<object, number>();

class LimitedDiskStorage implements multer.StorageEngine {
  _handleFile(req: any, file: any, cb: any) {
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    const filePath = path.join(tmpDir, filename);
    const output = fs.createWriteStream(filePath, { flags: "wx" });
    const perFileLimit = file.fieldname === "file" ? MAX_MAIN_FILE_SIZE : MAX_IMAGE_FILE_SIZE;
    let fileSize = 0;
    let totalSize = bytesByRequest.get(req) ?? 0;
    let settled = false;

    const finish = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      if (error) {
        output.destroy();
        fs.rm(filePath, { force: true }, () => cb(error));
        return;
      }
      cb(null, { destination: tmpDir, filename, path: filePath, size: fileSize });
    };

    const limiter = new Transform({
      transform(chunk, _encoding, done) {
        const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        fileSize += size;
        totalSize += size;
        bytesByRequest.set(req, totalSize);
        if (fileSize > perFileLimit || totalSize > MAX_TOTAL_UPLOAD_SIZE) {
          done(new multer.MulterError("LIMIT_FILE_SIZE", file.fieldname));
          return;
        }
        done(null, chunk);
      },
    });

    limiter.once("error", finish);
    output.once("error", finish);
    output.once("finish", () => finish());
    file.stream.pipe(limiter).pipe(output);
  }

  _removeFile(_req: any, file: any, cb: any) {
    fs.rm(file.path, { force: true }, cb);
  }
}

function imageFileFilter(_req: any, file: any, cb: any) {
  if (!ALLOWED_IMAGE_EXTENSIONS.has(path.extname(file.originalname).toLowerCase())) {
    cb(new Error("Only JPG, JPEG, PNG, GIF, and WebP images are allowed"));
    return;
  }
  cb(null, true);
}

const upload = multer({
  storage: new LimitedDiskStorage(),
  limits: { fileSize: MAX_MAIN_FILE_SIZE, fieldSize: 8 * 1024, files: 12, fields: 20, parts: 32 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === "file") {
      if (!JAVA_EXTENSIONS.has(ext) && !BEDROCK_EXTENSIONS.has(ext)) {
        cb(new Error("Unsupported file extension"));
        return;
      }
      cb(null, true);
      return;
    }
    imageFileFilter(_req, file, cb);
  },
});
const imageUpload = multer({
  storage: new LimitedDiskStorage(),
  limits: { fileSize: MAX_IMAGE_FILE_SIZE, fieldSize: 8 * 1024, files: 11, fields: 4, parts: 15 },
  fileFilter: imageFileFilter,
});

function multipartFields(parser: multer.Multer, fields: Array<{ name: string; maxCount?: number }>) {
  const middleware = parser.fields(fields);
  return (req: any, res: any, next: any) => middleware(req, res, (error: any) => {
    if (!error) {
      next();
      return;
    }
    const tooLarge = error instanceof multer.MulterError &&
      ["LIMIT_FILE_SIZE", "LIMIT_FILE_COUNT", "LIMIT_PART_COUNT", "LIMIT_FIELD_COUNT"].includes(error.code);
    res.status(tooLarge ? 413 : 400).json({
      error: tooLarge ? "Upload exceeds the allowed size or file count" : error.message,
    });
  });
}

// ── BaaS collection schema ───────────────────────────────────────────────────
const COLLECTION = "files";

type FileData = {
  customId: string | null;
  name: string;          // BaaS download URL (same as filePath)
  originalName: string;
  title: string | null;
  edition: string;
  type: string;
  size: number;
  mimeType: string | null;
  filePath: string;      // BaaS storage download URL for the main file
  mainStorageFileId: number;
  uploadedAt: string;
  scanStatus: string;
  scanDetails: string | null;
  scanEngine: string | null;
  virusTotalLink: string | null;
  detectionRatio: string | null;
  description: string | null;
  coverImage: string | null;      // download URL
  coverImageFileId: number | null;
  images: string[];               // download URLs
  imageFileIds: number[];
  uploadedBy: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fileToResponse(record: { id: number; data: FileData }) {
  // Never expose the public BaaS URL for the main file: it would bypass the
  // File download proxy. VirusTotal status is informational while the scanner is under maintenance.
  const { mainStorageFileId, coverImageFileId, imageFileIds, filePath, ...rest } = record.data;
  return { id: record.id, ...rest, name: record.data.originalName };
}

const DOWNLOAD_MIME_TYPES: Record<string, string> = {
  ".jar": "application/java-archive",
  ".zip": "application/zip",
  ".mcpack": "application/octet-stream",
  ".mcworld": "application/octet-stream",
  ".mcaddon": "application/octet-stream",
  ".mctemplate": "application/octet-stream",
};

function getAllowedExtensions(edition: string): Set<string> {
  return edition === "java" ? JAVA_EXTENSIONS : BEDROCK_EXTENSIONS;
}

function safeDownloadFilename(name: unknown): string {
  return (typeof name === "string" ? name : "download")
    .replace(/[\\/\u0000-\u001F\u007F]/g, "_")
    .slice(0, 255) || "download";
}

function asciiFallbackFilename(name: string): string {
  const ext = path.extname(name);
  const base = path.basename(name, ext)
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .trim();
  const safeExt = ext.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${base || "download"}${safeExt}`.slice(0, 255) || "download";
}

function encodeFilenameHeader(name: string): string {
  return encodeURIComponent(name).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

let schemaEnsured = false;
async function ensureSchema() {
  if (schemaEnsured) return;
  await setUniqueFields(COLLECTION, ["customId"]);
  schemaEnsured = true;
}

/** Read a temp file from disk, upload to BaaS storage, delete the temp file, return the result. */
async function uploadTmpToBaas(
  tmpFile: Express.Multer.File,
  prefix: string,
): Promise<{ downloadUrl: string; fileId: number }> {
  const ext = path.extname(tmpFile.originalname).toLowerCase();
  const name = `${prefix}/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const contentType = prefix === "images"
    ? IMAGE_MIME_TYPES[ext]
    : DOWNLOAD_MIME_TYPES[ext] ?? "application/octet-stream";
  if (!contentType) throw new Error("Unsupported image extension");
  try {
    const buf = fs.readFileSync(tmpFile.path);
    const init = await initStorageUpload({ name, size: tmpFile.size, contentType });
    try {
      await putStorageBytes(init.uploadURL, buf, contentType);
    } catch (error) {
      await deleteStorageFile(init.fileId).catch(() => {});
      throw error;
    }
    return { downloadUrl: init.downloadUrl, fileId: init.fileId };
  } finally {
    if (fs.existsSync(tmpFile.path)) fs.unlinkSync(tmpFile.path);
  }
}

// ── NSFW check (DeepAI) ──────────────────────────────────────────────────────
type ImageModerationWarning = {
  code: "missing_key" | "network_error" | "http_error" | "invalid_response";
  status?: number;
};

async function checkNsfw(tmpFile: Express.Multer.File): Promise<boolean> {
  const deepAiKey = process.env.DEEPAI_API_KEY;
  if (!deepAiKey) {
    throw Object.assign(new Error("DeepAI API key is not configured"), {
      status: 503,
      moderationWarning: { code: "missing_key" } satisfies ImageModerationWarning,
    });
  }
  const buf = fs.readFileSync(tmpFile.path);
  const fd = new FormData();
  fd.append("image", new Blob([buf]), tmpFile.filename);
  let resp: Response;
  try {
    resp = await fetch("https://api.deepai.org/api/nsfw-detector", {
      method: "POST",
      headers: { "api-key": deepAiKey },
      body: fd,
    });
  } catch {
    throw Object.assign(new Error("Could not reach DeepAI"), {
      status: 503,
      moderationWarning: { code: "network_error" } satisfies ImageModerationWarning,
    });
  }
  if (!resp.ok) {
    throw Object.assign(
      new Error(`Image moderation service failed (DeepAI HTTP ${resp.status}); check the DeepAI API key and account`),
      {
        status: 503,
        moderationWarning: { code: "http_error", status: resp.status } satisfies ImageModerationWarning,
      },
    );
  }
  let data: { output?: { nsfw_score?: number } };
  try {
    data = await resp.json() as { output?: { nsfw_score?: number } };
  } catch {
    throw Object.assign(new Error("DeepAI returned an invalid response"), {
      status: 503,
      moderationWarning: { code: "invalid_response" } satisfies ImageModerationWarning,
    });
  }
  const score = data?.output?.nsfw_score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw Object.assign(new Error("DeepAI returned an invalid response"), {
      status: 503,
      moderationWarning: { code: "invalid_response" } satisfies ImageModerationWarning,
    });
  }
  return score > 0.7;
}

// ── List files ───────────────────────────────────────────────────────────────
router.get("/files", async (req, res) => {
  const parseResult = ListFilesQueryParams.safeParse(req.query);
  if (!parseResult.success) return res.status(400).json({ error: "Invalid query params" });

  const { edition, type, scanStatus, search } = parseResult.data as {
    edition?: string; type?: string; scanStatus?: string; search?: string;
  };

  let results = await listRecords<FileData>(COLLECTION);
  if (edition) results = results.filter((r) => r.data.edition === edition);
  if (type) results = results.filter((r) => r.data.type === type);
  if (scanStatus) results = results.filter((r) => r.data.scanStatus === scanStatus);
  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    results = results.filter(
      (r) =>
        r.data.originalName.toLowerCase().includes(term) ||
        (r.data.customId ?? "").toLowerCase().includes(term),
    );
  }
  results.sort((a, b) => new Date(a.data.uploadedAt).getTime() - new Date(b.data.uploadedAt).getTime());

  return res.json(results.map(fileToResponse));
});

// ── Stats — MUST be before /:id ──────────────────────────────────────────────
router.get("/files/stats", async (_req, res) => {
  const rows = await listRecords<FileData>(COLLECTION);
  return res.json({
    totalFiles: rows.length,
    totalMods: rows.filter((r) => r.data.type === "mod").length,
    totalMaps: rows.filter((r) => r.data.type === "map").length,
    javaMods: rows.filter((r) => r.data.edition === "java" && r.data.type === "mod").length,
    javaMaps: rows.filter((r) => r.data.edition === "java" && r.data.type === "map").length,
    bedrockMods: rows.filter((r) => r.data.edition === "bedrock" && r.data.type === "mod").length,
    bedrockMaps: rows.filter((r) => r.data.edition === "bedrock" && r.data.type === "map").length,
    cleanFiles: rows.filter((r) => r.data.scanStatus === "clean").length,
    maliciousFiles: rows.filter((r) => r.data.scanStatus === "malicious").length,
    pendingFiles: rows.filter((r) => r.data.scanStatus === "pending").length,
    totalSizeBytes: rows.reduce((acc, r) => acc + (r.data.size ?? 0), 0),
  });
});

// ── Upload ────────────────────────────────────────────────────────────────────
router.post(
  "/files/upload",
  requireAuth,
  multipartFields(upload, [
    { name: "file", maxCount: 1 },
    { name: "coverImage", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  async (req, res) => {
    const userId = (req as any).userId as string;
    const fields = req.files as Record<string, Express.Multer.File[]> | undefined;
    const mainFile = fields?.["file"]?.[0];
    const coverImageFile = fields?.["coverImage"]?.[0];
    const imageFiles = fields?.["images"] ?? [];
    const uploadedStorageFileIds: number[] = [];
    let insertedRecordId: number | null = null;
    let moderationWarning: ImageModerationWarning | undefined;

    function cleanupTmp() {
      if (mainFile && fs.existsSync(mainFile.path)) fs.unlinkSync(mainFile.path);
      if (coverImageFile && fs.existsSync(coverImageFile.path)) fs.unlinkSync(coverImageFile.path);
      imageFiles.forEach((f) => fs.existsSync(f.path) && fs.unlinkSync(f.path));
    }

    if (!mainFile) {
      cleanupTmp();
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      await ensureSchema();
      const { type, edition, description, customId, title } = req.body as Record<string, unknown>;

      if (typeof type !== "string" || !["mod", "map"].includes(type)) {
        cleanupTmp();
        return res.status(400).json({ error: "type must be 'mod' or 'map'" });
      }
      if (typeof edition !== "string" || !["java", "bedrock"].includes(edition)) {
        cleanupTmp();
        return res.status(400).json({ error: "edition must be 'java' or 'bedrock'" });
      }

      const CUSTOM_ID_REGEX = /^[a-z0-9-]{3,50}$/;
      if (typeof customId !== "string" || !CUSTOM_ID_REGEX.test(customId)) {
        cleanupTmp();
        return res.status(400).json({ error: "customId must be 3–50 chars: lowercase letters, numbers, and hyphens only" });
      }
      if (typeof title !== "string" || !title.trim()) {
        cleanupTmp();
        return res.status(400).json({ error: "title is required" });
      }
      if (title.length > 100) {
        cleanupTmp();
        return res.status(400).json({ error: "title must be 100 characters or fewer" });
      }
      if (description !== undefined && (typeof description !== "string" || description.length > 2000)) {
        cleanupTmp();
        return res.status(400).json({ error: "description must be 2,000 characters or fewer" });
      }

      const ext = path.extname(mainFile.originalname).toLowerCase();
      if (!getAllowedExtensions(edition).has(ext)) {
        cleanupTmp();
        return res.status(400).json({
          error: `${edition === "java" ? "Java" : "Bedrock"} Edition does not accept ${ext || "this"} files. Allowed: ${[...getAllowedExtensions(edition)].join(", ")}`,
        });
      }

      const imagesToModerate = [...(coverImageFile ? [coverImageFile] : []), ...imageFiles];
      if (!hasZipContainerSignature(readFilePrefix(mainFile.path, 4))) {
        cleanupTmp();
        return res.status(400).json({ error: "The uploaded file is not a valid ZIP-based Minecraft archive" });
      }
      if (imagesToModerate.some((image) =>
        !hasSupportedImageSignature(
          readFilePrefix(image.path),
          path.extname(image.originalname).toLowerCase(),
        ),
      )) {
        cleanupTmp();
        return res.status(400).json({ error: "An image does not match its file extension" });
      }
      for (const image of imagesToModerate) {
        try {
          if (await checkNsfw(image)) {
            throw Object.assign(new Error("An image was rejected by the safety check"), { status: 422 });
          }
        } catch (error) {
          const failure = error as { status?: number; moderationWarning?: ImageModerationWarning };
          if (failure.status === 503 && failure.moderationWarning) {
            moderationWarning = failure.moderationWarning;
            break;
          }
          throw error;
        }
      }

      let coverImageUrl: string | null = null;
      let coverImageFileId: number | null = null;
      if (coverImageFile) {
        const stored = await uploadTmpToBaas(coverImageFile, "images");
        coverImageUrl = stored.downloadUrl;
        coverImageFileId = stored.fileId;
        uploadedStorageFileIds.push(stored.fileId);
      }

      const imageUrls: string[] = [];
      const imageFileIds: number[] = [];
      for (const image of imageFiles) {
        const stored = await uploadTmpToBaas(image, "images");
        imageUrls.push(stored.downloadUrl);
        imageFileIds.push(stored.fileId);
        uploadedStorageFileIds.push(stored.fileId);
      }

      const mainResult = await uploadTmpToBaas(mainFile, "files");
      uploadedStorageFileIds.push(mainResult.fileId);

      const inserted = await createRecord<FileData>(COLLECTION, {
        customId,
        name: mainResult.downloadUrl,
        originalName: mainFile.originalname,
        title: title.trim(),
        edition,
        type,
        size: mainFile.size,
        mimeType: DOWNLOAD_MIME_TYPES[ext] ?? "application/octet-stream",
        filePath: mainResult.downloadUrl,
        mainStorageFileId: mainResult.fileId,
        uploadedAt: new Date().toISOString(),
        scanStatus: "pending",
        scanDetails: null,
        scanEngine: null,
        virusTotalLink: null,
        detectionRatio: null,
        description: description ?? null,
        coverImage: coverImageUrl,
        coverImageFileId,
        images: imageUrls,
        imageFileIds,
        uploadedBy: userId,
      });
      insertedRecordId = inserted.id;

      const vtKey = process.env.VIRUSTOTAL_API_KEY;
      if (vtKey) {
        performScan(inserted.id, mainResult.downloadUrl, mainFile.size, vtKey).catch(async (err) => {
          const msg = String(err);
          const isRateLimit = msg.includes("rate") || msg.includes("429");
          logger.error({ fileId: inserted.id, err: msg }, "VirusTotal scan failed");
          await patchRecord<FileData>(COLLECTION, inserted.id, {
            scanStatus: "error",
            scanDetails: isRateLimit ? "Rate limited — needs manual rescan" : msg,
          }).catch((patchErr) => logger.error({ fileId: inserted.id, err: String(patchErr) }, "Could not save VirusTotal scan failure"));
        });
      } else {
        const unverified = await patchRecord<FileData>(COLLECTION, inserted.id, {
          scanStatus: "error",
          scanDetails: "VirusTotal API key not configured — file unverified",
        });
        return res.status(201).json({
          ...fileToResponse(unverified),
          ...(moderationWarning ? { moderationWarning } : {}),
        });
      }

      return res.status(201).json({
        ...fileToResponse(inserted),
        ...(moderationWarning ? { moderationWarning } : {}),
      });
    } catch (err: any) {
      cleanupTmp();
      logger.error({ err: err?.message, stack: err?.stack }, "Upload failed");
      if (insertedRecordId !== null) {
        await deleteRecord(COLLECTION, insertedRecordId).catch((cleanupErr) => {
          logger.error({ fileId: insertedRecordId, err: String(cleanupErr) }, "Could not roll back uploaded record");
        });
      }
      for (const storageId of [...uploadedStorageFileIds].reverse()) {
        await deleteStorageFile(storageId).catch((cleanupErr) => {
          logger.error({ storageId, err: String(cleanupErr) }, "Could not roll back uploaded storage object");
        });
      }
      if (isDuplicateFieldError(err)) {
        return res.status(409).json({ error: "customId is already taken, please choose another" });
      }
      if (err instanceof BaasError) {
        return res.status(502).json({ error: "Storage service unavailable" });
      }
      return res.status(err?.status ?? 500).json({ error: err?.message ?? "Upload failed" });
    }
  },
);

// ── Rescan ────────────────────────────────────────────────────────────────────
router.post("/files/:id/scan", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const parseResult = GetFileParams.safeParse({ id: Number(req.params.id) });
  if (!parseResult.success) return res.status(400).json({ error: "Invalid id" });

  const file = await getRecord<FileData>(COLLECTION, parseResult.data.id);
  if (!file) return res.status(404).json({ error: "Not found" });
  if (file.data.uploadedBy !== userId) return res.status(403).json({ error: "Forbidden — you can only rescan your own files" });
  if (!["pending", "error"].includes(file.data.scanStatus)) {
    return res.status(409).json({ error: "Only pending or failed scans can be retried" });
  }

  const vtKey = process.env.VIRUSTOTAL_API_KEY;
  if (!vtKey) return res.status(503).json({ error: "VirusTotal API key not configured" });

  const updated = await patchRecord<FileData>(COLLECTION, file.id, { scanStatus: "scanning", scanDetails: null });

  performScan(file.id, file.data.filePath, file.data.size, vtKey).catch(async (err) => {
    const msg = String(err);
    const isRateLimit = msg.includes("rate") || msg.includes("429");
    logger.error({ fileId: file.id, err: msg }, "VirusTotal rescan failed");
    await patchRecord<FileData>(COLLECTION, file.id, {
      scanStatus: "error",
      scanDetails: isRateLimit ? "Rate limited — needs manual rescan" : msg,
    }).catch(() => {});
  });

  return res.status(202).json(fileToResponse(updated));
});

// ── Update metadata + images ──────────────────────────────────────────────────
router.patch(
  "/files/:id",
  requireAuth,
  multipartFields(imageUpload, [
    { name: "images", maxCount: 10 },
    { name: "coverImage", maxCount: 1 },
  ]),
  async (req, res) => {
    const userId = (req as any).userId as string;
    const parseResult = GetFileParams.safeParse({ id: Number(req.params.id) });
    if (!parseResult.success) return res.status(400).json({ error: "Invalid id" });
    const id = parseResult.data.id;

    const fields = req.files as Record<string, Express.Multer.File[]> | undefined;
    const newImages = fields?.["images"] ?? [];
    const newCoverImage = fields?.["coverImage"]?.[0];

    function cleanupTmp() {
      newImages.forEach((f) => fs.existsSync(f.path) && fs.unlinkSync(f.path));
      if (newCoverImage && fs.existsSync(newCoverImage.path)) fs.unlinkSync(newCoverImage.path);
    }

    const file = await getRecord<FileData>(COLLECTION, id);
    if (!file) { cleanupTmp(); return res.status(404).json({ error: "Not found" }); }
    if (file.data.uploadedBy !== userId) { cleanupTmp(); return res.status(403).json({ error: "Forbidden — you can only edit your own files" }); }

    const { description, title } = req.body as { description?: string; title?: string };
    if (title !== undefined && (typeof title !== "string" || title.length > 100)) {
      cleanupTmp();
      return res.status(400).json({ error: "title must be 100 characters or fewer" });
    }
    if (description !== undefined && (typeof description !== "string" || description.length > 2000)) {
      cleanupTmp();
      return res.status(400).json({ error: "description must be 2,000 characters or fewer" });
    }

    const newlyUploadedIds: number[] = [];
    try {
      const imagesToModerate = [...newImages, ...(newCoverImage ? [newCoverImage] : [])];
      if (imagesToModerate.some((image) =>
        !hasSupportedImageSignature(
          readFilePrefix(image.path),
          path.extname(image.originalname).toLowerCase(),
        ),
      )) {
        cleanupTmp();
        return res.status(400).json({ error: "An image does not match its file extension" });
      }
      if (imagesToModerate.length && !process.env.DEEPAI_API_KEY) {
        cleanupTmp();
        return res.status(503).json({ error: "Image moderation is unavailable; configure DeepAI before uploading images" });
      }
      for (const image of imagesToModerate) {
        if (await checkNsfw(image)) {
          throw Object.assign(new Error("An image was rejected by the safety check"), { status: 422 });
        }
      }

      const newImageUrls: string[] = [];
      const newImageFileIds: number[] = [];
      for (const image of newImages) {
        const stored = await uploadTmpToBaas(image, "images");
        newImageUrls.push(stored.downloadUrl);
        newImageFileIds.push(stored.fileId);
        newlyUploadedIds.push(stored.fileId);
      }

      let newCoverUrl: string | null = null;
      let newCoverFileId: number | null = null;
      if (newCoverImage) {
        const stored = await uploadTmpToBaas(newCoverImage, "images");
        newCoverUrl = stored.downloadUrl;
        newCoverFileId = stored.fileId;
        newlyUploadedIds.push(stored.fileId);
      }

      const updated = await patchRecord<FileData>(COLLECTION, id, {
        title: title !== undefined && title.trim() ? title.trim() : file.data.title,
        coverImage: newCoverUrl ?? file.data.coverImage,
        coverImageFileId: newCoverFileId ?? file.data.coverImageFileId,
        description: description !== undefined ? description : file.data.description,
        images: [
          ...(Array.isArray(file.data.images) ? file.data.images.filter((image): image is string => typeof image === "string") : []),
          ...newImageUrls,
        ],
        imageFileIds: [...(file.data.imageFileIds ?? []), ...newImageFileIds],
      });

      if (newCoverFileId && file.data.coverImageFileId) {
        await deleteStorageFile(file.data.coverImageFileId).catch((err) => {
          logger.warn({ storageId: file.data.coverImageFileId, err: String(err) }, "Could not remove replaced cover");
        });
      }
      return res.json(fileToResponse(updated));
    } catch (err: any) {
      cleanupTmp();
      for (const storageId of newlyUploadedIds) {
        await deleteStorageFile(storageId).catch((cleanupErr) => {
          logger.error({ storageId, err: String(cleanupErr) }, "Could not roll back updated image");
        });
      }
      logger.error({ fileId: id, err: err?.message }, "File update failed");
      if (err instanceof BaasError) {
        return res.status(502).json({ error: "Storage service unavailable" });
      }
      return res.status(err?.status ?? 500).json({ error: err?.message ?? "Update failed" });
    }
  },
);

// ── Download — proxy from BaaS to preserve Content-Disposition for Safari ─────
router.get("/files/:id/download", async (req, res) => {
  const parseResult = GetFileParams.safeParse({ id: Number(req.params.id) });
  if (!parseResult.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const file = await getRecord<FileData>(COLLECTION, parseResult.data.id);
  if (!file) { res.status(404).json({ error: "Not found" }); return; }
  const storageResp = await fetchStorageBytes(file.data.filePath);
  if (!storageResp.ok || !storageResp.body) { res.status(404).json({ error: "File not found in storage" }); return; }

  const safeFilename = safeDownloadFilename(file.data.originalName);
  const ext = path.extname(safeFilename).toLowerCase();
  const mimeType = DOWNLOAD_MIME_TYPES[ext] ?? "application/octet-stream";
  const fallbackName = asciiFallbackFilename(safeFilename);
  const encodedFilename = encodeFilenameHeader(safeFilename);

  res.setHeader("Content-Disposition", `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedFilename}`);
  res.setHeader("Content-Type", mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");

  const source = Readable.fromWeb(storageResp.body as import("stream/web").ReadableStream);
  source.on("error", (error) => {
    logger.warn({ fileId: file.id, err: String(error) }, "File download stream failed");
    if (res.headersSent) res.destroy(error);
    else res.status(502).end("File download failed");
  });
  res.on("close", () => {
    if (!source.destroyed) source.destroy();
  });
  source.pipe(res);
});

// ── Get file ──────────────────────────────────────────────────────────────────
router.get("/files/:id", async (req, res) => {
  const parseResult = GetFileParams.safeParse({ id: Number(req.params.id) });
  if (!parseResult.success) return res.status(400).json({ error: "Invalid id" });

  const file = await getRecord<FileData>(COLLECTION, parseResult.data.id);
  if (!file) return res.status(404).json({ error: "Not found" });

  return res.json(fileToResponse(file));
});

// ── Delete file ───────────────────────────────────────────────────────────────
router.delete("/files/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const parseResult = DeleteFileParams.safeParse({ id: Number(req.params.id) });
  if (!parseResult.success) return res.status(400).json({ error: "Invalid id" });

  const file = await getRecord<FileData>(COLLECTION, parseResult.data.id);
  if (!file) return res.status(404).json({ error: "Not found" });
  if (file.data.uploadedBy !== userId) return res.status(403).json({ error: "Forbidden — you can only delete your own files" });

  // Delete all storage blobs
  const storageIds = [
    file.data.mainStorageFileId,
    file.data.coverImageFileId,
    ...(Array.isArray(file.data.imageFileIds) ? file.data.imageFileIds : []),
  ].filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
  await Promise.all([...new Set(storageIds)].map((id) => deleteStorageFile(id)));

  await deleteRecord(COLLECTION, file.id);

  return res.status(204).send();
});

// ── VirusTotal scanning ───────────────────────────────────────────────────────
const VT_DIRECT_UPLOAD_LIMIT = 32 * 1024 * 1024;

async function performScan(fileId: number, fileDownloadUrl: string, fileSize: number, apiKey: string) {
  await patchRecord<FileData>(COLLECTION, fileId, { scanStatus: "scanning", scanDetails: null });

  // Download file from BaaS storage
  const blobResp = await fetchStorageBytes(fileDownloadUrl);
  if (!blobResp.ok) throw new Error("File missing from BaaS storage");
  const fileBuffer = await blobResp.arrayBuffer();

  let uploadUrl = "https://www.virustotal.com/api/v3/files";
  if (fileSize > VT_DIRECT_UPLOAD_LIMIT) {
    const urlResp = await fetch("https://www.virustotal.com/api/v3/files/upload_url", {
      headers: { "x-apikey": apiKey },
    });
    if (!urlResp.ok) throw new Error(`VT upload_url request failed: ${urlResp.status}`);
    const urlData = await urlResp.json() as { data: string };
    uploadUrl = urlData.data;
  }

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), fileDownloadUrl.split("/").pop() ?? "file");

  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: { "x-apikey": apiKey },
    body: formData,
  });
  if (!uploadResp.ok) throw new Error(`VT upload failed: ${uploadResp.status}`);

  const uploadData = await uploadResp.json() as { data: { id: string } };
  const analysisId = uploadData.data.id;

  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollResp = await fetch(`https://www.virustotal.com/api/v3/analyses/${analysisId}`, {
      headers: { "x-apikey": apiKey },
    });
    if (!pollResp.ok) continue;

    const pollData = await pollResp.json() as {
      data: {
        attributes: {
          status: string;
          stats?: { malicious?: number; suspicious?: number; undetected?: number; harmless?: number };
        };
      };
    };

    const attrs = pollData.data.attributes;
    if (attrs.status !== "completed") continue;

    const stats = attrs.stats ?? {};
    const malicious = (stats.malicious ?? 0) + (stats.suspicious ?? 0);
    const total = (stats.malicious ?? 0) + (stats.suspicious ?? 0) + (stats.undetected ?? 0) + (stats.harmless ?? 0);

    if (malicious > 0) {
      // Delete malicious file from BaaS
      const file = await getRecord<FileData>(COLLECTION, fileId);
      if (file) {
        await deleteStorageFile(file.data.mainStorageFileId).catch(() => {});
        if (file.data.coverImageFileId) await deleteStorageFile(file.data.coverImageFileId).catch(() => {});
        for (const fid of file.data.imageFileIds) await deleteStorageFile(fid).catch(() => {});
        await deleteRecord(COLLECTION, fileId);
      }
    } else {
      await patchRecord<FileData>(COLLECTION, fileId, {
        scanStatus: "clean",
        detectionRatio: `0/${total}`,
        virusTotalLink: `https://www.virustotal.com/gui/file-analysis/${analysisId}`,
        scanEngine: "VirusTotal",
        scanDetails: "No threats detected",
      });
    }
    return;
  }

  throw new Error("Scan timed out");
}

export default router;
