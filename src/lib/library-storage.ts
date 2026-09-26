// Design Library — zip parsing, quota math, and the create/upload/delete
// operations for its nested folder tree. All writes go through the browser
// Supabase client (RLS already grants admins full access within their own
// org) rather than a Node API route, matching this app's established
// pattern of avoiding server-side Supabase calls where possible.
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";

export const LIBRARY_BUCKET = "org-library";

// On top of an organization's real storage_limit_bytes, a small buffer so a
// single file that only tips the total slightly over doesn't get blocked --
// see the "storage rule" plan: 500 MB allocated + 10 MB grace = a 510 MB
// hard stop, not a hard stop at exactly 500 MB.
export const STORAGE_GRACE_BYTES = 10 * 1024 * 1024;

const JUNK_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"]);

function isJunkFile(name: string): boolean {
  return JUNK_NAMES.has(name) || name.startsWith("._") || name.startsWith(".");
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "heic":
    case "heif": return "image/heic";
    case "gif": return "image/gif";
    default: return "application/octet-stream";
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function effectiveLimitBytes(limitBytes: number): number {
  return limitBytes + STORAGE_GRACE_BYTES;
}

export function wouldExceedQuota(usedBytes: number, limitBytes: number, addBytes: number): boolean {
  return usedBytes + addBytes > effectiveLimitBytes(limitBytes);
}

export interface ParsedZipFile {
  path: string[]; // folder path segments this file sits under, root-relative
  fileName: string;
  bytes: Uint8Array;
  mimeType: string;
  sizeBytes: number;
}

export interface ParsedZip {
  folders: string[][]; // every folder path needed, shallowest first
  files: ParsedZipFile[];
  totalBytes: number;
}

function registerFolderPath(set: Set<string>, segments: string[]) {
  // Every ancestor needs its own entry too -- e.g. "A/B/C" implies "A" and
  // "A/B" must exist as folders even if the zip has no explicit dir entry
  // for them.
  for (let i = 1; i <= segments.length; i++) {
    set.add(segments.slice(0, i).join("/"));
  }
}

/**
 * Reads every entry in a zip file, fully in-browser. Throws before any
 * upload begins if it finds a file type the library doesn't support, or a
 * file over maxFileSizeBytes (the org's library_file_size_limit plan
 * value) -- never commits a partial, half-imported tree. Junk files
 * (.DS_Store, Thumbs.db, hidden dotfiles) are silently skipped rather than
 * rejected.
 */
export async function parseZipFile(file: File, maxFileSizeBytes?: number): Promise<ParsedZip> {
  const zip = await JSZip.loadAsync(file);
  const folderPathSet = new Set<string>();
  const files: ParsedZipFile[] = [];
  let totalBytes = 0;

  const entries = Object.values(zip.files).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const rawPath = entry.name.replace(/\/+$/, "");
    if (!rawPath) continue;
    const segments = rawPath.split("/").filter(Boolean);
    const baseName = segments[segments.length - 1];
    if (!baseName) continue;

    if (entry.dir) {
      registerFolderPath(folderPathSet, segments);
      continue;
    }

    if (isJunkFile(baseName)) continue;

    const ext = extOf(baseName);
    if (!IMAGE_EXTENSIONS.has(ext)) {
      throw new Error(`"${rawPath}" isn't an image the library supports — only image files are allowed inside the zip.`);
    }

    const folderSegments = segments.slice(0, -1);
    if (folderSegments.length > 0) registerFolderPath(folderPathSet, folderSegments);

    const bytes = await entry.async("uint8array");
    if (maxFileSizeBytes && bytes.byteLength > maxFileSizeBytes) {
      throw new Error(`"${rawPath}" (${formatBytes(bytes.byteLength)}) is larger than the ${formatBytes(maxFileSizeBytes)} per-file limit.`);
    }
    totalBytes += bytes.byteLength;
    files.push({ path: folderSegments, fileName: baseName, bytes, mimeType: mimeFromExt(ext), sizeBytes: bytes.byteLength });
  }

  // Shallowest-first so a parent folder always gets created before its
  // children, regardless of what order the zip's own entries were in.
  const folders = Array.from(folderPathSet)
    .map((joined) => joined.split("/"))
    .sort((a, b) => a.length - b.length);

  return { folders, files, totalBytes };
}

