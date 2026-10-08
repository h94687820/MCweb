import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  listRecords,
  getRecord,
  createRecord,
  patchRecord,
  deleteRecord,
  setUniqueFields,
  isDuplicateFieldError,
  BaasError,
  initStorageUpload,
  putStorageBytes,
  deleteStorageFile,
  fetchStorageBytes,
} from "../lib/baas";
import { requireAuth } from "../lib/auth";
import { hasSupportedImageSignature, hasZipContainerSignature } from "../lib/file-signatures";
import { ListFilesQueryParams, GetFileParams, DeleteFileParams } from "@workspace/api-zod";
import type { Bindings, Variables } from "../env.d";

const COLLECTION = "files";

type FileData = {
  customId: string | null;
  name: string;
  originalName: string;
  title: string | null;
  edition: string;
  type: string;
  size: number;
  mimeType: string | null;
  filePath: string; // BaaS storage download URL for the main file
  mainStorageFileId: number; // BaaS storage fileId, needed to delete the blob later
  uploadedAt: string;
  scanStatus: string;
  scanDetails: string | null;
  scanEngine: string | null;
  virusTotalLink: string | null;
  detectionRatio: string | null;
  description: string | null;
  coverImage: string | null; // download URL
  coverImageFileId: number | null;
  images: string[]; // download URLs
  imageFileIds: number[];
  uploadedBy: string | null;
};

const files = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const JAVA_EXTENSIONS = new Set([".jar", ".zip"]);
const BEDROCK_EXTENSIONS = new Set([".mcpack", ".mcworld", ".mcaddon", ".mctemplate"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const MAX_MAIN_FILE_SIZE = 100 * 1024 * 1024;
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_SIZE = 100 * 1024 * 1024;
const MAX_IMAGE_COUNT = 11;

function getAllowedExtensions(edition: string): Set<string> {
  return edition === "java" ? JAVA_EXTENSIONS : BEDROCK_EXTENSIONS;
}

function extname(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

function uniqueFilename(filename: string): string {
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `${unique}${extname(filename)}`;
}

function fileToResponse(record: { id: number; data: FileData }) {
  // Never expose the public BaaS URL for the main file: it would bypass the
  // File download proxy. VirusTotal status is informational while the scanner is under maintenance.
  const { mainStorageFileId, coverImageFileId, imageFileIds, filePath, ...rest } = record.data;
  return { id: record.id, ...rest, name: record.data.originalName };
}

let schemaEnsured = false;
async function ensureSchema(env: Bindings) {
  if (schemaEnsured) return;
  await setUniqueFields(env, COLLECTION, ["customId"]);
  schemaEnsured = true;
}

class FileUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly moderationWarning?: ImageModerationWarning,
  ) {
    super(message);
  }
}

type ImageModerationWarning = {
  code: "missing_key" | "network_error" | "http_error" | "invalid_response";
  status?: number;
};

async function uploadFileToBaas(env: Bindings, file: File, prefix: string) {
  const ext = extname(file.name);
  const contentType = prefix === "images"
    ? ({
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
      } as Record<string, string>)[ext] ?? "application/octet-stream"
    : "application/octet-stream";
  const init = await initStorageUpload(env, {
    name: `${prefix}/${uniqueFilename(file.name)}`,
    size: file.size,
    contentType,
  });
  try {
    await putStorageBytes(env, init.uploadURL, file, contentType);
  } catch (error) {
    await deleteStorageFile(env, init.fileId).catch(() => {});
    throw error;
  }
  return { downloadUrl: init.downloadUrl, fileId: init.fileId };
}

async function checkImageNsfw(env: Bindings, image: File): Promise<boolean> {
  if (!env.DEEPAI_API_KEY) {
    throw new FileUploadError("DeepAI API key is not configured", 503, { code: "missing_key" });
  }
  const form = new FormData();
  form.append("image", image, image.name);
  let response: Response;
  try {
    response = await fetch("https://api.deepai.org/api/nsfw-detector", {
      method: "POST",
      headers: { "api-key": env.DEEPAI_API_KEY },
      body: form,
    });
  } catch {
    throw new FileUploadError("Could not reach DeepAI", 503, { code: "network_error" });
  }
  if (!response.ok) {
    throw new FileUploadError(
      `Image moderation service failed (DeepAI HTTP ${response.status}); check the DeepAI API key and account`,
      503,
      { code: "http_error", status: response.status },
    );
  }
  let data: { output?: { nsfw_score?: number } };
  try {
    data = (await response.json()) as { output?: { nsfw_score?: number } };
  } catch {
    throw new FileUploadError("DeepAI returned an invalid response", 503, { code: "invalid_response" });
  }
  const score = data?.output?.nsfw_score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new FileUploadError("DeepAI returned an invalid response", 503, { code: "invalid_response" });
  }
  return score > 0.7;
}

