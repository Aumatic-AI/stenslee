"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePermissionStore } from "@/store/permission-store";
import { logUsage } from "@/lib/permissions/log-usage";

export interface PinterestPin {
  id: string;
  imageUrl: string;
  fullImageUrl: string;
  width: number;
  height: number;
  title: string;
  description: string;
  dominantColor: string;
  sourceUrl: string;
}

interface PinterestSearchProps {
  /** Called once we've fetched & blob-ified the pin. The parent stores the mapping. */
  onAdd: (blobUrl: string, pin: PinterestPin) => void;
  /** How many more references the user can still add (drives the disabled state). */
  remainingSlots: number;
  /** Pin IDs that have already been added — shown as a "selected" badge on results. */
  addedPinIds: ReadonlyArray<string>;
}

const QUICK_PICKS = [
  "fine line mandala",
  "geometric tattoo",
  "minimalist tattoo",
  "japanese dragon",
  "floral sleeve",
  "tribal tattoo",
  "lion realistic",
  "blackwork ornamental",
];

export default function PinterestSearch({ onAdd, remainingSlots, addedPinIds }: PinterestSearchProps) {
  const [query, setQuery] = useState("");
  const [pins, setPins] = useState<PinterestPin[]>([]);
  const [bookmark, setBookmark] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "loading-more" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [addingPinId, setAddingPinId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const limitReached = remainingSlots <= 0;
  const addedSet = new Set(addedPinIds);

  const runSearch = useCallback(async (q: string, mode: "fresh" | "more") => {
    const trimmed = q.trim();
    if (!trimmed) return;

    if (mode === "fresh") {
      setStatus("loading");
      setPins([]);
      setBookmark(null);
      setActiveQuery(trimmed);
    } else {
      setStatus("loading-more");
    }
    setError(null);

    try {
      const params = new URLSearchParams({ q: trimmed });
      if (mode === "more" && bookmark) params.set("bookmark", bookmark);

      const res = await fetch(`/api/pinterest/search?${params.toString()}`);
      const json = await res.json();

      if (!res.ok) throw new Error(json.error ?? `Search failed (${res.status})`);

      const newPins: PinterestPin[] = json.pins ?? [];
      setPins((prev) => (mode === "fresh" ? newPins : [...prev, ...newPins]));
      setBookmark(json.bookmark ?? null);
      setStatus("idle");

      const organizationId = usePermissionStore.getState().staff?.organizationId;
      if (organizationId) {
        logUsage({ organizationId, featureKey: "pinterest_search", action: "searched" }).catch(() => {});
      }
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }, [bookmark]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch(query, "fresh");
  }

  function pickSuggestion(term: string) {
    setQuery(term);
    runSearch(term, "fresh");
    inputRef.current?.blur();
  }

  async function addPin(pin: PinterestPin) {
    if (limitReached || addedSet.has(pin.id) || addingPinId) return;
    setAddingPinId(pin.id);
    try {
      // Fetch through our proxy so we sidestep CORS and can blob-ify the image.
      // We grab the original (highest resolution) since the user is using it as
      // a reference for downstream generation — quality matters.
      const proxyUrl = `/api/pinterest/image?url=${encodeURIComponent(pin.fullImageUrl)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Image download failed (${res.status})`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      onAdd(blobUrl, pin);
    } catch (err) {
      setError(`Couldn't add that image: ${(err as Error).message}`);
    } finally {
      setAddingPinId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search bar */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Pinterest — e.g. fine line lotus, mandala sleeve…"
            className="w-full bg-bg border border-cleo-border rounded-xl pl-10 pr-4 py-3 text-ink text-sm placeholder:text-muted/50 focus:border-gold focus:outline-none transition-colors"
          />
        </div>
        <motion.button
          whileHover={query.trim() ? { scale: 1.03 } : {}}
          whileTap={query.trim() ? { scale: 0.97 } : {}}
          type="submit"
          disabled={!query.trim() || status === "loading"}
          className={`px-5 py-3 rounded-xl font-cinzel font-bold text-sm tracking-wide border transition-colors ${
            query.trim() && status !== "loading"
              ? "bg-gold text-bg border-gold hover:bg-gold-light cursor-pointer"
              : "bg-surface-2 text-muted border-cleo-border cursor-not-allowed"
          }`}
        >
          {status === "loading" ? "…" : "Search"}
        </motion.button>
      </form>

      {/* Quick picks — shown until the user has run a search */}
      {!activeQuery && status !== "loading" && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted/60">
            Popular searches
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PICKS.map((term) => (
              <button
                key={term}
                onClick={() => pickSuggestion(term)}
                className="text-xs font-cinzel text-muted hover:text-gold bg-bg hover:bg-surface-2 border border-cleo-border hover:border-gold/40 px-3 py-1.5 rounded-full transition-colors cursor-pointer"
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Limit banner */}
      {limitReached && pins.length > 0 && (
        <div className="bg-gold/10 border border-gold/30 rounded-xl px-4 py-2.5 text-xs text-gold font-cinzel">
          Reference limit reached (5/5). Remove a thumbnail above to add more from Pinterest.
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="bg-error/10 border border-error/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-error font-cinzel">{error ?? "Something went wrong."}</p>
          {activeQuery && (
            <button
              onClick={() => runSearch(activeQuery, "fresh")}
              className="text-xs font-cinzel text-error hover:text-error/80 underline underline-offset-2"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Loading skeleton (fresh search) */}
      {status === "loading" && (
        <div
          className="gap-2 [column-fill:_balance]"
          style={{ columnCount: 3 }}
        >
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="mb-2 break-inside-avoid rounded-xl skeleton"
              style={{ height: 120 + ((i * 37) % 80) }}
            />
          ))}
        </div>
      )}

      {/* Results — Pinterest-style masonry via CSS columns */}
      {pins.length > 0 && status !== "loading" && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted/60">
              {pins.length} result{pins.length === 1 ? "" : "s"} for &ldquo;{activeQuery}&rdquo;
            </p>
            <button
              onClick={() => {
                setPins([]);
                setBookmark(null);
                setActiveQuery(null);
                setQuery("");
              }}
              className="text-[10px] font-mono text-muted hover:text-gold transition-colors"
            >
              Clear
            </button>
          </div>

          <div
            className="masonry-grid"
            style={{
              columnCount: 2,
              columnGap: "0.5rem",
            }}
          >
            {pins.map((pin) => {
              const isAdded = addedSet.has(pin.id);
              const isAdding = addingPinId === pin.id;
              const disabled = limitReached || isAdded || addingPinId !== null;
              return (
                <motion.div
                  key={pin.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="mb-2 break-inside-avoid"
                >
                  <button
                    onClick={() => addPin(pin)}
                    disabled={disabled}
                    className={`group relative w-full rounded-xl overflow-hidden border transition-all text-left ${
                      isAdded
                        ? "border-gold shadow-[0_0_15px_rgba(201,168,76,0.3)]"
                        : disabled
                        ? "border-cleo-border opacity-60 cursor-not-allowed"
                        : "border-cleo-border hover:border-gold/50 cursor-pointer"
                    }`}
                    style={{ backgroundColor: pin.dominantColor }}
                  >
                    {/* Image — width 100% lets the column lay it out at its natural aspect */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pin.imageUrl}
                      alt={pin.title || pin.description || "Pinterest pin"}
                      loading="lazy"
                      className="w-full h-auto block"
                      style={{ aspectRatio: `${pin.width} / ${pin.height}` }}
                    />

                    {/* Hover/added overlay */}
                    {isAdded ? (
                      <div className="absolute inset-0 bg-gold/15 flex items-center justify-center pointer-events-none">
                        <div className="bg-gold text-bg font-cinzel text-[10px] font-bold tracking-[0.1em] uppercase px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Added
                        </div>
                      </div>
                    ) : (
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center pointer-events-none">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-gold text-bg font-cinzel text-[10px] font-bold tracking-[0.1em] uppercase px-3 py-1.5 rounded-lg shadow-lg">
                          {limitReached ? "Limit reached" : "+ Use as reference"}
                        </span>
                      </div>
                    )}

                    {/* Loading spinner while this specific pin is being downloaded */}
                    {isAdding && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <div className="w-7 h-7 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </button>
                </motion.div>
              );
            })}
          </div>

          {/* Load more */}
          {bookmark && bookmark !== "-end-" && (
            <button
              onClick={() => activeQuery && runSearch(activeQuery, "more")}
              disabled={status === "loading-more"}
              className="w-full py-3 rounded-xl border border-cleo-border hover:border-gold/40 text-muted hover:text-gold transition-colors font-cinzel text-sm tracking-wide cursor-pointer disabled:cursor-wait"
            >
              {status === "loading-more" ? "Loading more…" : "Load more pins"}
            </button>
          )}
        </>
      )}

      {/* Empty state (after a search returned nothing) */}
      <AnimatePresence>
        {activeQuery && pins.length === 0 && status === "idle" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center py-8"
          >
            <p className="text-muted text-sm font-cinzel">No pins found for &ldquo;{activeQuery}&rdquo;</p>
            <p className="text-muted/60 text-xs mt-1">Try a different search term.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