export interface CommitProgress {
  done: number;
  total: number;
  label: string;
}

/**
 * Creates whatever folders a parsed zip needs (reusing an existing folder
 * of the same name/parent instead of duplicating it, so re-uploading the
 * same zip merges into the existing tree) and uploads every file, reporting
 * progress as it goes. Assumes the quota check already passed.
 */
export async function commitParsedZip(
  supabase: SupabaseClient,
  organizationId: string,
  targetFolderId: string | null,
  parsed: ParsedZip,
  onProgress?: (p: CommitProgress) => void
): Promise<void> {
  const folderIdByPath = new Map<string, string | null>();
  folderIdByPath.set("", targetFolderId);

  const total = parsed.folders.length + parsed.files.length;
  let done = 0;

  for (const path of parsed.folders) {
    const name = path[path.length - 1];
    const parentPath = path.slice(0, -1).join("/");
    const parentId = folderIdByPath.get(parentPath) ?? null;

    onProgress?.({ done, total, label: `Creating folder "${name}"` });

    let query = supabase.from("folders").select("id").eq("organization_id", organizationId).eq("name", name).is("deleted_at", null);
    query = parentId ? query.eq("parent_folder_id", parentId) : query.is("parent_folder_id", null);
    const { data: existing } = await query.maybeSingle();

    let folderId: string;
    if (existing) {
      folderId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from("folders")
        .insert({ organization_id: organizationId, parent_folder_id: parentId, name })
        .select("id")
        .single();
      if (error) throw new Error(`Couldn't create folder "${name}": ${error.message}`);
      folderId = created.id;
    }
    folderIdByPath.set(path.join("/"), folderId);
    done++;
  }

  for (const file of parsed.files) {
    onProgress?.({ done, total, label: `Uploading ${file.fileName}` });
    const folderId = folderIdByPath.get(file.path.join("/")) ?? targetFolderId;
    const ext = extOf(file.fileName);
    const storagePath = `${organizationId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

    const { error: uploadError } = await supabase.storage
      .from(LIBRARY_BUCKET)
      .upload(storagePath, file.bytes, { contentType: file.mimeType, upsert: false });
    if (uploadError) throw new Error(`Couldn't upload "${file.fileName}": ${uploadError.message}`);

    const { error: insertError } = await supabase.from("folder_files").insert({
      organization_id: organizationId,
      folder_id: folderId,
      file_name: file.fileName,
      storage_key: `${LIBRARY_BUCKET}/${storagePath}`,
      file_size_bytes: file.sizeBytes,
      mime_type: file.mimeType,
    });
    if (insertError) throw new Error(`Couldn't save "${file.fileName}": ${insertError.message}`);
    done++;
  }
  onProgress?.({ done, total, label: "Done" });
}

/** Uploads one image directly into a folder (or the root, when folderId is null). */
export async function uploadSingleImage(
  supabase: SupabaseClient,
  organizationId: string,
  folderId: string | null,
  file: File,
  maxFileSizeBytes?: number
): Promise<void> {
  const ext = extOf(file.name);
  if (!IMAGE_EXTENSIONS.has(ext)) throw new Error("Only image files can be uploaded here.");
  if (maxFileSizeBytes && file.size > maxFileSizeBytes) {
    throw new Error(`"${file.name}" (${formatBytes(file.size)}) is larger than the ${formatBytes(maxFileSizeBytes)} per-file limit.`);
  }

  const storagePath = `${organizationId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
  const { error: uploadError } = await supabase.storage
    .from(LIBRARY_BUCKET)
    .upload(storagePath, file, { contentType: file.type || mimeFromExt(ext), upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  const { error: insertError } = await supabase.from("folder_files").insert({
    organization_id: organizationId,
    folder_id: folderId,
    file_name: file.name,
    storage_key: `${LIBRARY_BUCKET}/${storagePath}`,
    file_size_bytes: file.size,
    mime_type: file.type || mimeFromExt(ext),
  });
  if (insertError) throw new Error(insertError.message);
}

/** One round trip for however many folders are in the current view -- each folder's size includes every nested subfolder's files. */
export async function fetchFolderSizes(supabase: SupabaseClient, folderIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (folderIds.length === 0) return map;
  const { data } = await supabase.rpc("folder_total_bytes", { p_folder_ids: folderIds });
  for (const row of (data ?? []) as { folder_id: string; total_bytes: number }[]) {
    map.set(row.folder_id, row.total_bytes);
  }
  return map;
}

/**
 * Moves a file to Trash -- sets deleted_at only, storage object untouched.
 * It keeps counting against the org's storage quota (matches how disk
 * space actually works) until it's permanently purged.
 */
export async function trashLibraryFile(supabase: SupabaseClient, fileId: string): Promise<void> {
  const { error } = await supabase.from("folder_files").update({ deleted_at: new Date().toISOString() }).eq("id", fileId);
  if (error) throw new Error(`Couldn't delete file: ${error.message}`);
}