// ── List files ───────────────────────────────────────────────────────────────
files.get("/files", async (c) => {
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const parseResult = ListFilesQueryParams.safeParse(query);
  if (!parseResult.success) return c.json({ error: "Invalid query params" }, 400);

  const { edition, type, scanStatus, search } = parseResult.data as {
    edition?: string;
    type?: string;
    scanStatus?: string;
    search?: string;
  };

  let results = await listRecords<FileData>(c.env, COLLECTION);

  if (edition) results = results.filter((r) => r.data.edition === edition);
  if (type) results = results.filter((r) => r.data.type === type);
  if (scanStatus) results = results.filter((r) => r.data.scanStatus === scanStatus);
  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    results = results.filter(
      (r) => r.data.originalName.toLowerCase().includes(term) || (r.data.customId ?? "").toLowerCase().includes(term),
    );
  }

  results.sort((a, b) => new Date(a.data.uploadedAt).getTime() - new Date(b.data.uploadedAt).getTime());

  return c.json(results.map(fileToResponse));
});

// ── Stats — MUST be before /:id ──────────────────────────────────────────────
files.get("/files/stats", async (c) => {
  const rows = await listRecords<FileData>(c.env, COLLECTION);

  return c.json({
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

// ── Upload (requires auth) ────────────────────────────────────────────────────
files.post("/files/upload", requireAuth, async (c) => {
  const userId = c.get("userId");
  const contentLength = c.req.header("content-length");
  if (contentLength && Number(contentLength) > MAX_TOTAL_UPLOAD_SIZE) {
    return c.json({ error: "Upload exceeds the 100 MB total limit" }, 413);
  }
  const body = await c.req.parseBody({ all: true });

  const mainFile = body["file"] as File | undefined;
  const rawCoverImage = body["coverImage"];
  const coverImageFile = rawCoverImage instanceof File ? rawCoverImage : undefined;
  const rawImages = body["images"];
  const imageFiles = (Array.isArray(rawImages) ? rawImages : rawImages ? [rawImages] : []).filter(
    (f): f is File => f instanceof File,
  );

  if (!mainFile || !(mainFile instanceof File)) return c.json({ error: "No file uploaded" }, 400);
  const allImages = [...(coverImageFile ? [coverImageFile] : []), ...imageFiles];
  const totalFileBytes = mainFile.size + allImages.reduce((sum, image) => sum + image.size, 0);
  if (
    mainFile.size > MAX_MAIN_FILE_SIZE ||
    allImages.some((image) => image.size > MAX_IMAGE_FILE_SIZE) ||
    allImages.length > MAX_IMAGE_COUNT ||
    totalFileBytes > MAX_TOTAL_UPLOAD_SIZE
  ) {
    return c.json({ error: "Files exceed the 100 MB total limit or the 10 MB per-image limit" }, 413);
  }

  const type = body["type"];
  const edition = body["edition"];
  const description = body["description"];
  const customId = body["customId"];
  const title = body["title"];

  if (typeof type !== "string" || !["mod", "map"].includes(type)) {
    return c.json({ error: "type must be 'mod' or 'map'" }, 400);
  }
  if (typeof edition !== "string" || !["java", "bedrock"].includes(edition)) {
    return c.json({ error: "edition must be 'java' or 'bedrock'" }, 400);
  }

  const CUSTOM_ID_REGEX = /^[a-z0-9-]{3,50}$/;
  if (typeof customId !== "string" || !CUSTOM_ID_REGEX.test(customId)) {
    return c.json({ error: "customId must be 3–50 chars: lowercase letters, numbers, and hyphens only" }, 400);
  }

  if (typeof title !== "string" || !title.trim()) {
    return c.json({ error: "title is required" }, 400);
  }
  if (title.length > 100) {
    return c.json({ error: "title must be 100 characters or fewer" }, 400);
  }
  if (description !== undefined && (typeof description !== "string" || description.length > 2000)) {
    return c.json({ error: "description must be 2,000 characters or fewer" }, 400);
  }

  const ext = extname(mainFile.name);
  const allowed = getAllowedExtensions(edition);
  if (!allowed.has(ext)) {
    return c.json(
      {
        error: `${edition === "java" ? "Java" : "Bedrock"} Edition does not accept ${ext || "this"} files. Allowed: ${[...allowed].join(", ")}`,
      },
      400,
    );
  }

  for (const image of allImages) {
    if (!ALLOWED_IMAGE_EXTENSIONS.has(extname(image.name))) {
      return c.json({ error: "Only JPG, JPEG, PNG, GIF, and WebP images are allowed" }, 400);
    }
  }
  if (!hasZipContainerSignature(new Uint8Array(await mainFile.slice(0, 4).arrayBuffer()))) {
    return c.json({ error: "The uploaded file is not a valid ZIP-based Minecraft archive" }, 400);
  }
  for (const image of allImages) {
    const signature = new Uint8Array(await image.slice(0, 12).arrayBuffer());
    if (!hasSupportedImageSignature(signature, extname(image.name))) {
      return c.json({ error: "An image does not match its file extension" }, 400);
    }
  }

  let moderationWarning: ImageModerationWarning | undefined;
  for (const image of allImages) {
    try {
      if (await checkImageNsfw(c.env, image)) {
        return c.json({ error: "An image was rejected by the safety check" }, 422);
      }
    } catch (error) {
      if (error instanceof FileUploadError && error.moderationWarning) {
        moderationWarning = error.moderationWarning;
        break;
      }
      if (error instanceof FileUploadError) {
        return c.json({ error: error.message }, error.status as ContentfulStatusCode);
      }
      throw error;
    }
  }

  const uploadedStorageFileIds: number[] = [];
  let insertedRecordId: number | null = null;
  try {
    await ensureSchema(c.env);

    let coverImageUrl: string | null = null;
    let coverImageFileId: number | null = null;
    if (coverImageFile) {
      const stored = await uploadFileToBaas(c.env, coverImageFile, "images");
      coverImageUrl = stored.downloadUrl;
      coverImageFileId = stored.fileId;
      uploadedStorageFileIds.push(stored.fileId);
    }

    const imageUrls: string[] = [];
    const imageFileIds: number[] = [];
    for (const image of imageFiles) {
      const stored = await uploadFileToBaas(c.env, image, "images");
      imageUrls.push(stored.downloadUrl);
      imageFileIds.push(stored.fileId);
      uploadedStorageFileIds.push(stored.fileId);
    }

    const mainFileResult = await uploadFileToBaas(c.env, mainFile, "files");
    uploadedStorageFileIds.push(mainFileResult.fileId);

    const inserted = await createRecord<FileData>(c.env, COLLECTION, {
      customId,
      name: mainFileResult.downloadUrl,
      originalName: mainFile.name,
      title: title.trim(),
      edition,
      type,
      size: mainFile.size,
      mimeType: "application/octet-stream",
      filePath: mainFileResult.downloadUrl,
      mainStorageFileId: mainFileResult.fileId,
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

    const apiKey = c.env.VIRUSTOTAL_API_KEY;
    let responseRecord = inserted;
    if (apiKey) {
      c.executionCtx.waitUntil(
        performScan(c.env, inserted.id, mainFileResult.downloadUrl, apiKey).catch(async (err) => {
          const msg = String(err);
          const isRateLimit = msg.includes("rate") || msg.includes("429");
          await patchRecord<FileData>(c.env, COLLECTION, inserted.id, {
            scanStatus: "error",
            scanDetails: isRateLimit ? "Rate limited — needs manual rescan" : msg,
          }).catch(() => {});
        }),
      );
    } else {
      responseRecord = await patchRecord<FileData>(c.env, COLLECTION, inserted.id, {
        scanStatus: "error",
        scanDetails: "VirusTotal API key not configured — file unverified",
      });
    }

    return c.json({
      ...fileToResponse(responseRecord),
      ...(moderationWarning ? { moderationWarning } : {}),
    }, 201);
  } catch (error) {
    if (insertedRecordId !== null) {
      await deleteRecord(c.env, COLLECTION, insertedRecordId).catch(() => {});
    }
    for (const storageId of [...uploadedStorageFileIds].reverse()) {
      await deleteStorageFile(c.env, storageId).catch(() => {});
    }
    if (isDuplicateFieldError(error)) {
      return c.json({ error: "customId is already taken, please choose another" }, 409);
    }
    if (error instanceof FileUploadError) {
      return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    }
    if (error instanceof BaasError) {
      console.error("[files] storage upload failed", { status: error.status });
      return c.json({ error: "Storage service unavailable" }, 502);
    }
    console.error("[files] upload failed", error);
    return c.json({ error: "Upload failed" }, 500);
  }
});

// ── Rescan (requires auth + ownership) ────────────────────────────────────────
files.post("/files/:id/scan", requireAuth, async (c) => {
  const userId = c.get("userId");
  const parseResult = GetFileParams.safeParse({ id: Number(c.req.param("id")) });
  if (!parseResult.success) return c.json({ error: "Invalid id" }, 400);

  const file = await getRecord<FileData>(c.env, COLLECTION, parseResult.data.id);
  if (!file) return c.json({ error: "Not found" }, 404);
  if (file.data.uploadedBy !== userId) {
    return c.json({ error: "Forbidden — you can only rescan your own files" }, 403);
  }
  if (!["pending", "error"].includes(file.data.scanStatus)) {
    return c.json({ error: "Only pending or failed scans can be retried" }, 409);
  }

  const apiKey = c.env.VIRUSTOTAL_API_KEY;
  if (!apiKey) return c.json({ error: "VirusTotal API key not configured" }, 503);

  const updated = await patchRecord<FileData>(c.env, COLLECTION, file.id, {
    scanStatus: "scanning",
    scanDetails: null,
  });

  c.executionCtx.waitUntil(
    performScan(c.env, file.id, file.data.filePath, apiKey).catch(async (error) => {
      const message = String(error);
      const isRateLimit = message.includes("rate") || message.includes("429");
      console.error("[files] VirusTotal rescan failed", { fileId: file.id, error: message });
      await patchRecord<FileData>(c.env, COLLECTION, file.id, {
        scanStatus: "error",
        scanDetails: isRateLimit ? "Rate limited — needs manual rescan" : message,
      }).catch(() => {});
    }),
  );

  return c.json(fileToResponse(updated), 202);
});

// ── Update description/images (requires auth + ownership) ────────────────────
files.patch("/files/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const parseResult = GetFileParams.safeParse({ id: Number(c.req.param("id")) });
  if (!parseResult.success) return c.json({ error: "Invalid id" }, 400);
  const id = parseResult.data.id;

  const file = await getRecord<FileData>(c.env, COLLECTION, id);
  if (!file) return c.json({ error: "Not found" }, 404);
  if (file.data.uploadedBy !== userId) return c.json({ error: "Forbidden — you can only edit your own files" }, 403);

  const contentLength = c.req.header("content-length");
  if (contentLength && Number(contentLength) > MAX_TOTAL_UPLOAD_SIZE) {
    return c.json({ error: "Upload exceeds the 100 MB total limit" }, 413);
  }
  const body = await c.req.parseBody({ all: true });
  const description = body["description"];
  const title = body["title"];
  const rawImages = body["images"];
  const newImages = (Array.isArray(rawImages) ? rawImages : rawImages ? [rawImages] : []).filter(
    (f): f is File => f instanceof File,
  );
  const rawCoverImage = body["coverImage"];
  const newCoverImage = rawCoverImage instanceof File ? rawCoverImage : undefined;
  if (title !== undefined && (typeof title !== "string" || title.length > 100)) {
    return c.json({ error: "title must be 100 characters or fewer" }, 400);
  }
  if (description !== undefined && (typeof description !== "string" || description.length > 2000)) {
    return c.json({ error: "description must be 2,000 characters or fewer" }, 400);
  }
  const imagesToModerate = [...newImages, ...(newCoverImage ? [newCoverImage] : [])];
  const totalImageBytes = imagesToModerate.reduce((sum, image) => sum + image.size, 0);
  if (
    imagesToModerate.length > MAX_IMAGE_COUNT ||
    imagesToModerate.some((image) => image.size > MAX_IMAGE_FILE_SIZE) ||
    totalImageBytes > MAX_TOTAL_UPLOAD_SIZE
  ) {
    return c.json({ error: "Images exceed the 10 MB per-image limit or the total upload limit" }, 413);
  }
  if (imagesToModerate.some((image) => !ALLOWED_IMAGE_EXTENSIONS.has(extname(image.name)))) {
    return c.json({ error: "Only JPG, JPEG, PNG, GIF, and WebP images are allowed" }, 400);
  }
  for (const image of imagesToModerate) {
    const signature = new Uint8Array(await image.slice(0, 12).arrayBuffer());
    if (!hasSupportedImageSignature(signature, extname(image.name))) {
      return c.json({ error: "An image does not match its file extension" }, 400);
    }
  }

  const newlyUploadedIds: number[] = [];
  try {
    for (const image of imagesToModerate) {
      if (await checkImageNsfw(c.env, image)) {
        throw new FileUploadError("An image was rejected by the safety check", 422);
      }
    }

    const newImageUrls: string[] = [];
    const newImageFileIds: number[] = [];
    for (const image of newImages) {
      const stored = await uploadFileToBaas(c.env, image, "images");
      newImageUrls.push(stored.downloadUrl);
      newImageFileIds.push(stored.fileId);
      newlyUploadedIds.push(stored.fileId);
    }

    let newCoverImageUrl: string | null = null;
    let newCoverImageFileId: number | null = null;
    if (newCoverImage) {
      const stored = await uploadFileToBaas(c.env, newCoverImage, "images");
      newCoverImageUrl = stored.downloadUrl;
      newCoverImageFileId = stored.fileId;
      newlyUploadedIds.push(stored.fileId);
    }

    const updated = await patchRecord<FileData>(c.env, COLLECTION, id, {
      title: title !== undefined && title.trim() ? title.trim() : file.data.title,
      coverImage: newCoverImageUrl ?? file.data.coverImage,
      coverImageFileId: newCoverImageFileId ?? file.data.coverImageFileId,
      description: description !== undefined ? description : file.data.description,
      images: [
        ...(Array.isArray(file.data.images) ? file.data.images.filter((image): image is string => typeof image === "string") : []),
        ...newImageUrls,
      ],
      imageFileIds: [...(file.data.imageFileIds ?? []), ...newImageFileIds],
    });

    if (newCoverImageFileId && file.data.coverImageFileId) {
      await deleteStorageFile(c.env, file.data.coverImageFileId).catch(() => {});
    }
    return c.json(fileToResponse(updated));
  } catch (error) {
    for (const storageId of newlyUploadedIds) {
      await deleteStorageFile(c.env, storageId).catch(() => {});
    }
    if (isDuplicateFieldError(error)) {
      return c.json({ error: "Update conflicted with a unique field" }, 409);
    }
    if (error instanceof FileUploadError) {
      return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    }
    if (error instanceof BaasError) {
      console.error("[files] storage update failed", { fileId: id, status: error.status });
      return c.json({ error: "Storage service unavailable" }, 502);
    }
    console.error("[files] update failed", error);
    return c.json({ error: "Update failed" }, 500);
  }
});

// ── Download ──────────────────────────────────────────────────────────────────
files.get("/files/:id/download", async (c) => {
  const parseResult = GetFileParams.safeParse({ id: Number(c.req.param("id")) });
  if (!parseResult.success) return c.json({ error: "Invalid id" }, 400);

  const file = await getRecord<FileData>(c.env, COLLECTION, parseResult.data.id);
  if (!file) return c.json({ error: "Not found" }, 404);
  const resp = await fetchStorageBytes(c.env, file.data.filePath);
  if (!resp.ok) return c.json({ error: "File not found in storage" }, 404);

  const safeFilename = (typeof file.data.originalName === "string" ? file.data.originalName : "download")
    .replace(/[\\/\u0000-\u001F\u007F]/g, "_")
    .slice(0, 255)
    || "download";
  const fallbackName = safeFilename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_") || "download";
  const encodedFilename = encodeURIComponent(safeFilename).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return new Response(resp.body, {
    headers: {
      "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedFilename}`,
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// ── Get file ──────────────────────────────────────────────────────────────────
files.get("/files/:id", async (c) => {
  const parseResult = GetFileParams.safeParse({ id: Number(c.req.param("id")) });
  if (!parseResult.success) return c.json({ error: "Invalid id" }, 400);

  const file = await getRecord<FileData>(c.env, COLLECTION, parseResult.data.id);
  if (!file) return c.json({ error: "Not found" }, 404);

  return c.json(fileToResponse(file));
});

// ── Delete file (requires auth + ownership) ───────────────────────────────────
files.delete("/files/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const parseResult = DeleteFileParams.safeParse({ id: Number(c.req.param("id")) });
  if (!parseResult.success) return c.json({ error: "Invalid id" }, 400);

  const file = await getRecord<FileData>(c.env, COLLECTION, parseResult.data.id);
  if (!file) return c.json({ error: "Not found" }, 404);
  if (file.data.uploadedBy !== userId) return c.json({ error: "Forbidden — you can only delete your own files" }, 403);

  const storageIds = [
    file.data.mainStorageFileId,
    file.data.coverImageFileId,
    ...(Array.isArray(file.data.imageFileIds) ? file.data.imageFileIds : []),
  ].filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
  await Promise.all([...new Set(storageIds)].map((id) => deleteStorageFile(c.env, id)));
  await deleteRecord(c.env, COLLECTION, parseResult.data.id);

  return c.body(null, 204);
});

async function performScan(env: Bindings, fileId: number, fileDownloadUrl: string, apiKey: string) {
  await patchRecord<FileData>(env, COLLECTION, fileId, { scanStatus: "scanning", scanDetails: null });
  const blobResp = await fetchStorageBytes(env, fileDownloadUrl);
  if (!blobResp.ok) throw new Error("File missing from storage");
  const fileBuffer = await blobResp.arrayBuffer();

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), fileDownloadUrl.split("/").pop());

  const VT_DIRECT_UPLOAD_LIMIT = 32 * 1024 * 1024;
  let uploadUrl = "https://www.virustotal.com/api/v3/files";
  if (fileBuffer.byteLength > VT_DIRECT_UPLOAD_LIMIT) {
    const urlResponse = await fetch("https://www.virustotal.com/api/v3/files/upload_url", {
      headers: { "x-apikey": apiKey },
    });
    if (!urlResponse.ok) throw new Error(`VT upload_url request failed: ${urlResponse.status}`);
    const urlData = (await urlResponse.json()) as { data: string };
    uploadUrl = urlData.data;
  }

  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: { "x-apikey": apiKey },
    body: formData,
  });

  if (!uploadResp.ok) throw new Error(`VT upload failed: ${uploadResp.status}`);

  const uploadData = (await uploadResp.json()) as { data: { id: string } };
  const analysisId = uploadData.data.id;

  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollResp = await fetch(`https://www.virustotal.com/api/v3/analyses/${analysisId}`, {
      headers: { "x-apikey": apiKey },
    });

    if (!pollResp.ok) continue;

    const pollData = (await pollResp.json()) as {
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
      const file = await getRecord<FileData>(env, COLLECTION, fileId);
      if (file) {
        await deleteStorageFile(env, file.data.mainStorageFileId).catch(() => {});
        if (file.data.coverImageFileId) await deleteStorageFile(env, file.data.coverImageFileId).catch(() => {});
        for (const fid of file.data.imageFileIds) await deleteStorageFile(env, fid).catch(() => {});
        await deleteRecord(env, COLLECTION, fileId);
      }
    } else {
      await patchRecord<FileData>(env, COLLECTION, fileId, {
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

export default files;
