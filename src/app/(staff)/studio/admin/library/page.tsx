"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { usePermissionStore } from "@/store/permission-store";
import { useFeature } from "@/lib/permissions/use-feature";
import { FeatureLocked } from "@/components/ui/FeatureLocked";
import { resolveImageSrc } from "@/lib/image-src";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import {
  parseZipFile,
  commitParsedZip,
  uploadSingleImage,
  trashLibraryFile,
  trashLibraryFolder,
  fetchFolderSizes,
  formatBytes,
  effectiveLimitBytes,
  wouldExceedQuota,
  type CommitProgress,
} from "@/lib/library-storage";

const supabase = createSupabaseBrowserClient();
const FILES_PAGE_SIZE = 24;
const DEFAULT_STORAGE_QUOTA_MB = 500;

interface FolderRow {
  id: string;
  name: string;
  created_at: string;
  totalBytes: number | null; // null while its size is still being fetched
}

interface FileRow {
  id: string;
  file_name: string;
  storage_key: string;
  file_size_bytes: number;
  created_at: string;
}

interface OrgQuota {
  storage_used_bytes: number;
}

interface Crumb {
  id: string | null;
  name: string;
}

type ViewMode = "grid" | "list";
type SelectionKey = `folder:${string}` | `file:${string}`;

function FolderIcon({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 015.25 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18.75A2.25 2.25 0 0121 9v.776" />
    </svg>
  );
}

function TrashIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
    </svg>
  );
}