async function collectFolderSubtree(supabase: SupabaseClient, folderId: string): Promise<string[]> {
  const allFolderIds = [folderId];
  let frontier = [folderId];
  while (frontier.length > 0) {
    const { data: children } = await supabase.from("folders").select("id").in("parent_folder_id", frontier);
    const childIds = (children ?? []).map((c: { id: string }) => c.id);
    if (childIds.length === 0) break;
    allFolderIds.push(...childIds);
    frontier = childIds;
  }
  return allFolderIds;
}

/**
 * Moves a folder to Trash -- the folder row and every nested subfolder and
 * file are all soft-deleted (deleted_at set), nothing physically removed.
 * The folder itself is never shown in Trash (see the Trash page); this just
 * makes every file that was inside it show up there individually,
 * restorable one at a time.
 */
export async function trashLibraryFolder(supabase: SupabaseClient, folderId: string): Promise<void> {
  const allFolderIds = await collectFolderSubtree(supabase, folderId);
  const now = new Date().toISOString();
  const { error: folderError } = await supabase.from("folders").update({ deleted_at: now }).in("id", allFolderIds).is("deleted_at", null);
  if (folderError) throw new Error(`Couldn't delete folder: ${folderError.message}`);
  const { error: fileError } = await supabase.from("folder_files").update({ deleted_at: now }).in("folder_id", allFolderIds).is("deleted_at", null);
  if (fileError) throw new Error(`Couldn't delete folder: ${fileError.message}`);
}

/**
 * Restores one trashed file -- and, walking up its parent chain, un-trashes
 * any ancestor folder that's still marked deleted too (deleting a folder
 * trashes it and everything inside it in one go, so restoring a file from
 * inside it has to bring its folder back as well, exactly where it was).
 */
export async function restoreLibraryFile(supabase: SupabaseClient, file: { id: string; folder_id: string | null }): Promise<void> {
  let cursor = file.folder_id;
  while (cursor) {
    const { data: folder } = await supabase.from("folders").select("id, parent_folder_id, deleted_at").eq("id", cursor).maybeSingle();
    if (!folder) break;
    if (folder.deleted_at) {
      const { error } = await supabase.from("folders").update({ deleted_at: null }).eq("id", folder.id);
      if (error) throw new Error(`Couldn't restore folder: ${error.message}`);
    }
    cursor = folder.parent_folder_id;
  }
  const { error } = await supabase.from("folder_files").update({ deleted_at: null }).eq("id", file.id);
  if (error) throw new Error(`Couldn't restore file: ${error.message}`);
}

/** Permanently removes a trashed file -- the storage object and the row both go, for good. */
export async function purgeLibraryFile(supabase: SupabaseClient, file: { id: string; storage_key: string }): Promise<void> {
  const path = file.storage_key.replace(`${LIBRARY_BUCKET}/`, "");
  await supabase.storage.from(LIBRARY_BUCKET).remove([path]);
  const { error } = await supabase.from("folder_files").delete().eq("id", file.id);
  if (error) throw new Error(`Couldn't permanently delete file: ${error.message}`);
}
