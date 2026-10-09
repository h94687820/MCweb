import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useAppAuth } from "@/contexts/auth-context";
import {
  getGetFileQueryKey,
  getGetFileStatsQueryKey,
  getListFilesQueryKey,
  getListFileVersionsQueryKey,
  getListMyFilesQueryKey,
  useGetFile,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "@/hooks/use-navigate";
import {
  Upload,
  Package,
  Map,
  CheckCircle,
  AlertCircle,
  X,
  FileUp,
  Loader2,
  Cpu,
  Pickaxe,
  ImagePlus,
  Hash,
} from "lucide-react";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/language-context";

type Edition = "java" | "bedrock";
type FileType = "mod" | "map";
type UploadState = "idle" | "uploading" | "success" | "error";
type ModerationWarning = {
  code: "missing_key" | "network_error" | "http_error" | "invalid_response";
  status?: number;
};
type UploadResponsePayload = {
  error?: string;
  moderationWarning?: ModerationWarning;
};

const CUSTOM_ID_REGEX = /^[a-z0-9-]{3,50}$/;
const GAME_VERSION_REGEX = /^\d{1,8}(?:\.\d{1,8}){0,3}$/;
const MAX_MAIN_FILE_SIZE = 100 * 1024 * 1024;
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_SIZE = 100 * 1024 * 1024;
const EDITION_ACCEPT: Record<Edition, string> = {
  java: ".jar,.zip",
  bedrock: ".mcpack,.mcworld,.mcaddon,.mctemplate",
};

const EDITION_HINT: Record<Edition, string> = {
  java: ".jar, .zip — Java mods and world exports",
  bedrock: ".mcpack · .mcworld · .mcaddon · .mctemplate",
};

export default function UploadPage() {
  const queryClient = useQueryClient();
  const { isSignedIn, isLoaded, getToken, user } = useAppAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const versionOfValue = typeof window === "undefined"
    ? null
    : new URLSearchParams(window.location.search).get("versionOf");
  const versionOfNumber = versionOfValue ? Number(versionOfValue) : Number.NaN;
  const isVersionUpload = Number.isSafeInteger(versionOfNumber) && versionOfNumber > 0;
  const invalidVersionTarget = versionOfValue !== null && !isVersionUpload;
  const { data: versionParent, isLoading: isVersionParentLoading } = useGetFile(
    isVersionUpload ? versionOfNumber : 0,
    {
      query: {
        enabled: isVersionUpload,
        queryKey: getGetFileQueryKey(isVersionUpload ? versionOfNumber : 0),
      },
    },
  );
  const [edition, setEdition] = useState<Edition>("java");
  const [fileType, setFileType] = useState<FileType>("mod");
  const [gameVersion, setGameVersion] = useState("");
  const [gameVersionError, setGameVersionError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string>("");
  const [customId, setCustomId] = useState("");
  const [customIdError, setCustomIdError] = useState<string>("");
  const [description, setDescription] = useState("");
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [moderationWarning, setModerationWarning] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const uploadInProgressRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isVersionUpload || !versionParent) return;
    setEdition(versionParent.edition);
    setFileType(versionParent.type);
    setTitle(versionParent.title ?? versionParent.originalName);
    setCustomId(versionParent.customId ?? "");
    setDescription(versionParent.description ?? "");
  }, [isVersionUpload, versionParent]);

  function selectedUploadBytes(mainFile = selectedFile, cover = coverImage, images = selectedImages) {
    return (mainFile?.size ?? 0) + (cover?.size ?? 0) + images.reduce((total, image) => total + image.size, 0);
  }

  function handleEditionChange(e: Edition) {
    if (uploadInProgressRef.current) return;
    setEdition(e);
    setSelectedFile(null);
    setUploadState("idle");
    setErrorMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleCustomIdChange(value: string) {
    const normalized = value.toLowerCase().replace(/\s+/g, "-");
    setCustomId(normalized);
    setCustomIdError("");
  }

  function validateCustomId(): boolean {
    if (!customId) {
      setCustomIdError(t.upload.customIdInvalid);
      return false;
    }
    if (!CUSTOM_ID_REGEX.test(customId)) {
      setCustomIdError(t.upload.customIdInvalid);
      return false;
    }
    return true;
  }

  function validateTitle(): boolean {
    if (!title.trim()) {
      setTitleError("Title is required");
      return false;
    }
    return true;
  }

  function validateGameVersion(): boolean {
    if (!GAME_VERSION_REGEX.test(gameVersion.trim())) {
      setGameVersionError(t.upload.gameVersionError);
      return false;
    }
    setGameVersionError("");
    return true;
  }

  function handleCoverImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_FILE_SIZE) {
      setUploadState("error");
      setErrorMessage(t.upload.imageTooLarge);
      e.target.value = "";
      return;
    }
    if (selectedUploadBytes(selectedFile, file, selectedImages) > MAX_TOTAL_UPLOAD_SIZE) {
      setUploadState("error");
      setErrorMessage(t.upload.totalSizeLimit);
      e.target.value = "";
      return;
    }
    setCoverImage(file);
    setUploadState("idle");
    setErrorMessage("");
  }

  function removeCoverImage() {
    setCoverImage(null);
    if (coverInputRef.current) coverInputRef.current.value = "";
  }

  const handleFile = useCallback((file: File) => {
    if (file.size > MAX_MAIN_FILE_SIZE) {
      setUploadState("error");
      setErrorMessage(t.upload.fileTooLarge);
      return;
    }
    if (selectedUploadBytes(file, coverImage, selectedImages) > MAX_TOTAL_UPLOAD_SIZE) {
      setUploadState("error");
      setErrorMessage(t.upload.totalSizeLimit);
      return;
    }
    setSelectedFile(file);
    setUploadState("idle");
    setErrorMessage("");
  }, [t, coverImage, selectedImages]);

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function handleDragLeave(e: React.DragEvent) { e.preventDefault(); setIsDragging(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleImagesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const validFiles = files.filter((file) => file.size <= MAX_IMAGE_FILE_SIZE);
    if (validFiles.length !== files.length) {
      setUploadState("error");
      setErrorMessage(t.upload.imageTooLarge);
    } else {
      setUploadState("idle");
      setErrorMessage("");
    }
    const nextImages = [...selectedImages, ...validFiles].slice(0, 10);
    if (selectedUploadBytes(selectedFile, coverImage, nextImages) > MAX_TOTAL_UPLOAD_SIZE) {
      setUploadState("error");
      setErrorMessage(t.upload.totalSizeLimit);
    } else {
      setSelectedImages(nextImages);
    }
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function removeImage(index: number) {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    if (!selectedFile || uploadInProgressRef.current) return;
    if (!validateGameVersion()) return;
    if (!isVersionUpload && (!validateTitle() || !validateCustomId())) return;

    uploadInProgressRef.current = true;
    setUploadProgress(0);
    setUploadState("uploading");
    setErrorMessage("");
    setModerationWarning(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("gameVersion", gameVersion.trim());
      if (!isVersionUpload) {
        formData.append("title", title.trim());
        formData.append("type", fileType);
        formData.append("edition", edition);
        formData.append("customId", customId);
        if (description.trim()) {
          formData.append("description", description.trim());
        }
        if (coverImage) {
          formData.append("coverImage", coverImage);
        }
        selectedImages.forEach((img) => formData.append("images", img));
      }

      const authToken = await getToken();
      if (!authToken) {
        throw new Error("Your sign-in session is unavailable. Please sign in again.");
      }

      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await new Promise<Response>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open(
          "POST",
          isVersionUpload
            ? `${base}/api/files/${versionOfNumber}/versions`
            : `${base}/api/files/upload`,
        );
        request.setRequestHeader("Authorization", `Bearer ${authToken}`);
        request.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            // Keep 100% for the confirmed server response, not just transfer completion.
            setUploadProgress(Math.min(99, Math.floor((event.loaded / event.total) * 100)));
          }
        });
        request.addEventListener("load", () => {
          resolve(new Response(request.responseText, {
            status: request.status,
            statusText: request.statusText,
          }));
        });
        request.addEventListener("error", () => reject(new Error("Network error while uploading the file")));
        request.addEventListener("abort", () => reject(new Error("Upload was interrupted")));
        request.send(formData);
      });

      const data = await response.json().catch(() => ({})) as UploadResponsePayload;
      if (!response.ok) {
        const errMsg = data.error ?? `Upload failed (${response.status})`;
        if (!isVersionUpload && (response.status === 409 || errMsg.toLowerCase().includes("taken"))) {
          setCustomIdError(t.upload.customIdTaken);
          setUploadState("idle");
          return;
        }
        throw new Error(errMsg);
      }

      if (data.moderationWarning) {
        const warning = data.moderationWarning;
        const reason = warning.code === "http_error"
          ? `DeepAI HTTP ${warning.status ?? "unknown"}`
          : warning.code === "missing_key"
            ? "DeepAI API key missing"
            : warning.code === "network_error"
              ? "DeepAI network error"
              : "DeepAI response invalid";
        setModerationWarning(t.upload.moderationSkipped.replace("{reason}", reason));
      }

      setUploadProgress(100);
      setUploadState("success");
      queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetFileStatsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListMyFilesQueryKey() });
      if (isVersionUpload) {
        queryClient.invalidateQueries({ queryKey: getListFileVersionsQueryKey(versionOfNumber) });
        queryClient.invalidateQueries({ queryKey: getGetFileQueryKey(versionOfNumber) });
      }

      setTimeout(() => {
        if (isVersionUpload) {
          navigate("/library");
          return;
        }
        setSelectedFile(null);
        setTitle("");
        setTitleError("");
        setCustomId("");
        setCustomIdError("");
        setDescription("");
        setGameVersion("");
        setGameVersionError("");
        setCoverImage(null);
        setSelectedImages([]);
        setUploadState("idle");
        if (fileInputRef.current) fileInputRef.current.value = "";
        if (coverInputRef.current) coverInputRef.current.value = "";
      }, 2500);
    } catch (err) {
      setUploadProgress(0);
      setUploadState("error");
      setErrorMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      uploadInProgressRef.current = false;
    }
  }

  function handleClearFile() {
    setSelectedFile(null);
    setUploadState("idle");
    setErrorMessage("");
    setModerationWarning(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const customIdValid = CUSTOM_ID_REGEX.test(customId);
  const canUpload = !!selectedFile &&
    selectedFile.size <= MAX_MAIN_FILE_SIZE &&
    selectedImages.every((image) => image.size <= MAX_IMAGE_FILE_SIZE) &&
    (!coverImage || coverImage.size <= MAX_IMAGE_FILE_SIZE) &&
    selectedUploadBytes() <= MAX_TOTAL_UPLOAD_SIZE &&
    GAME_VERSION_REGEX.test(gameVersion.trim()) &&
    (isVersionUpload || (!!title.trim() && customIdValid)) &&
    uploadState !== "uploading" &&
    uploadState !== "success";

  const uploadBtnLabel = () => {
    if (uploadState === "uploading") return <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t.upload.uploadingButton}</>;
    if (uploadState === "success") return <><CheckCircle className="w-4 h-4 mr-2" />{t.upload.uploadedButton}</>;
    if (selectedImages.length > 0) {
      return <><Upload className="w-4 h-4 mr-2" />{t.upload.withImages} {selectedImages.length} {selectedImages.length === 1 ? t.upload.image : t.upload.images}</>;
    }
    return <><Upload className="w-4 h-4 mr-2" />{t.upload.uploadButton} {fileType === "mod" ? t.upload.mod : t.upload.map}</>;
  };

  if (!isLoaded) {
    return <div className="p-6 md:p-8 text-sm text-muted-foreground">{t.common.loading}</div>;
  }

  if (!isSignedIn) {
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
    return (
      <div className="p-6 md:p-8 max-w-2xl">
        <div className="border border-primary/30 bg-primary/5 p-6">
          <h1 className="text-xl font-bold">{t.upload.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t.upload.authRequired}</p>
          <a href={`${basePath}/sign-in`} className="mt-4 inline-flex px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold">
            {t.upload.signIn}
          </a>
        </div>
      </div>
    );
  }

  if (isVersionUpload && isVersionParentLoading) {
    return <div className="p-6 md:p-8 text-sm text-muted-foreground">{t.common.loading}</div>;
  }

  if (
    invalidVersionTarget ||
    (isVersionUpload && (!versionParent || versionParent.uploadedBy !== user?.id))
  ) {
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
    return (
      <div className="p-6 md:p-8 max-w-2xl">
        <div className="border border-border bg-card p-6">
          <h1 className="text-xl font-bold">{t.upload.versionSourceUnavailable}</h1>
          <a href={`${basePath}/library`} className="mt-4 inline-flex px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold">
            {t.upload.backToLibrary}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          {isVersionUpload ? t.upload.versionUploadTitle : t.upload.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isVersionUpload ? t.upload.versionUploadSubtitle : t.upload.subtitle}
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="space-y-6">
        {isVersionUpload && versionParent && (
          <div className="border border-primary/30 bg-primary/5 p-4">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">{t.upload.versionFor}</p>
            <p className="mt-1 font-semibold">{versionParent.title || versionParent.originalName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {versionParent.edition === "java" ? t.upload.javaEdition : t.upload.bedrockEdition}
              {" · "}
              {versionParent.type === "mod" ? t.upload.mod : t.upload.map}
            </p>
          </div>
        )}

        {/* Step 1: Edition */}
        {!isVersionUpload && <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{t.upload.stepEdition}</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { id: "java" as Edition, label: t.upload.javaEdition, sub: ".jar, .zip", Icon: Cpu },
              { id: "bedrock" as Edition, label: t.upload.bedrockEdition, sub: ".mcpack, .mcworld", Icon: Pickaxe },
            ] as const).map(({ id, label, sub, Icon }) => (
              <button
                key={id}
                data-testid={`button-edition-${id}`}
                onClick={() => handleEditionChange(id)}
                className={cn(
                  "flex items-center gap-3 p-4 border text-left transition-colors",
                  edition === id ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50"
                )}
              >
                <Icon className={cn("w-5 h-5 flex-shrink-0", edition === id && "text-primary")} />
                <div><p className="font-semibold text-sm">{label}</p><p className="text-xs opacity-70">{sub}</p></div>
              </button>
            ))}
          </div>
        </div>}

        {/* Step 2: Type */}
        {!isVersionUpload && <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{t.upload.stepType}</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { id: "mod" as FileType, label: t.upload.mod, sub: t.upload.modSub, Icon: Package },
              { id: "map" as FileType, label: t.upload.map, sub: t.upload.mapSub, Icon: Map },
            ] as const).map(({ id, label, sub, Icon }) => (
              <button
                key={id}
                data-testid={`button-type-${id}`}
                onClick={() => setFileType(id)}
                className={cn(
                  "flex items-center gap-3 p-4 border text-left transition-colors",
                  fileType === id ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50"
                )}
              >
                <Icon className={cn("w-5 h-5 flex-shrink-0", fileType === id && "text-primary")} />
                <div><p className="font-semibold text-sm">{label}</p><p className="text-xs opacity-70">{sub}</p></div>
              </button>
            ))}
          </div>
        </div>}

        <div>
          <label htmlFor="game-version" className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            {t.upload.gameVersionLabel}
            <span className="text-red-400 ml-1" aria-hidden="true">*</span>
          </label>
          <input
            id="game-version"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={gameVersion}
            onChange={(event) => {
              setGameVersion(event.target.value);
              setGameVersionError("");
            }}
            onBlur={validateGameVersion}
            placeholder={t.upload.gameVersionPlaceholder}
            maxLength={32}
            aria-invalid={!!gameVersionError}
            data-testid="input-game-version"
            className={cn(
              "w-full bg-card border text-sm text-foreground placeholder:text-muted-foreground px-3 py-3 focus:outline-none transition-colors",
              gameVersionError ? "border-red-500/60 focus:border-red-500" : "border-border focus:border-primary/60",
            )}
          />
          <p className="mt-2 text-xs text-muted-foreground">{t.upload.gameVersionHint}</p>
          {gameVersionError && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-red-400" role="alert">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {gameVersionError}
            </p>
          )}
        </div>

        {/* Step 3: File */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{t.upload.stepFile}</p>
          <div
            data-testid="drop-zone"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !selectedFile && fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed p-10 flex flex-col items-center gap-4 transition-colors",
              !selectedFile && "cursor-pointer",
              isDragging ? "border-primary bg-primary/5" : selectedFile ? "border-border bg-card" : "border-border hover:border-primary/50 bg-card"
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={EDITION_ACCEPT[edition]}
              className="hidden"
              onChange={handleInputChange}
              data-testid="input-file"
            />

            <AnimatePresence mode="wait">
              {!selectedFile ? (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3 text-center">
                  <div className="w-14 h-14 border-2 border-dashed border-primary/40 flex items-center justify-center">
                    <FileUp className="w-6 h-6 text-primary/60" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{t.upload.dropHint}</p>
                    <p className="text-xs text-muted-foreground mt-1">{EDITION_HINT[edition]} · {t.upload.maxSize}</p>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="file" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-4 w-full">
                  <div className="w-10 h-10 bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {fileType === "mod" ? <Package className="w-5 h-5 text-primary" /> : <Map className="w-5 h-5 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate" data-testid="text-selected-filename" title={selectedFile.name}>{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{formatBytes(selectedFile.size)}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={(e) => { e.stopPropagation(); handleClearFile(); }} data-testid="button-clear-file">
                    <X className="w-4 h-4" />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <p className="text-xs text-muted-foreground mt-2 font-mono">
            {edition === "java" ? "Java Edition: .jar · .zip" : "Bedrock Edition: .mcpack · .mcworld · .mcaddon · .mctemplate"}
          </p>
        </div>

        {!isVersionUpload && (
          <>
        {/* Step 3.5: Title */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Title</p>
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setTitleError(""); }}
            onBlur={() => !title.trim() && setTitleError("Title is required")}
            placeholder="Give your file a name shown to other users"
            maxLength={100}
            data-testid="input-title"
            className={cn(
              "w-full bg-card border text-sm text-foreground placeholder:text-muted-foreground px-3 py-3 focus:outline-none transition-colors",
              titleError ? "border-red-500/60 focus:border-red-500" : "border-border focus:border-primary/60"
            )}
          />
          {titleError && (
            <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {titleError}
            </p>
          )}
        </div>

        {/* Step 4: Custom ID */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">{t.upload.stepCustomId}</p>
          <p className="text-xs text-muted-foreground mb-3">{t.upload.stepCustomIdDesc}</p>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <Hash className={cn("w-4 h-4", customId && customIdValid ? "text-primary" : "text-muted-foreground")} />
            </div>
            <input
              type="text"
              value={customId}
              onChange={(e) => handleCustomIdChange(e.target.value)}
              onBlur={() => customId && !customIdValid && setCustomIdError(t.upload.customIdInvalid)}
              placeholder={t.upload.customIdPlaceholder}
              maxLength={50}
              className={cn(
                "w-full bg-card border text-sm text-foreground placeholder:text-muted-foreground pl-9 pr-16 py-3 focus:outline-none transition-colors font-mono",
                customIdError ? "border-red-500/60 focus:border-red-500" : customId && customIdValid ? "border-primary/60 focus:border-primary" : "border-border focus:border-primary/60"
              )}
            />
            <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-mono text-muted-foreground">
              {customId.length}/50
            </span>
          </div>
          {customIdError ? (
            <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {customIdError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1.5 font-mono">{t.upload.customIdHint}</p>
          )}
        </div>

        {/* Step 5: Description */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            {t.upload.stepDescription} <span className="normal-case font-normal">{t.upload.stepDescriptionOptional}</span>
          </p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.upload.descriptionPlaceholder}
            rows={3}
            maxLength={2000}
            className="w-full bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground p-3 resize-none focus:outline-none focus:border-primary/60 transition-colors"
          />
        </div>

        {/* Step 5.5: Cover Image */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Cover Image <span className="normal-case font-normal">{t.upload.stepImagesOptional}</span>
          </p>
          {coverImage ? (
            <div className="relative group aspect-video bg-card border border-border overflow-hidden max-w-xs">
              <img src={URL.createObjectURL(coverImage)} alt="Cover preview" className="w-full h-full object-cover" />
              <button
                onClick={removeCoverImage}
                className="absolute top-1 right-1 w-5 h-5 bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => coverInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 border border-dashed border-border hover:border-primary/50 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ImagePlus className="w-4 h-4" />
              Add a cover image
            </button>
          )}
          <input
            ref={coverInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.gif,.webp"
            className="hidden"
            onChange={handleCoverImageChange}
          />
          <p className="text-xs text-muted-foreground mt-2 font-mono">The primary image shown for this file — separate from screenshots</p>
        </div>

        {/* Step 6: Images */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            {t.upload.stepImages} <span className="normal-case font-normal">{t.upload.stepImagesOptional}</span>
          </p>

          {selectedImages.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {selectedImages.map((img, i) => (
                <div key={i} className="relative group aspect-video bg-card border border-border overflow-hidden">
                  <img
                    src={URL.createObjectURL(img)}
                    alt={img.name}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {selectedImages.length < 10 && (
            <button
              onClick={() => imageInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 border border-dashed border-border hover:border-primary/50 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ImagePlus className="w-4 h-4" />
              {t.upload.addImages}
              <span className="text-xs font-mono">({selectedImages.length}/10)</span>
            </button>
          )}

          <input
            ref={imageInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.gif,.webp"
            multiple
            className="hidden"
            onChange={handleImagesChange}
          />
          <p className="text-xs text-muted-foreground mt-2 font-mono">JPG · PNG · GIF · WebP · max 10 MB each</p>
          <p className="text-xs text-muted-foreground mt-1">{t.upload.totalSizeLimit}</p>
        </div>
          </>
        )}

        <AnimatePresence>
          {uploadState === "success" && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>{t.upload.uploadSuccess}</span>
            </motion.div>
          )}
          {uploadState === "error" && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </motion.div>
          )}
          {moderationWarning && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="status"
              aria-live="polite"
              className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{moderationWarning}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-3">
          {(uploadState === "uploading" || uploadState === "success") && (
            <div
              className="space-y-2"
              role="progressbar"
              aria-label={`${t.upload.uploadingButton} ${uploadProgress}%`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadProgress}
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{uploadState === "success" ? t.upload.uploadedButton : t.upload.uploadingButton}</span>
                <span className="font-mono tabular-nums">{uploadProgress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden bg-muted">
                <div
                  className="h-full bg-primary transition-[width] duration-200 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
          <Button
            data-testid="button-upload"
            onClick={handleUpload}
            disabled={!canUpload || uploadInProgressRef.current}
            className="w-full h-11"
          >
            {uploadBtnLabel()}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
