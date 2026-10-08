"use client";

import { upgradeWhatsAppUrl } from "@/lib/upgrade";
import { CrownIcon } from "./UpgradeIcons";

// Thin strip across the top of the dashboard once the studio's AI credits hit zero.
export default function UpgradeBanner({ studioName, onDismiss }: { studioName: string | null; onDismiss: () => void }) {
  return (
    <div role="status" className="shrink-0 bg-gold text-bg">
      <div className="flex items-center justify-center gap-x-3 gap-y-1 flex-wrap px-10 py-2 relative text-xs sm:text-sm">
        <CrownIcon className="w-4 h-4 shrink-0 hidden sm:block" />
        <p className="font-semibold text-center">
          <span className="sm:hidden">You&apos;re out of AI credits.</span>
          <span className="hidden sm:inline">You&apos;ve used all your AI credits. Upgrade to keep creating designs.</span>
        </p>
        <a
          href={upgradeWhatsAppUrl(studioName)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full bg-bg text-gold px-3 py-1 text-[11px] font-cinzel font-bold uppercase tracking-wider hover:bg-bg/85 transition-colors"
        >
          Upgrade now →
        </a>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center hover:bg-bg/10 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
