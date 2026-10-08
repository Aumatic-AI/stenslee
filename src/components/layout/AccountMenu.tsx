"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getStorageUrl } from "@/lib/image-src";
import { upgradeWhatsAppUrl } from "@/lib/upgrade";
import { CrownIcon, SettingsIcon } from "./UpgradeIcons";

interface AccountMenuProps {
  name: string;
  avatarKey: string | null;
  studioName: string | null;
}

// Sidebar name block; opens upward with Upgrade plan and Settings.
export default function AccountMenu({ name, avatarKey, studioName }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {open && (
        <div role="menu" className="absolute bottom-full left-0 right-0 mb-2 z-20 bg-surface border border-cleo-border rounded-xl shadow-2xl p-1.5 animate-fade-up">
          <a
            role="menuitem"
            href={upgradeWhatsAppUrl(studioName)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gold/10 border border-gold/30 hover:bg-gold/15 transition-colors group"
          >
            <span className="w-8 h-8 rounded-lg bg-gold text-bg flex items-center justify-center shrink-0">
              <CrownIcon />
            </span>
            <span className="min-w-0">
              <span className="block text-gold text-sm font-cinzel font-bold tracking-wide">Upgrade plan</span>
              <span className="block text-muted text-[10px] font-mono">Chat with us on WhatsApp</span>
            </span>
          </a>
          <Link
            role="menuitem"
            href="/studio/admin/settings"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-3 px-3 py-2 rounded-lg text-muted hover:text-ink hover:bg-surface-2 transition-colors text-sm"
          >
            <SettingsIcon />
            Settings
          </Link>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl border transition-colors cursor-pointer text-left group ${
          open ? "border-gold/30 bg-gold/5" : "border-transparent hover:bg-surface"
        }`}
      >
        <div className="relative w-8 h-8 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center overflow-hidden shrink-0">
          {avatarKey ? (
            <Image src={getStorageUrl(avatarKey)!} alt={name} fill unoptimized className="object-cover" />
          ) : (
            <span className="font-cinzel text-xs font-black text-gold">{name.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-ink text-xs font-semibold truncate group-hover:text-gold transition-colors">{name}</p>
          <p className="text-muted text-[9px] font-mono uppercase tracking-wider">Admin</p>
        </div>
        <svg className={`w-3.5 h-3.5 text-muted transition-transform ${open ? "" : "rotate-180"}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}
