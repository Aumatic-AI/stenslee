"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export const TATTOO_STYLES = [
  // ── Black & Grey ──────────────────────────────────────────
  "Black & Grey",
  "Smooth Black & Grey",
  "Religious Black & Grey",
  "Chicano",
  "Portrait",
  "Micro Realism",
  // ── Color ─────────────────────────────────────────────────
  "Color Tattoo",
  "New School",
  "Illustrative Color",
  "Cartoon / Comic Style",
  // ── Traditional ───────────────────────────────────────────
  "Old School",
  "Neo Traditional",
  "Japanese",
  "Oriental",
  "Tribal",
  "Polynesian",
  "Maori",
  "Samoan",
  "Marquesan",
  "Borneo Tribal",
  // ── Realism ───────────────────────────────────────────────
  "Realistic",
  "Hyper-realistic",
  "Animal Realism",
  "Biomechanical",
  // ── Linework ──────────────────────────────────────────────
  "Fine Line",
  "Single Needle",
  "Linework",
  "Geometric",
  "Sacred Geometry",
  "Ornamental",
  "Engraving",
  "Etching",
  // ── Dotwork ───────────────────────────────────────────────
  "Dotwork",
  "Stippling",
  "Pointillism",
  "Geometric Dotwork",
  "Mandala",
  // ── Japanese ──────────────────────────────────────────────
  "Neo Japanese",
  "Tebori",
  // ── Modern ────────────────────────────────────────────────
  "Watercolor",
  "Sketch Style",
  "Abstract",
  "Trash Polka",
  "Ignorant Style",
  "Sticker Style",
  "Cybersigilism",
  "Vaporwave",
  // ── Blackwork ─────────────────────────────────────────────
  "Blackwork",
  "Heavy Blackwork",
  "Ornamental Blackwork",
  "Dark Art",
  "Brutal Blackwork",
  // ── Other ─────────────────────────────────────────────────
  "Anime",
  "Manga",
  "Minimal",
  "Gothic",
  "Horror",
  "Lettering",
  "Script",
  // ── Special formats ───────────────────────────────────────
  "Cover-up Design",
  "Sleeve Design",
  "Patchwork Design",
];

interface StyleSelectProps {
  value: string;
  onChange: (style: string) => void;
}

export default function StyleSelect({ value, onChange }: StyleSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = TATTOO_STYLES.filter((s) =>
    s.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gold/30 bg-black/40 text-white/90 text-sm hover:border-gold/60 transition-colors"
      >
        <span className={value ? "text-white" : "text-white/40"}>
          {value || "Select style…"}
        </span>
        <svg
          className={`w-4 h-4 text-gold/60 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 w-full mt-2 rounded-xl border border-gold/30 bg-[#0a0a0a] shadow-xl overflow-hidden"
            style={{ transformOrigin: "top" }}
          >
            <div className="p-2 border-b border-gold/10">
              <input
                autoFocus
                type="text"
                placeholder="Search styles…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-2 bg-black/60 rounded-lg text-sm text-white/90 placeholder-white/30 outline-none border border-gold/20 focus:border-gold/50"
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-4 py-3 text-sm text-white/40">No styles found</p>
              ) : (
                filtered.map((style) => {
                  const active = style === value;
                  return (
                    <button
                      key={style}
                      type="button"
                      onClick={() => {
                        onChange(style);
                        setOpen(false);
                        setSearch("");
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                        active
                          ? "bg-gold/20 text-gold"
                          : "text-white/80 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {style}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