function Checkbox({
  checked, onChange, variant = "overlay", className = "",
}: { checked: boolean; onChange: () => void; variant?: "overlay" | "plain"; className?: string }) {
  // The checked (gold) look is always the same regardless of variant --
  // only the unchecked background differs, so a positioning className
  // passed in can never end up fighting the checked state for which
  // background wins (a real bug an earlier version of this had).
  const uncheckedClasses = variant === "plain" ? "bg-bg border-cleo-border" : "bg-black/40 border-white/40";
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      aria-pressed={checked}
      className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors cursor-pointer flex-shrink-0 hover:border-gold ${
        checked ? "bg-gold border-gold" : uncheckedClasses
      } ${className}`}
    >
      {checked && (
        <svg className="w-3 h-3 text-bg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

function LibraryPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderId = searchParams.get("folder");

  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<OrgQuota | null>(null);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [loadingMoreFiles, setLoadingMoreFiles] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: "Library" }]);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selected, setSelected] = useState<Set<SelectionKey>>(new Set());

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState("");

  const [uploadProgress, setUploadProgress] = useState<CommitProgress | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [viewingFile, setViewingFile] = useState<FileRow | null>(null);
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const organizationId = usePermissionStore((s) => s.staff?.organizationId);
  const libraryFeature = useFeature("design_library");
  const storageQuotaFeature = useFeature("storage_quota");
  const fileSizeLimitFeature = useFeature("library_file_size_limit");
  // Live plan/override values, not a cached column -- changing either in the
  // Super Admin panel takes effect the moment this page's permission fetch
  // (already app-wide, on load/tab-focus) picks it up, same as every other
  // plan limit in this app.
  const limitBytes = (storageQuotaFeature.limitValue ?? DEFAULT_STORAGE_QUOTA_MB) * 1024 * 1024;
  const maxFileSizeBytes = fileSizeLimitFeature.limitValue ? fileSizeLimitFeature.limitValue * 1024 * 1024 : undefined;

  async function loadCrumbs(currentId: string | null): Promise<Crumb[]> {
    const chain: Crumb[] = [];
    let cursor = currentId;
    while (cursor) {
      const { data } = await supabase.from("folders").select("id, name, parent_folder_id").eq("id", cursor).maybeSingle();
      if (!data) break;
      chain.unshift({ id: data.id, name: data.name });
      cursor = data.parent_folder_id;
    }
    return [{ id: null, name: "Library" }, ...chain];
  }

  const load = useCallback(async (id: string | null, orgId: string) => {
    const foldersBase = supabase.from("folders").select("id, name, created_at").eq("organization_id", orgId).is("deleted_at", null).order("name");
    const filesBase = supabase
      .from("folder_files").select("id, file_name, storage_key, file_size_bytes, created_at", { count: "exact" })
      .eq("organization_id", orgId).is("deleted_at", null).order("file_name")
      .range(0, FILES_PAGE_SIZE - 1);

    const [{ data: orgRow }, { data: subfolders }, { data: fileRows, count: fileCount }, crumbTrail] = await Promise.all([
      supabase.from("organizations").select("storage_used_bytes").eq("id", orgId).maybeSingle(),
      id ? foldersBase.eq("parent_folder_id", id) : foldersBase.is("parent_folder_id", null),
      id ? filesBase.eq("folder_id", id) : filesBase.is("folder_id", null),
      loadCrumbs(id),
    ]);

    setOrg(orgRow ?? null);
    setFolders((subfolders ?? []).map((f) => ({ ...f, totalBytes: null })));
    setFiles(fileRows ?? []);
    setFilesTotal(fileCount ?? fileRows?.length ?? 0);
    setCrumbs(crumbTrail);
    setSelected(new Set());
    setLoading(false);

    if (subfolders && subfolders.length > 0) {
      const sizes = await fetchFolderSizes(supabase, subfolders.map((f) => f.id));
      setFolders((prev) => prev.map((f) => ({ ...f, totalBytes: sizes.get(f.id) ?? 0 })));
    }
  }, []);

  useEffect(() => {
    if (!organizationId) return; // still waiting on the permission store
    async function run() {
      await load(folderId, organizationId!);
    }
    run();
  }, [folderId, organizationId, load]);

  async function loadMoreFiles() {
    if (!organizationId || loadingMoreFiles) return;
    setLoadingMoreFiles(true);
    let query = supabase
      .from("folder_files").select("id, file_name, storage_key, file_size_bytes, created_at")
      .eq("organization_id", organizationId).is("deleted_at", null).order("file_name")
      .range(files.length, files.length + FILES_PAGE_SIZE - 1);
    query = folderId ? query.eq("folder_id", folderId) : query.is("folder_id", null);
    const { data } = await query;
    setFiles((prev) => [...prev, ...(data ?? [])]);
    setLoadingMoreFiles(false);
  }

  function openFolder(id: string) {
    setLoading(true);
    router.push(`/studio/admin/library?folder=${id}`);
  }

  function goToCrumb(id: string | null) {
    setLoading(true);
    router.push(id ? `/studio/admin/library?folder=${id}` : "/studio/admin/library");
  }

  async function refreshQuota(orgId: string): Promise<OrgQuota> {
    const { data } = await supabase.from("organizations").select("storage_used_bytes").eq("id", orgId).maybeSingle();
    const fresh = data ?? org ?? { storage_used_bytes: 0 };
    setOrg(fresh);
    return fresh;
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name || !organizationId) return;

    setCreatingFolder(true);
    setFolderError("");
    const { error } = await supabase.from("folders").insert({ organization_id: organizationId, parent_folder_id: folderId, name });
    setCreatingFolder(false);

    if (error) {
      setFolderError(error.code === "23505" ? "A folder with that name already exists here." : error.message);
      return;
    }
    setNewFolderOpen(false);
    setNewFolderName("");
    load(folderId, organizationId);
  }

  async function handleUploadImages(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !organizationId) return;
    setUploadError("");

    const picked = Array.from(fileList);
    const addBytes = picked.reduce((sum, f) => sum + f.size, 0);
    const quota = await refreshQuota(organizationId);

    if (wouldExceedQuota(quota.storage_used_bytes, limitBytes, addBytes)) {
      setUploadError(
        `Not enough storage — uploading these would use ${formatBytes(quota.storage_used_bytes + addBytes)} of your ${formatBytes(effectiveLimitBytes(limitBytes))} limit.`
      );
      return;
    }

    setUploadProgress({ done: 0, total: picked.length, label: "Uploading…" });
    try {
      for (let i = 0; i < picked.length; i++) {
        setUploadProgress({ done: i, total: picked.length, label: `Uploading ${picked[i].name}` });
        await uploadSingleImage(supabase, organizationId, folderId, picked[i], maxFileSizeBytes);
      }
    } catch (err) {
      setUploadError((err as Error).message);
    }
    setUploadProgress(null);
    load(folderId, organizationId);
  }

  async function handleUploadZip(file: File | null) {
    if (!file || !organizationId) return;
    setUploadError("");
    setUploadProgress({ done: 0, total: 1, label: "Reading zip…" });

    try {
      const parsed = await parseZipFile(file, maxFileSizeBytes);
      const quota = await refreshQuota(organizationId);

      if (wouldExceedQuota(quota.storage_used_bytes, limitBytes, parsed.totalBytes)) {
        setUploadError(
          `Not enough storage for this zip (${formatBytes(parsed.totalBytes)}) — it would use ${formatBytes(quota.storage_used_bytes + parsed.totalBytes)} of your ${formatBytes(effectiveLimitBytes(limitBytes))} limit.`
        );
        setUploadProgress(null);
        return;
      }

      await commitParsedZip(supabase, organizationId, folderId, parsed, setUploadProgress);
    } catch (err) {
      setUploadError((err as Error).message);
    }
    setUploadProgress(null);
    load(folderId, organizationId);
  }

  function toggleSelect(key: SelectionKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const allKeys = useMemo<SelectionKey[]>(
    () => [...folders.map((f): SelectionKey => `folder:${f.id}`), ...files.map((f): SelectionKey => `file:${f.id}`)],
    [folders, files]
  );
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(allKeys));
  }

  async function runDelete(keys: SelectionKey[]) {
    if (!organizationId) return;
    setDeleting(true);
    try {
      for (const key of keys) {
        const [kind, id] = key.split(":");
        if (kind === "folder") {
          await trashLibraryFolder(supabase, id);
        } else {
          await trashLibraryFile(supabase, id);
        }
      }
      setSelected(new Set());
      await load(folderId, organizationId);
    } catch (err) {
      setUploadError((err as Error).message);
    }
    setDeleting(false);
    setConfirmState(null);
  }

  function requestDeleteFile(file: FileRow) {
    setConfirmState({
      title: "Move to Trash?",
      message: `"${file.file_name}" will move to Trash. You can restore it from there later.`,
      onConfirm: () => runDelete([`file:${file.id}`]),
    });
  }

  function requestDeleteFolder(folder: FolderRow) {
    setConfirmState({
      title: "Move to Trash?",
      message: `"${folder.name}" will be removed, and every image inside it (including nested folders) will move to Trash individually, restorable one at a time.`,
      onConfirm: () => runDelete([`folder:${folder.id}`]),
    });
  }

  function requestDeleteSelected() {
    const count = selected.size;
    setConfirmState({
      title: `Move ${count} item${count === 1 ? "" : "s"} to Trash?`,
      message: "Selected folders will be removed, with every image inside (including nested folders) moved to Trash individually.",
      onConfirm: () => runDelete([...selected]),
    });
  }

  const usedPct = org ? Math.min(100, (org.storage_used_bytes / effectiveLimitBytes(limitBytes)) * 100) : 0;
  const nearLimit = usedPct > 90;
  const busy = uploadProgress !== null;
  const hasMoreFiles = files.length < filesTotal;
  const isEmpty = folders.length === 0 && files.length === 0;

  if (!libraryFeature.loading && !libraryFeature.enabled) {
    return (
      <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-5xl mx-auto w-full">
        <FeatureLocked title="Library not available" message="The Design Library isn't included in your current plan." />
      </div>
    );
  }

  return (
    <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-5xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-gold text-[11px] font-mono tracking-[0.2em] uppercase mb-1">Studio Assets</p>
          <h1 className="font-cinzel text-2xl font-black text-ink">Library</h1>
        </div>

        {org && (
          <div className="flex flex-col gap-1.5 min-w-[14rem]">
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden border border-cleo-border">
              <div className={`h-full rounded-full transition-all ${nearLimit ? "bg-error" : "bg-gold"}`} style={{ width: `${usedPct}%` }} />
            </div>
            <p className="text-muted text-[10px] font-mono text-right">
              {formatBytes(org.storage_used_bytes)} of {formatBytes(limitBytes)} used
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setNewFolderOpen(true)} disabled={busy}
          className="px-3.5 py-2 rounded-lg border border-cleo-border text-ink text-xs font-cinzel font-bold uppercase tracking-wider hover:border-gold/50 hover:text-gold transition-colors cursor-pointer disabled:opacity-50"
        >
          + New Folder
        </button>
        <button
          onClick={() => imageInputRef.current?.click()} disabled={busy}
          className="px-3.5 py-2 rounded-lg border border-cleo-border text-ink text-xs font-cinzel font-bold uppercase tracking-wider hover:border-gold/50 hover:text-gold transition-colors cursor-pointer disabled:opacity-50"
        >
          Upload Images
        </button>
        <button
          onClick={() => zipInputRef.current?.click()} disabled={busy}
          className="px-3.5 py-2 rounded-lg bg-gold text-bg text-xs font-cinzel font-bold uppercase tracking-wider hover:bg-gold-light transition-colors cursor-pointer disabled:opacity-50"
        >
          Upload Zip
        </button>
        <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { handleUploadImages(e.target.files); e.target.value = ""; }} />
        <input ref={zipInputRef} type="file" accept=".zip,application/zip,application/x-zip-compressed" className="hidden" onChange={(e) => { handleUploadZip(e.target.files?.[0] ?? null); e.target.value = ""; }} />

        <div className="ml-auto flex items-center gap-1 bg-surface rounded-lg border border-cleo-border p-1">
          <button
            onClick={() => setViewMode("grid")} title="Grid view"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${viewMode === "grid" ? "bg-gold text-bg" : "text-muted hover:text-ink"}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode("list")} title="List view"
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer ${viewMode === "list" ? "bg-gold text-bg" : "text-muted hover:text-ink"}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {uploadError && (
        <div className="bg-error/10 border border-error/30 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
          <p className="text-error text-xs font-mono leading-relaxed">{uploadError}</p>
          <button onClick={() => setUploadError("")} className="text-error/70 hover:text-error text-sm cursor-pointer flex-shrink-0">×</button>
        </div>
      )}

      {busy && uploadProgress && (
        <div className="bg-surface border border-gold/30 rounded-xl px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-ink text-xs font-mono truncate">{uploadProgress.label}</p>
            <p className="text-muted text-[10px] font-mono flex-shrink-0">{uploadProgress.done} / {uploadProgress.total}</p>
          </div>
          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1.5 flex-wrap text-xs font-mono">
        {crumbs.map((c, i) => (
          <span key={c.id ?? "root"} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted/40">/</span>}
            {i === crumbs.length - 1 ? (
              <span className="text-gold font-bold">{c.name}</span>
            ) : (
              <button onClick={() => goToCrumb(c.id)} className="text-muted hover:text-gold transition-colors cursor-pointer">{c.name}</button>
            )}
          </span>
        ))}
      </div>

      {/* Selection toolbar — hidden until at least one item is individually
          selected, so it doesn't clutter the view before the admin has
          actually started selecting anything. */}
      {!loading && !isEmpty && selected.size > 0 && (
        <div className="flex items-center gap-3 text-xs font-mono">
          <Checkbox checked={allSelected} onChange={toggleSelectAll} variant="plain" />
          <span className="text-muted">{selected.size} selected</span>
          <button onClick={requestDeleteSelected} className="ml-2 flex items-center gap-1.5 text-error hover:text-error/80 transition-colors cursor-pointer uppercase tracking-wider">
            <TrashIcon className="w-3.5 h-3.5" /> Delete Selected
          </button>
          <button onClick={() => setSelected(new Set())} className="text-muted hover:text-ink transition-colors cursor-pointer uppercase tracking-wider">Clear</button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton aspect-square rounded-xl" />)}
        </div>
      ) : isEmpty ? (
        <div className="bg-surface border border-cleo-border rounded-2xl p-10 text-center">
          <p className="text-muted text-sm">Nothing here yet — create a folder, or upload images or a zip.</p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {folders.map((f) => {
            const key: SelectionKey = `folder:${f.id}`;
            return (
              <div key={f.id} className="group relative aspect-square rounded-xl border border-cleo-border hover:border-gold/40 transition-colors bg-surface">
                <Checkbox checked={selected.has(key)} onChange={() => toggleSelect(key)} className="absolute top-1.5 left-1.5 z-10" />
                <button onClick={() => openFolder(f.id)} className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 cursor-pointer">
                  <FolderIcon className="w-14 h-14 text-gold/70 group-hover:text-gold transition-colors" />
                  <span className="text-ink text-xs font-cinzel font-bold text-center truncate w-full">{f.name}</span>
                  <span className="text-muted text-[10px] font-mono">{f.totalBytes === null ? "…" : f.totalBytes === 0 ? "Empty" : formatBytes(f.totalBytes)}</span>
                </button>
                <button
                  onClick={() => requestDeleteFolder(f)} title="Delete folder" aria-label={`Delete ${f.name}`}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-lg bg-bg/80 border border-cleo-border text-muted hover:text-error hover:border-error/40 transition-all flex items-center justify-center cursor-pointer"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}

          {files.map((f) => {
            const key: SelectionKey = `file:${f.id}`;
            return (
              <div key={f.id} className="group relative aspect-square rounded-xl overflow-hidden border border-cleo-border hover:border-gold/40 transition-colors bg-surface-2">
                <Checkbox checked={selected.has(key)} onChange={() => toggleSelect(key)} className="absolute top-1.5 left-1.5 z-10" />
                <button onClick={() => setViewingFile(f)} className="w-full h-full cursor-pointer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={resolveImageSrc(f.storage_key)} alt={f.file_name} className="w-full h-full object-cover" />
                </button>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 py-1.5 pointer-events-none flex flex-col">
                  <p className="text-white text-[10px] font-mono truncate">{f.file_name}</p>
                  <p className="text-white/70 text-[9px] font-mono">{formatBytes(f.file_size_bytes)}</p>
                </div>
                <button
                  onClick={() => requestDeleteFile(f)} title="Delete file" aria-label={`Delete ${f.file_name}`}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-lg bg-black/60 border border-white/20 text-white/80 hover:text-error hover:border-error/60 transition-all flex items-center justify-center cursor-pointer"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {folders.map((f) => {
            const key: SelectionKey = `folder:${f.id}`;
            return (
              <div key={f.id} className="group flex items-center gap-3 bg-surface border border-cleo-border rounded-xl px-3 py-2.5 hover:border-gold/40 transition-colors">
                <Checkbox checked={selected.has(key)} onChange={() => toggleSelect(key)} variant="plain" />
                <button onClick={() => openFolder(f.id)} className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer text-left">
                  <FolderIcon className="w-8 h-8 text-gold/70 flex-shrink-0" />
                  <span className="text-ink text-sm font-cinzel font-bold truncate">{f.name}</span>
                </button>
                <span className="text-muted text-[10px] font-mono flex-shrink-0 w-20 text-right">
                  {f.totalBytes === null ? "…" : f.totalBytes === 0 ? "Empty" : formatBytes(f.totalBytes)}
                </span>
                <span className="text-muted/60 text-[10px] font-mono flex-shrink-0 hidden sm:inline w-24 text-right">
                  {new Date(f.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <button
                  onClick={() => requestDeleteFolder(f)} title="Delete folder" aria-label={`Delete ${f.name}`}
                  className="w-8 h-8 rounded-lg border border-cleo-border text-muted hover:text-error hover:border-error/40 transition-all flex items-center justify-center cursor-pointer flex-shrink-0"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}

          {files.map((f) => {
            const key: SelectionKey = `file:${f.id}`;
            return (
              <div key={f.id} className="group flex items-center gap-3 bg-surface border border-cleo-border rounded-xl px-3 py-2.5 hover:border-gold/40 transition-colors">
                <Checkbox checked={selected.has(key)} onChange={() => toggleSelect(key)} variant="plain" />
                <button onClick={() => setViewingFile(f)} className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer text-left">
                  <div className="w-8 h-8 rounded-lg overflow-hidden border border-cleo-border flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={resolveImageSrc(f.storage_key)} alt={f.file_name} className="w-full h-full object-cover" />
                  </div>
                  <span className="text-ink text-sm truncate">{f.file_name}</span>
                </button>
                <span className="text-muted text-[10px] font-mono flex-shrink-0 w-20 text-right">{formatBytes(f.file_size_bytes)}</span>
                <span className="text-muted/60 text-[10px] font-mono flex-shrink-0 hidden sm:inline w-24 text-right">
                  {new Date(f.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <button
                  onClick={() => requestDeleteFile(f)} title="Delete file" aria-label={`Delete ${f.file_name}`}
                  className="w-8 h-8 rounded-lg border border-cleo-border text-muted hover:text-error hover:border-error/40 transition-all flex items-center justify-center cursor-pointer flex-shrink-0"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!loading && hasMoreFiles && (
        <button
          onClick={loadMoreFiles} disabled={loadingMoreFiles}
          className="py-2.5 text-center text-xs font-mono uppercase tracking-widest text-gold hover:text-gold-light border border-cleo-border hover:border-gold/40 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
        >
          {loadingMoreFiles ? "Loading…" : `Load More (${files.length} of ${filesTotal})`}
        </button>
      )}

      {/* New folder modal */}
      <AnimatePresence>
        {newFolderOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !creatingFolder && setNewFolderOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface border border-cleo-border rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
            >
              <h2 className="font-cinzel text-lg font-black text-ink">New Folder</h2>
              <form onSubmit={handleCreateFolder} className="flex flex-col gap-4">
                <input
                  type="text" autoFocus value={newFolderName}
                  onChange={(e) => { setNewFolderName(e.target.value); setFolderError(""); }}
                  placeholder="Folder name"
                  className="w-full bg-bg border border-cleo-border rounded-lg px-3.5 py-2.5 text-ink text-sm focus:outline-none focus:border-gold transition-colors"
                />
                {folderError && <p className="text-error text-xs">{folderError}</p>}
                <div className="flex gap-3">
                  <button type="button" onClick={() => setNewFolderOpen(false)} disabled={creatingFolder}
                    className="flex-1 py-2.5 text-center text-xs font-mono uppercase tracking-widest text-muted border border-cleo-border rounded-xl transition-colors cursor-pointer hover:text-ink disabled:opacity-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={creatingFolder || !newFolderName.trim()}
                    className="flex-1 py-2.5 text-center text-xs font-mono uppercase tracking-widest text-bg bg-gold hover:bg-gold-light rounded-xl transition-colors cursor-pointer disabled:opacity-60">
                    {creatingFolder ? "Creating…" : "Create"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lightbox */}
      <AnimatePresence>
        {viewingFile && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setViewingFile(null)}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
          >
            <button onClick={() => setViewingFile(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors flex items-center justify-center text-xl cursor-pointer">×</button>
            <div onClick={(e) => e.stopPropagation()} className="flex flex-col items-center gap-3 max-w-2xl w-full">
              <div className="relative w-full rounded-2xl overflow-hidden border border-cleo-border" style={{ aspectRatio: "1" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resolveImageSrc(viewingFile.storage_key)} alt={viewingFile.file_name} className="w-full h-full object-contain bg-black" />
              </div>
              <p className="text-white/80 text-xs font-mono">{viewingFile.file_name} · {formatBytes(viewingFile.file_size_bytes)}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        loading={deleting}
        onConfirm={() => confirmState?.onConfirm()}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LibraryPageInner />
    </Suspense>
  );
}
