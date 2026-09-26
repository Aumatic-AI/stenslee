"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { useFeature } from "@/lib/permissions/use-feature";
import { resolveImageSrc } from "@/lib/image-src";
import { restoreLibraryFile, purgeLibraryFile, formatBytes } from "@/lib/library-storage";

const PAGE_SIZE = 15;
// Fallback only -- the real value is this org's trash_retention plan limit,
// read live below. Matches the purge-trash cron's own default for an
// unconfigured org, so the displayed countdown never disagrees with what
// actually gets purged.
const DEFAULT_RETENTION_DAYS = 30;

interface TrashRow {
  id: string;
  style: string | null;
  deleted_at: string;
  customerName: string;
  designerName: string;
  isNew: boolean;
}

// A trashed folder never shows up as its own row here -- deleting a folder
// trashes every file inside it individually (see trashLibraryFolder), so
// each image is its own restorable row, tagged with the folder path it came
// from (which may itself still be soft-deleted -- restoring the file brings
// that folder back too, wherever it was).
interface LibraryTrashRow {
  id: string;
  fileName: string;
  storageKey: string;
  sizeBytes: number;
  deletedAt: string;
  folderId: string | null;
  folderPath: string;
  isNew: boolean;
}

function daysLeft(deletedAt: string, retentionDays: number): number {
  const purgeAt = new Date(deletedAt).getTime() + retentionDays * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

export default function TrashPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const trashRetentionFeature = useFeature("trash_retention");
  const retentionDays = trashRetentionFeature.limitValue ?? DEFAULT_RETENTION_DAYS;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TrashRow[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryRows, setLibraryRows] = useState<LibraryTrashRow[]>([]);
  const [libraryTotalCount, setLibraryTotalCount] = useState(0);
  const [libraryLoadingMore, setLibraryLoadingMore] = useState(false);
  const [libraryRestoringId, setLibraryRestoringId] = useState<string | null>(null);
  const [libraryDeletingId, setLibraryDeletingId] = useState<string | null>(null);
  const [libraryConfirmingDeleteId, setLibraryConfirmingDeleteId] = useState<string | null>(null);

  // Captured once at load, before we overwrite trash_last_viewed_at — rows
  // soft-deleted after this moment are "new since last visit".
  const [lastViewedAt, setLastViewedAt] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRow = useCallback((r: any, cutoff: string | null): TrashRow => {
    const customer = Array.isArray(r.customers) ? r.customers[0] : r.customers;
    const designer = Array.isArray(r.designer) ? r.designer[0] : r.designer;
    return {
      id: r.id,
      style: r.style,
      deleted_at: r.deleted_at,
      customerName: customer?.name ?? "Unknown",
      designerName: designer?.name ?? "Unassigned",
      isNew: cutoff ? new Date(r.deleted_at).getTime() > new Date(cutoff).getTime() : true,
    };
  }, []);

  const loadPage = useCallback(async (offset: number, cutoff: string | null) => {
    const { data, count } = await supabase
      .from("sessions")
      .select("id, style, deleted_at, customers(name), designer:staff_id(name)", { count: "exact" })
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    return { rows: (data ?? []).map((r) => mapRow(r, cutoff)), count: count ?? 0 };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolves a folder's display path by walking parent_folder_id up to the
  // root, regardless of whether an ancestor is itself currently
  // soft-deleted (deleting a folder trashes it too -- this just wants its
  // name for display, not to gate on it).
  const folderPathCache = useState(() => new Map<string, string>())[0];
  const resolveFolderPath = useCallback(async (folderId: string | null): Promise<string> => {
    if (!folderId) return "Library root";
    const cached = folderPathCache.get(folderId);
    if (cached) return cached;
    const names: string[] = [];
    let cursor: string | null = folderId;
    while (cursor) {
      const result: { data: { name: string; parent_folder_id: string | null } | null } =
        await supabase.from("folders").select("name, parent_folder_id").eq("id", cursor).maybeSingle();
      if (!result.data) break;
      names.unshift(result.data.name);
      cursor = result.data.parent_folder_id;
    }
    const path = names.length > 0 ? names.join(" / ") : "Library root";
    folderPathCache.set(folderId, path);
    return path;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLibraryPage = useCallback(async (offset: number, cutoff: string | null) => {
    const { data, count } = await supabase
      .from("folder_files")
      .select("id, file_name, storage_key, file_size_bytes, deleted_at, folder_id", { count: "exact" })
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    const rows: LibraryTrashRow[] = [];
    for (const r of data ?? []) {
      rows.push({
        id: r.id,
        fileName: r.file_name,
        storageKey: r.storage_key,
        sizeBytes: r.file_size_bytes,
        deletedAt: r.deleted_at,
        folderId: r.folder_id,
        folderPath: await resolveFolderPath(r.folder_id),
        isNew: cutoff ? new Date(r.deleted_at).getTime() > new Date(cutoff).getTime() : true,
      });
    }
    return { rows, count: count ?? 0 };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/studio/login"); return; }

      const { data: staffRow } = await supabase
        .from("staff").select("role, trash_last_viewed_at").eq("id", user.id).maybeSingle();
      if (staffRow?.role !== "admin") { router.push("/studio/designer"); return; }
      if (cancelled) return;

      const cutoff = staffRow.trash_last_viewed_at ?? null;
      setLastViewedAt(cutoff);

      const { rows: firstPage, count } = await loadPage(0, cutoff);
      if (cancelled) return;
      setRows(firstPage);
      setTotalCount(count);
      setLoading(false);

      const { rows: libraryFirstPage, count: libraryCount } = await loadLibraryPage(0, cutoff);
      if (cancelled) return;
      setLibraryRows(libraryFirstPage);
      setLibraryTotalCount(libraryCount);
      setLibraryLoading(false);

      // Mark as viewed now that we've captured the old cutoff for
      // highlighting — clears the sidebar badge for next time.
      await supabase.from("staff").update({ trash_last_viewed_at: new Date().toISOString() }).eq("id", user.id);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLoadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    const { rows: nextPage } = await loadPage(rows.length, lastViewedAt);
    setRows((prev) => [...prev, ...nextPage]);
    setLoadingMore(false);
  }

  async function handleLoadMoreLibrary() {
    if (libraryLoadingMore) return;
    setLibraryLoadingMore(true);
    const { rows: nextPage } = await loadLibraryPage(libraryRows.length, lastViewedAt);
    setLibraryRows((prev) => [...prev, ...nextPage]);
    setLibraryLoadingMore(false);
  }

  async function handleRestoreLibrary(row: LibraryTrashRow) {
    setLibraryRestoringId(row.id);
    setActionError(null);
    try {
      await restoreLibraryFile(supabase, { id: row.id, folder_id: row.folderId });
      setLibraryRows((prev) => prev.filter((r) => r.id !== row.id));
      setLibraryTotalCount((c) => Math.max(0, c - 1));
    } catch (err) {
      setActionError((err as Error).message);
    }
    setLibraryRestoringId(null);
  }

  async function handleHardDeleteLibrary(row: LibraryTrashRow) {
    setLibraryDeletingId(row.id);
    setActionError(null);
    try {
      await purgeLibraryFile(supabase, { id: row.id, storage_key: row.storageKey });
      setLibraryRows((prev) => prev.filter((r) => r.id !== row.id));
      setLibraryTotalCount((c) => Math.max(0, c - 1));
    } catch (err) {
      setActionError((err as Error).message);
    }
    setLibraryDeletingId(null);
    setLibraryConfirmingDeleteId(null);
  }

  // Live search by customer name — same ilike-on-join pattern as elsewhere,
  // scoped to soft-deleted sessions only.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setSearchResults(null); return; }
    let cancelled = false;
    setSearching(true);
    (async () => {
      const { data: matchingCustomers } = await supabase
        .from("customers").select("id").ilike("name", `%${q}%`);
      const customerIds = (matchingCustomers ?? []).map((c) => c.id);
      if (customerIds.length === 0) {
        if (!cancelled) { setSearchResults([]); setSearching(false); }
        return;
      }
      const { data } = await supabase
        .from("sessions")
        .select("id, style, deleted_at, customers(name), designer:staff_id(name)")
        .not("deleted_at", "is", null)
        .in("customer_id", customerIds)
        .order("deleted_at", { ascending: false });
      if (cancelled) return;
      setSearchResults((data ?? []).map((r) => mapRow(r, lastViewedAt)));
      setSearching(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function handleRestore(id: string) {
    setRestoringId(id);
    setActionError(null);
    const { error } = await supabase.from("sessions").update({ deleted_at: null }).eq("id", id);
    setRestoringId(null);
    if (error) { setActionError(error.message); return; }
    const strip = (arr: TrashRow[]) => arr.filter((r) => r.id !== id);
    setRows(strip);
    setSearchResults((prev) => prev ? strip(prev) : prev);
    setTotalCount((c) => Math.max(0, c - 1));
  }

  async function handleHardDelete(id: string) {
    setDeletingId(id);
    setActionError(null);
    const res = await fetch(`/api/studio/trash/${id}`, { method: "DELETE" });
    setDeletingId(null);
    setConfirmingDeleteId(null);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed to delete session" }));
      setActionError(error ?? "Failed to delete session");
      return;
    }
    const strip = (arr: TrashRow[]) => arr.filter((r) => r.id !== id);
    setRows(strip);
    setSearchResults((prev) => prev ? strip(prev) : prev);
    setTotalCount((c) => Math.max(0, c - 1));
  }

  const isSearchMode = query.trim().length > 0;
  const displayed = isSearchMode ? (searchResults ?? []) : rows;
  const hasMore = !isSearchMode && rows.length < totalCount;

  return (
    <div className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-3xl mx-auto w-full flex flex-col gap-5">
      <div>
        <p className="text-gold text-[11px] font-mono tracking-[0.2em] uppercase mb-1">Studio Records</p>
        <h1 className="font-cinzel text-2xl font-black text-ink">Trash</h1>
      </div>

      <div className="flex items-center gap-3">
        <h2 className="font-cinzel text-sm font-bold tracking-[0.15em] text-muted uppercase">Sessions</h2>
        <span className="ml-auto text-[10px] font-mono text-muted bg-surface border border-cleo-border px-2.5 py-1 rounded-full">
          {searching ? "Searching…" : isSearchMode ? `${displayed.length} match${displayed.length === 1 ? "" : "es"}` : `${rows.length} of ${totalCount}`}
        </span>
      </div>

      <p className="text-muted text-xs -mt-2">
        Sessions are kept here for {retentionDays} days after deletion, then permanently removed automatically. Restore or delete them for good any time before that.
      </p>

      {/* Search bar */}
      <div className="relative">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by customer name…"
          className="w-full bg-surface border border-cleo-border rounded-xl pl-11 pr-10 py-3.5 text-ink text-sm placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
        />
        <AnimatePresence>
          {query && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-cleo-border flex items-center justify-center text-muted hover:text-ink transition-colors cursor-pointer"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {actionError && <p className="text-error text-sm font-mono">{actionError}</p>}

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-surface border border-cleo-border rounded-xl px-4 py-3.5 flex items-center gap-4">
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <div className="skeleton h-3.5 w-28 rounded" />
                <div className="skeleton h-2.5 w-40 rounded" />
              </div>
              <div className="skeleton h-2.5 w-16 rounded" />
            </div>
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div className="bg-surface border border-cleo-border rounded-2xl p-10 flex flex-col items-center gap-3 text-center">
          <span className="text-3xl text-muted/20">✦</span>
          <p className="text-muted text-sm">
            {isSearchMode ? `No deleted sessions match "${query}"` : "No deleted sessions."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence mode="popLayout">
            {displayed.map((r) => {
              const left = daysLeft(r.deleted_at, retentionDays);
              return (
                <motion.div
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className={`bg-surface border rounded-xl px-4 py-3.5 flex items-center gap-3 flex-wrap sm:flex-nowrap ${
                    r.isNew ? "border-gold/40" : "border-cleo-border"
                  }`}
                >
                  <Link
                    href={`/studio/admin/sessions/${r.id}?from=/studio/admin/trash`}
                    className="flex-1 min-w-0 flex items-center gap-3 group"
                  >
                    {r.isNew && <span className="w-1.5 h-1.5 rounded-full bg-gold flex-shrink-0" title="New since your last visit" />}
                    <div className="min-w-0">
                      <p className="text-ink font-semibold truncate group-hover:text-gold transition-colors">{r.customerName}</p>
                      <p className="text-muted text-xs font-mono truncate">{r.style || "No style"} · by {r.designerName}</p>
                    </div>
                  </Link>

                  <div className="flex items-center gap-2 flex-shrink-0 ml-auto sm:ml-0">
                    <span className={`text-[10px] font-mono font-bold uppercase px-2 py-1 rounded-full border ${
                      left <= 3 ? "text-error border-error/40 bg-error/10" : "text-muted border-cleo-border"
                    }`}>
                      {left === 0 ? "Deleting soon" : `${left}d left`}
                    </span>

                    {confirmingDeleteId === r.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleHardDelete(r.id)}
                          disabled={deletingId === r.id}
                          className="h-8 px-3 rounded-lg bg-error/90 border border-error text-white font-cinzel font-bold text-[10px] tracking-widest uppercase hover:bg-error transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {deletingId === r.id ? "Deleting…" : "Confirm"}
                        </button>
                        <button
                          onClick={() => setConfirmingDeleteId(null)}
                          disabled={deletingId === r.id}
                          className="h-8 px-3 rounded-lg bg-surface-2 border border-cleo-border text-muted font-mono text-[10px] uppercase hover:text-ink transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleRestore(r.id)}
                          disabled={restoringId === r.id}
                          className="h-8 px-3 rounded-lg border border-gold/40 text-gold font-cinzel font-bold text-[10px] tracking-widest uppercase hover:bg-gold/10 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {restoringId === r.id ? "Restoring…" : "Restore"}
                        </button>
                        <button
                          onClick={() => setConfirmingDeleteId(r.id)}
                          title="Delete permanently"
                          aria-label="Delete permanently"
                          className="w-8 h-8 rounded-lg border border-cleo-border text-muted hover:text-error hover:border-error/40 transition-colors flex items-center justify-center cursor-pointer flex-shrink-0"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="mt-1 py-2.5 text-center text-xs font-mono uppercase tracking-widest text-gold hover:text-gold-light border border-cleo-border hover:border-gold/40 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Load More"}
            </button>
          )}
        </div>
      )}

      {/* Library files — a deleted folder never shows up here itself, only
          the individual images that were inside it (see trashLibraryFolder). */}
      <div className="flex items-center gap-3 mt-2">
        <h2 className="font-cinzel text-sm font-bold tracking-[0.15em] text-muted uppercase">Library Files</h2>
        <span className="ml-auto text-[10px] font-mono text-muted bg-surface border border-cleo-border px-2.5 py-1 rounded-full">
          {libraryRows.length} of {libraryTotalCount}
        </span>
      </div>

      {libraryLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-surface border border-cleo-border rounded-xl px-4 py-3.5 flex items-center gap-4">
              <div className="skeleton w-10 h-10 rounded-lg flex-shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <div className="skeleton h-3.5 w-28 rounded" />
                <div className="skeleton h-2.5 w-40 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : libraryRows.length === 0 ? (
        <div className="bg-surface border border-cleo-border rounded-2xl p-10 flex flex-col items-center gap-3 text-center">
          <span className="text-3xl text-muted/20">✦</span>
          <p className="text-muted text-sm">No deleted library files.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence mode="popLayout">
            {libraryRows.map((r) => {
              const left = daysLeft(r.deletedAt, retentionDays);
              return (
                <motion.div
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className={`bg-surface border rounded-xl px-4 py-3.5 flex items-center gap-3 flex-wrap sm:flex-nowrap ${
                    r.isNew ? "border-gold/40" : "border-cleo-border"
                  }`}
                >
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    {r.isNew && <span className="w-1.5 h-1.5 rounded-full bg-gold flex-shrink-0" title="New since your last visit" />}
                    <div className="w-10 h-10 rounded-lg overflow-hidden border border-cleo-border flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={resolveImageSrc(r.storageKey)} alt={r.fileName} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-ink font-semibold truncate">{r.fileName}</p>
                      <p className="text-muted text-xs font-mono truncate">{r.folderPath} · {formatBytes(r.sizeBytes)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 ml-auto sm:ml-0">
                    <span className={`text-[10px] font-mono font-bold uppercase px-2 py-1 rounded-full border ${
                      left <= 3 ? "text-error border-error/40 bg-error/10" : "text-muted border-cleo-border"
                    }`}>
                      {left === 0 ? "Deleting soon" : `${left}d left`}
                    </span>

                    {libraryConfirmingDeleteId === r.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleHardDeleteLibrary(r)}
                          disabled={libraryDeletingId === r.id}
                          className="h-8 px-3 rounded-lg bg-error/90 border border-error text-white font-cinzel font-bold text-[10px] tracking-widest uppercase hover:bg-error transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {libraryDeletingId === r.id ? "Deleting…" : "Confirm"}
                        </button>
                        <button
                          onClick={() => setLibraryConfirmingDeleteId(null)}
                          disabled={libraryDeletingId === r.id}
                          className="h-8 px-3 rounded-lg bg-surface-2 border border-cleo-border text-muted font-mono text-[10px] uppercase hover:text-ink transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleRestoreLibrary(r)}
                          disabled={libraryRestoringId === r.id}
                          className="h-8 px-3 rounded-lg border border-gold/40 text-gold font-cinzel font-bold text-[10px] tracking-widest uppercase hover:bg-gold/10 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {libraryRestoringId === r.id ? "Restoring…" : "Restore"}
                        </button>
                        <button
                          onClick={() => setLibraryConfirmingDeleteId(r.id)}
                          title="Delete permanently"
                          aria-label="Delete permanently"
                          className="w-8 h-8 rounded-lg border border-cleo-border text-muted hover:text-error hover:border-error/40 transition-colors flex items-center justify-center cursor-pointer flex-shrink-0"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {libraryRows.length < libraryTotalCount && (
            <button
              onClick={handleLoadMoreLibrary}
              disabled={libraryLoadingMore}
              className="mt-1 py-2.5 text-center text-xs font-mono uppercase tracking-widest text-gold hover:text-gold-light border border-cleo-border hover:border-gold/40 rounded-xl transition-colors cursor-pointer disabled:opacity-60"
            >
              {libraryLoadingMore ? "Loading…" : "Load More"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
