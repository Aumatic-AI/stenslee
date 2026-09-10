"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { HexColorPicker, HexColorInput } from "react-colorful";
import type { TattooColor } from "@/lib/tattoo-colors";
import { readableTextColor } from "@/lib/tattoo-colors";

interface Props {
  presets: readonly TattooColor[];
  onPick: (hex: string) => void;
  onClose: () => void;
}

const DEFAULT_COLOR = "#0A0A0A";

export default function ColorPickerModal({ presets, onPick, onClose }: Props) {
  const [color, setColor] = useState(DEFAULT_COLOR);

  function pickPreset(hex: string) {
    onPick(hex);
    onClose();
  }

  function addCustom() {
    onPick(color);
    onClose();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 overflow-y-auto"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm my-auto bg-surface border border-cleo-border rounded-2xl p-5 flex flex-col gap-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-cinzel text-sm font-bold tracking-[0.1em] text-ink uppercase">Choose Ink Color</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-surface-2 text-muted hover:text-error transition-colors flex items-center justify-center text-base cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Quick picks — the curated tattoo-safe palette, one tap to add */}
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">Popular inks</p>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => pickPreset(c.hex)}
                title={`${c.name} — ${c.usage}`}
                className="flex-shrink-0 w-7 h-7 rounded-md ring-1 ring-inset ring-white/10 hover:ring-gold/60 hover:-translate-y-0.5 transition-all cursor-pointer"
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>

        <div className="h-px bg-cleo-border" />

        {/* Full picker — any color at all */}
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted">Or pick any color</p>
          <div className="cleo-color-picker">
            <HexColorPicker color={color} onChange={setColor} />
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-9 h-9 rounded-lg flex-shrink-0 ring-1 ring-inset ring-white/10"
              style={{ backgroundColor: color }}
            />
            <div className="flex-1 flex items-center bg-bg border border-cleo-border rounded-lg px-3 py-2 focus-within:border-gold transition-colors">
              <span className="text-muted text-sm font-mono">#</span>
              <HexColorInput
                color={color}
                onChange={setColor}
                prefixed={false}
                className="w-full bg-transparent text-ink text-sm font-mono uppercase focus:outline-none"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={addCustom}
            className="w-full py-2.5 rounded-xl font-cinzel font-bold text-xs tracking-[0.1em] uppercase transition-colors cursor-pointer border"
            style={{ backgroundColor: color, borderColor: color, color: readableTextColor(color) }}
          >
            Add This Color
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
