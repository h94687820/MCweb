import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  Layers3,
  LoaderCircle,
  Map as MapIcon,
  PencilLine,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  getGetFileStatsQueryKey,
  getGetFileQueryKey,
  getListFilesQueryKey,
  getListFileVersionsQueryKey,
  getListMyFilesQueryKey,
  useListMyFiles,
  useUpdateFileMetadata,
} from "@workspace/api-client-react";
import type { FileMetadataInput, UploadedFile } from "@workspace/api-client-react";
import { useAppAuth } from "@/contexts/auth-context";
import { useLanguage } from "@/contexts/language-context";

type LibraryItem = {
  id: string;
  rootFileId: number;
  releases: UploadedFile[];
  current: UploadedFile;
};

function compareVersions(a: string | null | undefined, b: string | null | undefined) {
  const left = (a || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = (b || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function formatDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(new Date(date));
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LibraryPage() {
  const { isLoaded, isSignedIn } = useAppAuth();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const { data: files, isLoading, isError, refetch } = useListMyFiles({
    query: { enabled: isSignedIn, queryKey: getListMyFilesQueryKey() },
  });
  const updateMetadata = useUpdateFileMetadata();
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [draft, setDraft] = useState<FileMetadataInput>({ title: "", customId: "", description: "" });
  const [saveError, setSaveError] = useState(false);

  const items = useMemo(() => {
    const groups = new Map<string, UploadedFile[]>();
    (files || []).forEach((file) => {
      const key = file.versionGroupId || String(file.rootFileId);
      groups.set(key, [...(groups.get(key) || []), file]);
    });
    return Array.from(groups.entries()).map(([id, releases]) => {
      const sorted = [...releases].sort((a, b) => {
        const versionOrder = compareVersions(a.gameVersion, b.gameVersion);
        return versionOrder || new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
      });
      const current = sorted[0];
      return { id, rootFileId: current.rootFileId, releases: sorted, current };
    }).sort((a, b) => new Date(b.current.uploadedAt).getTime() - new Date(a.current.uploadedAt).getTime());
  }, [files]);

  function openEditor(item: LibraryItem) {
    setDraft({
      title: item.current.title || item.current.originalName,
      customId: item.current.customId || "",
      description: item.current.description || "",
    });
    setSaveError(false);
    setEditing(item);
  }

  function saveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSaveError(false);
    updateMetadata.mutate(
      { id: editing.rootFileId, data: draft },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListMyFilesQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetFileStatsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getListFileVersionsQueryKey(editing.rootFileId) });
          itemDetailQueries(editing.releases).forEach((queryKey) => {
            void queryClient.invalidateQueries({ queryKey });
          });
          setEditing(null);
        },
        onError: () => setSaveError(true),
      },
    );
  }

  const locale = language === "ar" ? "ar" : language;

  function itemDetailQueries(releases: UploadedFile[]) {
    return releases.map((release) => getGetFileQueryKey(release.id));
  }

  if (!isLoaded) {
    return (
      <div className="creator-library library-state-shell" data-testid="library-loading">
        <div className="library-skeleton library-skeleton-title" />
        <div className="library-skeleton" />
        <div className="library-skeleton library-skeleton-row" />
        <div className="library-skeleton library-skeleton-row" />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <section className="creator-library library-gate" data-testid="library-signin-gate">
        <div className="library-index">{t.library.privateWorkspace}</div>
        <div className="library-gate-mark"><BookOpen aria-hidden="true" /></div>
        <h1>{t.library.signInTitle}</h1>
        <p>{t.library.signInDescription}</p>
        <Link href="/sign-in" className="library-primary-link" data-testid="link-library-sign-in">
          {t.library.signInAction}<ArrowUpRight aria-hidden="true" />
        </Link>
      </section>
    );
  }

  return (
    <main className="creator-library">
      <div className="library-topline">
        <Link href="/" className="library-back-link" data-testid="link-library-back">
          <ArrowLeft aria-hidden="true" /> {t.library.back}
        </Link>
        <span className="library-index"><i /> {t.library.privateWorkspace}</span>
        <span className="library-edition-note">{t.home.editionCount}</span>
      </div>

      <header className="creator-library-heading">
        <div>
          <div className="library-eyebrow"><span>01</span> {t.library.eyebrow}</div>
          <h1>{t.library.title}</h1>
          <p>{t.library.subtitle}</p>
        </div>
      </header>

      <div className="library-overview">
        <span className="overview-icon"><Layers3 aria-hidden="true" /></span>
        <div className="library-overview-note">
          <span className="overview-coordinate" aria-hidden="true" />
          <p>{t.library.versionNote}</p>
          <ArrowDownRight aria-hidden="true" />
        </div>
        <span className="library-overview-tag">{t.library.currentRelease}</span>
      </div>

      <div className="library-list-heading">
        <div><span className="library-section-index" aria-hidden="true" /><h2>{t.library.collection}</h2></div>
        <span>{t.library.latestFirst}</span>
      </div>

      {isLoading ? (
        <div className="library-list" aria-label={t.library.loading} data-testid="library-list-loading">
          {[0, 1, 2].map((index) => <div className="library-skeleton library-skeleton-row" key={index} />)}
        </div>
      ) : isError ? (
        <div className="library-message library-message-error" data-testid="library-load-error">
          <CircleAlert aria-hidden="true" />
          <div><strong>{t.library.loadError}</strong><span>{t.library.loadErrorHint}</span></div>
          <button type="button" onClick={() => void refetch()} data-testid="button-library-retry">{t.library.retry}</button>
        </div>
      ) : items.length === 0 ? (
        <div className="library-empty" data-testid="library-empty">
          <div className="empty-stamp" aria-hidden="true" />
          <div className="empty-art"><Code2 aria-hidden="true" /><span /><span /></div>
          <div>
            <h3>{t.library.emptyTitle}</h3>
            <p>{t.library.emptyDescription}</p>
            <Link href="/upload" className="library-primary-link" data-testid="link-library-first-upload">
              <Plus aria-hidden="true" /> {t.library.createFirst}
            </Link>
          </div>
        </div>
      ) : (
        <div className="library-list" data-testid="library-items">
          {items.map((item, index) => {
            const file = item.current;
            const image = file.coverImage || file.images?.[0];
            return (
              <article className="creator-item" key={item.id} data-testid={`library-item-${item.rootFileId}`}>
                <div className="creator-item-art">
                  {image ? <img src={image} alt="" /> : (
                    <div className={`item-art-fallback item-art-${file.edition}`}>
                      {file.type === "map" ? <MapIcon aria-hidden="true" /> : <Code2 aria-hidden="true" />}
                      <span>{String(index + 1).padStart(2, "0")}</span>
                    </div>
                  )}
                  <span className="item-art-edition">{file.edition === "java" ? "JAVA" : "BEDROCK"}</span>
                </div>
                <div className="creator-item-content">
                  <div className="creator-item-kicker">
                    <span>{file.type === "mod" ? t.library.mod : t.library.map}</span>
                    <span className={`scan-indicator scan-${file.scanStatus}`}><i />{t.scan[file.scanStatus === "malicious" ? "malicious" : file.scanStatus === "clean" ? "clean" : file.scanStatus === "scanning" ? "scanning" : file.scanStatus === "pending" ? "pending" : file.scanStatus === "skipped" ? "skipped" : "unverified"]}</span>
                  </div>
                  <Link href={`/files/${file.id}`} className="creator-item-title" data-testid={`link-library-item-${item.rootFileId}`}>
                    {file.title || file.originalName}<ChevronRight aria-hidden="true" />
                  </Link>
                  <div className="creator-item-meta">
                    <span className="item-custom-id">/{file.customId || file.name}</span>
                    <span>{file.edition === "java" ? t.library.java : t.library.bedrock}</span>
                    <span>{formatSize(file.size)}</span>
                  </div>
                  <p className="creator-item-description">{file.description || t.library.noDescription}</p>
                  <div className="creator-item-bottom">
                    <div className="release-summary">
                      <span>{t.library.currentRelease}</span>
                      <strong data-testid={`text-current-version-${item.rootFileId}`}>{file.gameVersion || "—"}</strong>
                      <span>{formatDate(file.uploadedAt, locale)}</span>
                    </div>
                    <div className="creator-item-actions">
                      <button type="button" className="item-action item-edit-action" onClick={() => openEditor(item)} data-testid={`button-edit-item-${item.rootFileId}`}>
                        <PencilLine aria-hidden="true" /><span>{t.library.edit}</span>
                      </button>
                      <Link href={`/upload?versionOf=${item.rootFileId}`} className="item-action item-release-action" data-testid={`link-add-release-${item.rootFileId}`}>
                        <Plus aria-hidden="true" /><span>{t.library.addRelease}</span>
                      </Link>
                    </div>
                  </div>
                </div>
                <aside className="creator-item-releases">
                  <div className="release-heading"><span>{t.library.releases}</span><b>{String(item.releases.length).padStart(2, "0")}</b></div>
                  <div className="release-stack" data-testid={`releases-${item.rootFileId}`}>
                    {item.releases.map((release) => (
                      <Link
                        key={release.id}
                        href={`/files/${release.id}`}
                        className={`release-row${release.id === file.id ? " release-row-current" : ""}`}
                        data-testid={`link-release-${release.id}`}
                      >
                        <span className="release-dot" />
                        <span>{release.gameVersion || t.library.versionUnknown}</span>
                        {release.id === file.id && <span className="release-current-label">{t.library.current}</span>}
                      </Link>
                    ))}
                  </div>
                </aside>
              </article>
            );
          })}
        </div>
      )}

      <footer className="creator-library-footer">
        <span><ShieldCheck aria-hidden="true" /> {t.library.footerSafe}</span>
      </footer>

      {editing && (
        <div className="library-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !updateMetadata.isPending) setEditing(null);
        }}>
          <section className="library-edit-panel" role="dialog" aria-modal="true" aria-labelledby="edit-item-title" data-testid="dialog-edit-item">
            <div className="edit-panel-topline"><span>{t.library.editingItem.replace("{title}", editing.current.title || editing.current.customId || editing.current.originalName)}</span><button type="button" onClick={() => setEditing(null)} aria-label={t.library.close} data-testid="button-close-editor"><X /></button></div>
            <h2 id="edit-item-title">{t.library.editTitle}</h2>
            <p>{t.library.editDescription}</p>
            <form onSubmit={saveMetadata}>
              <label htmlFor="library-title">{t.library.fieldTitle}</label>
              <input id="library-title" value={draft.title} maxLength={100} required onChange={(event) => setDraft({ ...draft, title: event.target.value })} data-testid="input-library-title" />
              <label htmlFor="library-custom-id">{t.library.fieldCustomId}</label>
              <input id="library-custom-id" value={draft.customId} pattern="[a-z0-9-]{3,50}" minLength={3} maxLength={50} required onChange={(event) => setDraft({ ...draft, customId: event.target.value })} data-testid="input-library-custom-id" />
              <span className="edit-field-hint">{t.library.customIdHint}</span>
              <label htmlFor="library-description">{t.library.fieldDescription}</label>
              <textarea id="library-description" value={draft.description} maxLength={2000} rows={5} onChange={(event) => setDraft({ ...draft, description: event.target.value })} data-testid="input-library-description" />
              {saveError && <div className="edit-error" role="alert" data-testid="library-save-error"><CircleAlert />{t.library.saveError}</div>}
              <div className="edit-panel-actions">
                <button type="button" className="edit-cancel" onClick={() => setEditing(null)} disabled={updateMetadata.isPending} data-testid="button-cancel-edit">{t.library.cancel}</button>
                <button type="submit" className="edit-save" disabled={updateMetadata.isPending} data-testid="button-save-metadata">
                  {updateMetadata.isPending ? <LoaderCircle className="library-saving-icon" /> : <Check />}
                  {updateMetadata.isPending ? t.library.saving : t.library.save}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
