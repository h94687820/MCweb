import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "@/hooks/use-navigate";
import {
  useListFiles, useGetFileStats, getListFilesQueryKey, getGetFileStatsQueryKey, useDeleteFile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppAuth } from "@/contexts/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Package, Map as MapIcon, ShieldCheck, ShieldAlert, Trash2, HardDrive, Clock,
  FileX, Cpu, Pickaxe, Download, ChevronRight, Search, X, ArrowLeft, ArrowUpRight,
  Compass, Layers3, Sparkles, Mountain,
} from "lucide-react";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { UploadedFile } from "@workspace/api-client-react";
import { useLanguage } from "@/contexts/language-context";

type Edition = "java" | "bedrock";
type FileType = "mod" | "map";
type HomeReturnState = { edition: Edition; type: FileType; search: string };

const HOME_RETURN_KEY = "whitewase-home-return";

function readHomeReturnState(): HomeReturnState | null {
  try {
    const value = sessionStorage.getItem(HOME_RETURN_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<HomeReturnState>;
    if (
      (parsed.edition !== "java" && parsed.edition !== "bedrock") ||
      (parsed.type !== "mod" && parsed.type !== "map")
    ) return null;
    return { edition: parsed.edition, type: parsed.type, search: typeof parsed.search === "string" ? parsed.search : "" };
  } catch {
    return null;
  }
}

const enter = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.48, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

function ScanStatusBadge({ status, fileId }: { status: string; fileId: number }) {
  const { t } = useLanguage();
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: t.scan.pending, className: "scan-pending" },
    scanning: { label: t.scan.scanning, className: "scan-scanning" },
    clean: { label: t.scan.clean, className: "scan-clean" },
    malicious: { label: t.scan.malicious, className: "scan-malicious" },
    error: { label: t.scan.unverified, className: "scan-pending" },
    skipped: { label: t.scan.skipped, className: "scan-skipped" },
  };
  const state = map[status] ?? map.pending;
  return <span data-testid={`status-scan-${fileId}`} className={cn("inline-flex items-center px-2 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider", state.className)}>{state.label}</span>;
}

function resolveImageUrl(urlOrFilename: string): string {
  if (urlOrFilename.startsWith("http://") || urlOrFilename.startsWith("https://")) return urlOrFilename;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}/api/uploads/images/${urlOrFilename}`;
}

function filterFiles(files: UploadedFile[], query: string): UploadedFile[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return files;

  return files.filter((file) => (
    file.originalName.toLowerCase().includes(normalized) ||
    (file.customId ?? "").toLowerCase().includes(normalized)
  ));
}

function FileRow({ file, onOpen }: { file: UploadedFile; onOpen: () => void }) {
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteFile();
  const { user } = useAppAuth();
  const { t } = useLanguage();
  const isOwner = !!user && file.uploadedBy === user.id;
  const imageList = Array.isArray(file.images) ? file.images : [];
  const thumb = file.coverImage || imageList[0];
  const date = new Date(file.uploadedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const displayName = file.title || file.originalName;

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(t.fileDetail.deleteFile + "?")) return;
    deleteMutation.mutate({ id: file.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFileStatsQueryKey() });
      },
    });
  }

  return (
    <motion.article variants={enter} data-testid={`card-file-${file.id}`} className="atlas-file-row group">
      <button
        type="button"
        onClick={onOpen}
        data-testid={`button-file-detail-${file.id}`}
        aria-label={`${displayName} — ${file.edition} ${file.type}`}
        className="atlas-file-main"
      >
        {thumb ? (
          <span className="atlas-thumb"><img src={resolveImageUrl(thumb)} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /></span>
        ) : (
          <span className="atlas-thumb atlas-thumb-fallback" aria-hidden="true">{file.type === "mod" ? <Package /> : <MapIcon />}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span data-testid={`text-filename-${file.id}`} title={displayName} className="atlas-file-title">{displayName}</span>
            {file.customId && <span className="atlas-file-id">#{file.customId}</span>}
          </span>
          {file.description && <span className="mt-1 block truncate text-xs text-muted-foreground">{file.description}</span>}
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <ScanStatusBadge status={file.scanStatus} fileId={file.id} />
            <span className="font-mono">{formatBytes(file.size)}</span>
            <span>{date}</span>
            <span className="uppercase tracking-[.14em]">{file.edition} / {file.type}</span>
            {file.gameVersion && (
              <span className="font-mono text-primary" data-testid={`text-game-version-${file.id}`}>
                {t.fileDetail.gameVersionLabel}: {file.gameVersion}
              </span>
            )}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <a
          href={`${base}/api/files/${file.id}/download`}
          download={file.originalName}
          data-testid={`link-download-${file.id}`}
          onClick={(e) => e.stopPropagation()}
          title={t.fileDetail.download}
          aria-label={`${t.fileDetail.download}: ${displayName}`}
          className="atlas-row-action"
        ><Download className="h-4 w-4" /></a>
        {isOwner && <Button variant="ghost" size="icon" className="atlas-row-action hover:text-destructive" onClick={handleDelete} disabled={deleteMutation.isPending} data-testid={`button-delete-${file.id}`} title={t.fileDetail.deleteFile} aria-label={`${t.fileDetail.deleteFile}: ${displayName}`}><Trash2 className="h-4 w-4" /></Button>}
        <ChevronRight className="ml-1 h-4 w-4 text-muted-foreground/55 transition-transform group-hover:translate-x-1" />
      </div>
    </motion.article>
  );
}

function StatStrip() {
  const { data: stats, isLoading, isError, refetch } = useGetFileStats();
  const { t } = useLanguage();
  if (isLoading) return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-[76px] rounded-none" />)}</div>;
  if (isError && !stats) return <div className="atlas-inline-error" role="alert"><span>{t.home.loadError}</span><button data-testid="button-retry-stats" onClick={() => void refetch()}>{t.common.retry}</button></div>;
  const figures = [
    { label: t.home.javaFiles, value: (stats?.javaMods ?? 0) + (stats?.javaMaps ?? 0), icon: Cpu },
    { label: t.home.bedrockFiles, value: (stats?.bedrockMods ?? 0) + (stats?.bedrockMaps ?? 0), icon: Pickaxe },
    { label: t.home.clean, value: stats?.cleanFiles ?? 0, icon: ShieldCheck },
    { label: t.home.malicious, value: stats?.maliciousFiles ?? 0, icon: ShieldAlert },
  ];
  return <div className="atlas-stats" data-testid="home-stats">{figures.map(({ label, value, icon: Icon }, index) => <div className="atlas-stat" key={label}><span className="atlas-stat-icon"><Icon /></span><span className="atlas-stat-copy"><span className="atlas-stat-value">{value}</span><span className="atlas-stat-label">{label}</span></span><span className="atlas-stat-index">0{index + 1}</span></div>)}</div>;
}

function EditionChooser({ onChoose }: { onChoose: (edition: Edition) => void }) {
  const { t } = useLanguage();
  const options: { id: Edition; title: string; subtitle: string; icon: typeof Cpu; name: string }[] = [
    { id: "java", title: t.home.javaEdition, subtitle: t.home.javaWorld, icon: Cpu, name: "JAVA" },
    { id: "bedrock", title: t.home.bedrockEdition, subtitle: t.home.bedrockWorld, icon: Pickaxe, name: "BEDROCK" },
  ];
  return (
    <motion.section className="edition-stage" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.12 } } }} aria-label={t.home.chooseEdition}>
      <div className="edition-stage-top"><span className="atlas-eyebrow"><Compass /> {t.home.worldIndex}</span><span className="atlas-coordinates">40°42′ / 73°59′</span></div>
      <div className="edition-world">
        <div className="world-art" aria-hidden="true" />
        <div className="world-scanline" aria-hidden="true" />
        <div className="edition-intro">
          <span className="atlas-kicker">{t.home.chooseEdition}</span>
          <h1>{t.home.title}</h1>
          <p>{t.home.subtitle}</p>
        </div>
        <div className="edition-path" aria-hidden="true"><span /><span /><span /></div>
        <div className="edition-picks">
          {options.map(({ id, title, subtitle, icon: Icon, name }, index) => (
            <motion.button
              variants={enter}
              type="button"
              key={id}
              onClick={() => onChoose(id)}
              data-testid={`button-edition-${id}`}
              className={cn("edition-choice", `edition-choice-${id}`)}
              aria-label={`${title} — ${subtitle}`}
            >
              <span className="choice-number">0{index + 1} / 02</span>
              <span className="choice-contour" aria-hidden="true" />
              <Icon className="choice-glyph" strokeWidth={1.25} />
              <span className="choice-word">{name}</span>
              <span className="choice-title">{title}</span>
              <span className="choice-subtitle">{subtitle}</span>
              <span className="choice-open">{t.home.enterWorld}<ArrowUpRight /></span>
            </motion.button>
          ))}
        </div>
        <div className="world-caption"><span>{t.home.worldsAwait}</span><span>WW / ATLAS 01</span></div>
      </div>
      <div className="edition-stage-foot"><span>{t.home.hubNote}</span><span className="foot-rule" /><span>{t.home.communityLibrary}</span></div>
    </motion.section>
  );
}

function CategoryChooser({ edition, onBack, onChoose }: { edition: Edition; onBack: () => void; onChoose: (type: FileType) => void }) {
  const { t } = useLanguage();
  const { data: stats } = useGetFileStats();
  const java = edition === "java";
  const options: { id: FileType; label: string; sub: string; count: number; icon: typeof Package }[] = [
    { id: "mod", label: t.home.mods, sub: t.home.modWorld, count: java ? (stats?.javaMods ?? 0) : (stats?.bedrockMods ?? 0), icon: Package },
    { id: "map", label: t.home.maps, sub: t.home.mapWorld, count: java ? (stats?.javaMaps ?? 0) : (stats?.bedrockMaps ?? 0), icon: MapIcon },
  ];
  return (
    <motion.section className="category-stage" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.1 } } }}>
      <motion.button variants={enter} type="button" onClick={onBack} data-testid="button-back-edition" className="atlas-back"><ArrowLeft /> {t.home.backToEditions}</motion.button>
      <motion.div variants={enter} className="category-heading">
        <span className="atlas-eyebrow"><span className={cn("edition-dot", java ? "dot-java" : "dot-bedrock")} />{java ? t.home.javaEdition : t.home.bedrockEdition}</span>
        <h1>{t.home.findYourNext}</h1>
        <p>{t.home.chooseCategory}</p>
      </motion.div>
      <div className={cn("category-landscape", java ? "landscape-java" : "landscape-bedrock")}>
        <div className="landscape-haze" />
        <div className="category-options">
          {options.map(({ id, label, sub, count, icon: Icon }, index) => (
            <motion.button
              key={id}
              variants={enter}
              onClick={() => onChoose(id)}
              data-testid={`button-category-${id}`}
              className={`category-choice category-choice-${id}`}
            >
              <span className="category-index">PATH 0{index + 1}</span>
              <Icon className="category-icon" strokeWidth={1.3} />
              <span className="category-label">{label}</span>
              <span className="category-desc">{sub}</span>
              <span className="category-count">{count.toLocaleString()} <small>{t.home.files}</small></span>
              <span className="category-enter"><ArrowUpRight /></span>
            </motion.button>
          ))}
        </div>
        <div className="landscape-mark"><Mountain /><span>EXPLORE / {java ? "01" : "02"}</span></div>
      </div>
    </motion.section>
  );
}

function FileLibrary({ edition, type, onBack }: { edition: Edition; type: FileType; onBack: () => void }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [search, setSearch] = useState(() => {
    const resume = readHomeReturnState();
    return resume?.edition === edition && resume.type === type ? resume.search : "";
  });
  const params = { edition, type };
  const { data: files, isLoading, isError, refetch } = useListFiles(params, { query: { queryKey: getListFilesQueryKey(params) } });
  const results = filterFiles(files ?? [], search);
  const title = type === "mod" ? t.home.mods : t.home.maps;
  return (
    <motion.section className="library-stage" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.07 } } }}>
      <motion.button variants={enter} type="button" onClick={onBack} data-testid="button-back-category" className="atlas-back"><ArrowLeft /> {t.home.backToCategories}</motion.button>
      <motion.div variants={enter} className="library-heading">
        <div>
          <span className="atlas-eyebrow"><Layers3 /> {edition === "java" ? t.home.javaEdition : t.home.bedrockEdition} / {title}</span>
          <h1>{title}<span className="heading-period">.</span></h1>
          <p>{t.home.librarySubtitle}</p>
        </div>
        <div className="library-total"><span>{isLoading ? "—" : results.length.toString().padStart(2, "0")}</span><small>{t.home.matchingFiles}</small></div>
      </motion.div>
      <StatStrip />
      <motion.div variants={enter} className="library-toolbar">
        <label className="atlas-search">
          <Search />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.home.searchPlaceholder} data-testid="input-file-search" aria-label={t.home.searchPlaceholder} />
          {search && <button type="button" aria-label={t.home.clearSearch} data-testid="button-clear-search" onClick={() => setSearch("")}><X /></button>}
        </label>
        <span className="toolbar-edition"><span className={cn("edition-dot", edition === "java" ? "dot-java" : "dot-bedrock")} />{edition.toUpperCase()} <span>/</span> {type.toUpperCase()}</span>
      </motion.div>
      {isError ? (
        <div className="atlas-state atlas-error" role="alert"><ShieldAlert /><h2>{t.home.loadError}</h2><button onClick={() => void refetch()} data-testid="button-retry-files">{t.common.retry}</button></div>
      ) : isLoading ? (
        <div className="space-y-2" aria-label={t.common.loading} data-testid="loading-files">{[0, 1, 2].map((n) => <Skeleton key={n} className="h-[92px] rounded-none" />)}</div>
      ) : results.length === 0 ? (
        <motion.div className="atlas-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} data-testid="empty-files">
          {search ? <Search /> : <FileX />}
          <h2>{search ? t.home.noResults : (type === "mod" ? t.home.noMods : t.home.noMaps)}</h2>
          <p>{search ? t.home.searchEmptyHint : t.home.emptyCategoryHint}</p>
          {search && <button onClick={() => setSearch("")} data-testid="button-clear-empty-search">{t.home.clearSearch}</button>}
        </motion.div>
      ) : (
        <motion.div variants={{ show: { transition: { staggerChildren: 0.045 } } }} initial="hidden" animate="show" className="atlas-file-list" data-testid="list-files">
          {results.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              onOpen={() => {
                try {
                  sessionStorage.setItem(HOME_RETURN_KEY, JSON.stringify({ edition, type, search }));
                } catch {
                  // The detail page remains reachable even if session storage is unavailable.
                }
                navigate(`/files/${file.id}`);
              }}
            />
          ))}
        </motion.div>
      )}
      <div className="library-footer"><span><Sparkles /> {t.home.libraryFootnote}</span><span>{t.home.files}: {isLoading ? "—" : results.length}</span></div>
    </motion.section>
  );
}

export default function HomePage() {
  const [resume] = useState(readHomeReturnState);
  const [edition, setEdition] = useState<Edition | null>(resume?.edition ?? null);
  const [type, setType] = useState<FileType | null>(resume?.type ?? null);
  const { t } = useLanguage();
  useEffect(() => {
    try {
      sessionStorage.removeItem(HOME_RETURN_KEY);
    } catch {
      // The home selection remains usable without browser storage.
    }
  }, []);
  function resetEdition() { setEdition(null); setType(null); }
  function resetCategory() { setType(null); }

  return (
    <section className="whitewase-home" data-testid="home-page" aria-label={t.home.title}>
      <div className="atlas-topline"><span><span className="online-mark" /> WHITEWASE <span className="topline-slash">/</span> {t.home.atlasLabel}</span><span>{t.home.editionCount}</span></div>
      <AnimatePresence mode="wait">
        {!edition ? (
          <EditionChooser key="editions" onChoose={setEdition} />
        ) : !type ? (
          <CategoryChooser key={`categories-${edition}`} edition={edition} onBack={resetEdition} onChoose={setType} />
        ) : (
          <FileLibrary key={`library-${edition}-${type}`} edition={edition} type={type} onBack={resetCategory} />
        )}
      </AnimatePresence>
    </section>
  );
}
